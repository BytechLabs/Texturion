import Foundation
import Observation

/// One-shot toast payload (id makes repeats re-fire the effect).
struct ThreadNotice: Identifiable, Sendable {
    let id: Int64
    let text: String
    var actionLabel: String?
    var action: (@MainActor () -> Void)?
}

/// A failed send-intent: the SAME Idempotency-Key rides the user's retry.
private struct FailedSendIntent {
    let body: String
    let photoIds: [String]
    let key: String
}

/// State + mutations for one conversation thread, mirroring the Android
/// ThreadController 1:1. Realtime payloads are treated as ID-only routing
/// hints — every update refetches through the authed API.
@MainActor
@Observable
final class ThreadController {
    let conversationId: String
    let repo: MessagingRepository

    private let meApi: MeApi
    private let uploader: NoteFileUploader
    /// The contact-field writes reuse the contacts feature's tested mutation
    /// (explicit-null clears) rather than growing a duplicate here.
    private let contacts: ContactMutations
    private let companyId: String
    /// Read by the make-a-task sheet so a new task defaults to its creator.
    let meUserId: String

    private(set) var load: LoadState<Void> = .loading
    /// Structural error code of a failed initial load (drives the honest 404).
    private(set) var loadErrorCode: String?
    private(set) var conversation: ConversationDetail?
    private(set) var messages: [Message] = []
    private(set) var messagesCursor: String?
    private(set) var allMessagesLoaded = false
    private(set) var loadingOlder = false
    private(set) var events: [ConversationEvent] = []
    private(set) var pinnedMessages: [Message] = []
    private(set) var pendingSends: [PendingSend] = []

    /// #247: the catch-up, and whether anybody has asked for one yet.
    ///
    /// Starts `.idle` on every open, deliberately. The server caches against the
    /// thread's last message id, so re-opening an unchanged thread costs
    /// nothing anyway — and a card that reappeared already-expanded would show a
    /// catch-up written before the three messages that arrived since, which is
    /// the manufactured false memory #247 warns about.
    ///
    /// It starts on `.unknown` rather than on an empty standing, which are not
    /// the same claim: nobody has told this thread anything about the carrier
    /// yet, and "they have not opted out" is a sentence only an answer earns.
    private(set) var catchUp: ThreadCatchUpState = .idle(.unknown)
    /// One outcome per catch-up, not per tap.
    ///
    /// A person who checks three cited lines used ONE catch-up and spent one
    /// unit; three `used` reports against a single ledger row would make the
    /// number say something that is not true.
    @ObservationIgnored private var catchUpOutcomeReported = false

    /// #233: texts written for this thread that have not gone yet.
    ///
    /// Kept OUT of ``messages`` on purpose. A scheduled message has no delivery
    /// status and may never become a message at all, so anything that reads the
    /// timeline must not be able to see one — showing an unsent message as sent
    /// is the worst failure this feature has.
    private(set) var scheduled: [ScheduledMessage] = []

    /// #234: the durable queue behind `pendingSends`. Constructed here rather
    /// than injected — every caller would otherwise have to thread it through,
    /// and the logic worth testing lives in `OutboxFlusher`, which
    /// `MessagingOutboxTests` drives directly against a throwaway suite.
    private let outbox = Outbox()

    private(set) var members: [Member] = []
    private(set) var contact: Contact?
    private(set) var company: CompanyView?
    private(set) var usage: Usage?
    var filter = ThreadFilter()
    private(set) var notice: ThreadNotice?

    /// Bumps when an inbound message lands while this thread is open.
    private(set) var newInboundTick = 0

    /// #607: bumps when a payment on THIS thread is paid, refunded or disputed.
    ///
    /// A TICK RATHER THAN THE PAYMENT ITSELF. The strip above the composer is
    /// `ThreadPaymentsPane` and it owns the list it renders; a copy of that list
    /// here would be a second answer to "what is this thread owed", and the one
    /// nobody refetched would be the one on screen. So this carries no payment
    /// state at all — it is the routing hint, forwarded, and the pane turns it
    /// into one refetch of the list it already reads.
    ///
    /// Read by `ThreadView`, which passes it into the pane. Nothing else may
    /// read it: a second consumer would make this a general-purpose "payments
    /// changed" bus, and a bus is what stops anybody being able to say which
    /// screen a broadcast reaches.
    private(set) var paymentChangedTick = 0

    /// Per-note generic file attachments, fetched lazily per bubble.
    private(set) var noteFiles: [String: LoadState<[Attachment]>] = [:]

    // MARK: Contact-panel state — loaded lazily when the sheet opens.

    /// Prior conversations with this contact (current thread excluded).
    private(set) var otherConversations: LoadState<[ConversationListItem]>?

    /// The conversation's task checklist (T5.2).
    private(set) var conversationTasks: LoadState<[TaskItem]>?

    @ObservationIgnored private var eventsCursor: String?
    @ObservationIgnored private var eventsExhausted = false
    @ObservationIgnored private var started = false
    @ObservationIgnored private var noticeSeq: Int64 = 0
    @ObservationIgnored private var convRefreshTask: Task<Void, Never>?
    @ObservationIgnored private var lastFailedIntent: FailedSendIntent?

    init(
        repo: MessagingRepository,
        meApi: MeApi,
        uploader: NoteFileUploader,
        contacts: ContactMutations,
        companyId: String,
        conversationId: String,
        meUserId: String
    ) {
        self.repo = repo
        self.meApi = meApi
        self.uploader = uploader
        self.contacts = contacts
        self.companyId = companyId
        self.conversationId = conversationId
        self.meUserId = meUserId
    }

    var newestMessageId: String? {
        messages.first?.id
    }

    /// Mint a signed attachment URL — per view, never cached.
    ///
    /// #240: the default is the PREVIEW, which is what a thread bubble renders.
    /// `variant: "original"` is for opening or handing the file to another app.
    func mintAttachmentUrl(
        _ attachmentId: String,
        variant: String = "preview"
    ) async throws -> String {
        try await repo.attachmentUrl(
            companyId: companyId,
            attachmentId: attachmentId,
            variant: variant
        ).url
    }

    private func notify(
        _ text: String,
        actionLabel: String? = nil,
        action: (@MainActor () -> Void)? = nil
    ) {
        noticeSeq += 1
        notice = ThreadNotice(id: noticeSeq, text: text, actionLabel: actionLabel, action: action)
    }

    /// UI-originated notices (copy confirmations, picker rejections) ride the
    /// same toast channel as controller notices.
    func notifyExternally(
        _ text: String,
        actionLabel: String? = nil,
        action: (@MainActor () -> Void)? = nil
    ) {
        notify(text, actionLabel: actionLabel, action: action)
    }

    func markCopied() {
        notify("Copied.")
    }

    // MARK: - Loading

    func start() {
        if started { return }
        started = true
        Task { await initialLoad() }
    }

    func retryInitialLoad() {
        Task { await initialLoad() }
    }

    private func initialLoad() async {
        load = .loading
        loadErrorCode = nil
        let detail: ConversationDetail
        do {
            detail = try await repo.detail(companyId: companyId, conversationId: conversationId)
        } catch {
            loadErrorCode = (error as? ApiError)?.code
            load = .failed(error.userMessage)
            return
        }
        conversation = detail
        messages = detail.messages.data
        messagesCursor = detail.messages.next_cursor
        allMessagesLoaded = detail.messages.next_cursor == nil
        load = .ready(())

        // #234: whatever was queued before this process existed comes back
        // into the thread, then we try to drain it. Restoring BEFORE flushing
        // is deliberate — if there is still no signal, the person opening the
        // thread sees their message sitting there rather than an empty
        // conversation that quietly ate it.
        restoreQueued()
        flushOutbox()

        // Secondary loads — quiet failures; they gate niceties, not the thread.
        Task { try? await self.refreshEvents() }
        Task { try? await self.refreshPinned() }
        Task {
            if let page = try? await self.repo.members(companyId: self.companyId) {
                self.members = page.data
            }
        }
        Task { try? await self.refreshContact() }
        Task {
            if let me = try? await self.meApi.me(companyId: self.companyId) {
                self.company = me.company
            }
        }
        Task {
            if let usage = try? await self.repo.usage(companyId: self.companyId) {
                self.usage = usage
            }
        }
        Task { try? await self.refreshScheduled() }
    }

    // MARK: - #233 send later

    /// What this thread still has queued.
    ///
    /// Live rows only — the finished ones are history, and the strip is about
    /// what is coming. Re-read after every inbound, because the server HOLDS a
    /// scheduled message the moment the customer replies, and a screen still
    /// saying "Sending Tue, 8:00 AM" would be telling the crew something that
    /// stopped being true.
    private func refreshScheduled() async throws {
        scheduled = try await repo.scheduledMessages(
            companyId: companyId,
            conversationId: conversationId
        ).scheduled_messages
    }

    /// Queue `body` for `sendAtISO`.
    ///
    /// Returns what the API said rather than notifying and swallowing it,
    /// because a quiet-hours 409 is a QUESTION: the composer has to be able to
    /// ask it and retry with the flag, which is #225 ask 2 — warned, never
    /// blocked. Everything else is reported here in the API's own words.
    func scheduleSend(
        body: String,
        sendAtISO: String,
        quietHoursConfirmed: Bool
    ) async -> ScheduleOutcome {
        do {
            _ = try await repo.scheduleMessage(
                companyId: companyId,
                conversationId: conversationId,
                body: body,
                sendAtISO: sendAtISO,
                quietHoursConfirmed: quietHoursConfirmed
            )
            try? await refreshScheduled()
            return .scheduled
        } catch let error as ApiError
            where error.code == ApiErrorCode.quietHoursConfirmationRequired {
            return .needsQuietHoursConfirm
        } catch {
            notify(error.userMessage)
            return .failed
        }
    }

    /// Call one off.
    ///
    /// Removed from the strip before the round trip, then reconciled.
    /// Cancelling something that has not gone is reversible in the only sense
    /// that matters — you can schedule it again — so it confirms rather than
    /// asking.
    func cancelScheduled(_ id: String) {
        let before = scheduled
        scheduled = before.filter { $0.id != id }
        Task {
            do {
                try await repo.cancelScheduledMessage(companyId: companyId, id: id)
                notify(ScheduledSend.copyLine("canceled_confirmation"))
                try? await refreshScheduled()
            } catch {
                // It is still queued. Putting it back is the only honest state:
                // a row that vanished from the strip while still being due to
                // send is the silent disappearance DECISIONS.md rules out.
                scheduled = before
                notify(error.userMessage)
            }
        }
    }

    /// #244 — "I have this."
    ///
    /// Clears the banner before the round trip: the value of tapping it is that
    /// everybody else stops assuming somebody will, and a strip that lingers
    /// while a request is in flight is the same ambiguity for another second.
    /// Put back on failure — a banner that vanished while the alert was still
    /// open would be worse than one that never appeared.
    func acknowledgeAlert(_ alertId: String) {
        let before = conversation
        conversation?.open_alert = nil
        Task {
            do {
                let result = try await repo.acknowledgeAlert(
                    companyId: companyId,
                    alertId: alertId
                )
                notify(
                    result.outcome == "already_acknowledged"
                        ? OnCall.alertTakenLine("Somebody else")
                        : OnCall.bannerYours
                )
            } catch {
                conversation = before
                notify(error.userMessage)
            }
        }
    }

    func loadOlderMessages() {
        guard let cursor = messagesCursor, !loadingOlder else { return }
        loadingOlder = true
        Task {
            do {
                let page = try await repo.messages(
                    companyId: companyId,
                    conversationId: conversationId,
                    cursor: cursor
                )
                messages = appendPage(messages, page.data) { $0.id }
                messagesCursor = page.next_cursor
                if page.next_cursor == nil { allMessagesLoaded = true }
                try? await ensureEventsCoverMessages()
            } catch {
                notify(error.userMessage)
            }
            loadingOlder = false
        }
    }

    private func refreshMessagesFirstPage() async throws {
        let page = try await repo.messages(companyId: companyId, conversationId: conversationId)
        messages = mergeMessagesFirstPage(messages, page.data)
        if messagesCursor == nil, page.next_cursor != nil, !allMessagesLoaded {
            messagesCursor = page.next_cursor
        }
    }

    /// Re-walk the pages the user already loaded (bounded) so a done/pin toggle
    /// on a deep-history message lands without trusting the broadcast payload.
    private func refetchLoadedWindow() async throws {
        let target = messages.count
        var acc: [Message] = []
        var cursor: String?
        var pages = 0
        repeat {
            let page = try await repo.messages(
                companyId: companyId,
                conversationId: conversationId,
                cursor: cursor
            )
            acc = appendPage(acc, page.data) { $0.id }
            cursor = page.next_cursor
            pages += 1
        } while cursor != nil && acc.count < target && pages < 12
        messages = acc
        messagesCursor = cursor
        allMessagesLoaded = cursor == nil
    }

    private func refreshEvents() async throws {
        let page = try await repo.events(companyId: companyId, conversationId: conversationId)
        events = mergeFirstPage(events, page.data, idOf: { $0.id }, sortKey: { $0.created_at })
        if eventsCursor == nil, !eventsExhausted {
            eventsCursor = page.next_cursor
            eventsExhausted = page.next_cursor == nil
        }
        try await ensureEventsCoverMessages()
    }

    /// Events interleave only once message history is at least as deep, so keep
    /// paging the audit trail until it covers the oldest loaded message.
    private func ensureEventsCoverMessages() async throws {
        guard let oldestMessageAt = messages.last?.created_at else { return }
        var guardCount = 0
        while !eventsExhausted, guardCount < 6 {
            if let oldestEventAt = events.last?.created_at, oldestEventAt <= oldestMessageAt {
                return
            }
            let page = try await repo.events(
                companyId: companyId,
                conversationId: conversationId,
                cursor: eventsCursor
            )
            events = appendPage(events, page.data) { $0.id }
            eventsCursor = page.next_cursor
            if page.next_cursor == nil {
                eventsExhausted = true
                return
            }
            guardCount += 1
        }
    }

    private func refreshPinned() async throws {
        pinnedMessages = try await repo.pinnedMessages(
            companyId: companyId,
            conversationId: conversationId
        ).data
    }

    private func refreshConversationDetail() async throws {
        let detail = try await repo.detail(companyId: companyId, conversationId: conversationId)
        conversation = detail
        messages = mergeMessagesFirstPage(messages, detail.messages.data)
    }

    private func refreshContact() async throws {
        guard let contactId = conversation?.contact_id else { return }
        contact = try await repo.contact(companyId: companyId, contactId: contactId)
    }

    private func refreshGates() {
        Task { try? await self.refreshContact() }
        Task {
            if let me = try? await self.meApi.me(companyId: self.companyId) {
                self.company = me.company
            }
        }
        Task {
            if let usage = try? await self.repo.usage(companyId: self.companyId) {
                self.usage = usage
            }
        }
    }

    /// Reconnect / foreground resync (SPEC §8). MERGE a fresh page 1 — healing a
    /// message a missed/dropped broadcast never delivered — while KEEPING the
    /// pages the user scrolled back to. `.resyncOnForeground` makes this frequent
    /// (an incoming call, the camera, the app switcher), so a page-1 *replace*
    /// would drop loaded history on every foreground; this is the SAME merge the
    /// realtime message path uses (`refreshMessagesFirstPage`). Events/pinned/
    /// contact still refetch as before.
    func refreshAfterReconnect() {
        Task {
            if let detail = try? await repo.detail(
                companyId: companyId,
                conversationId: conversationId
            ) {
                conversation = detail
                messages = mergeMessagesFirstPage(messages, detail.messages.data)
                // Only re-open pagination if we hadn't scrolled yet; a
                // scrolled-back thread keeps its deeper cursor + loaded flag.
                if messagesCursor == nil, detail.messages.next_cursor != nil, !allMessagesLoaded {
                    messagesCursor = detail.messages.next_cursor
                }
            }
            if let page = try? await repo.events(
                companyId: companyId,
                conversationId: conversationId
            ) {
                events = page.data
                eventsCursor = page.next_cursor
                eventsExhausted = page.next_cursor == nil
            }
            try? await refreshPinned()
            try? await refreshContact()
        }
    }

    // MARK: - Realtime

    private func payloadString(_ event: RealtimeEvent, _ key: String) -> String? {
        event.payload[key]?.stringValue
    }

    func onRealtime(_ event: RealtimeEvent) {
        switch event.event {
        case "message.created":
            guard payloadString(event, "conversation_id") == conversationId else { return }
            let direction = payloadString(event, "direction")
            Task {
                try? await self.refreshMessagesFirstPage()
                if direction == MessageDirection.inbound {
                    self.newInboundTick += 1
                    // #233: a customer answering HOLDS anything queued for
                    // them — the API decides that, and the strip has to stop
                    // saying "Sending Tue, 8:00 AM" the moment it does.
                    try? await self.refreshScheduled()
                }
                self.markRead()
            }

        case "message.status":
            guard let id = payloadString(event, "message_id") else { return }
            let index = messages.firstIndex { $0.id == id } ?? -1
            let inPinned = pinnedMessages.contains { $0.id == id }
            if index < 0, !inPinned { return }
            let deep = index >= 50 || (index < 0 && inPinned)
            let payloadKeys = event.payload.objectValue?.keys.map { $0 } ?? []
            Task {
                do {
                    if deep {
                        try await self.refetchLoadedWindow()
                    } else {
                        try await self.refreshMessagesFirstPage()
                    }
                    // Key PRESENCE routes the extra refetches; values are
                    // never trusted — the API rows are.
                    if payloadKeys.contains("pinned_at") { try await self.refreshPinned() }
                    if payloadKeys.contains("done_at") { try await self.refreshEvents() }
                } catch {
                    // Quiet — the next broadcast or reconnect catches up.
                }
            }

        case "conversation.updated":
            guard payloadString(event, "conversation_id") == conversationId else { return }
            // 250ms debounce per SPEC §8 — status/assign/spam/tag/pin bursts
            // collapse into one detail refetch.
            convRefreshTask?.cancel()
            convRefreshTask = Task {
                try? await Task.sleep(for: .milliseconds(250))
                if Task.isCancelled { return }
                try? await self.refreshConversationDetail()
                try? await self.refreshEvents()
                try? await self.refreshPinned()
                try? await self.refreshContact()
            }

        case "task.changed":
            guard payloadString(event, "conversation_id") == conversationId else { return }
            Task {
                try? await self.refreshMessagesFirstPage()
                try? await self.refreshEvents()
            }

        // #607 — the card cleared, and the crew hears it while they are still
        // standing in the driveway. Stripe tells the server, the server writes a
        // `payment_paid` row into `conversation_events`, and (since
        // 20260813110000) the database broadcasts that row. Before it, "Paid"
        // appeared on the NEXT FETCH: opening the thread again, some other
        // mutation, or coming back to the app.
        //
        // TWO THINGS MOVE, because a settled payment shows in two places on this
        // screen. The strip above the composer is one — `paymentChangedTick` is
        // how it hears, since `ThreadPaymentsPane` owns that list. The timeline
        // is the other: the same insert wrote an audit row, and `refreshEvents`
        // is exactly what `task.changed` above does for the same reason.
        //
        // The timeline half only started being worth its round trip in round
        // two. Until #607 A3 that row rendered through `humanizedEventType` as
        // "Payment paid" — a column value with the underscore taken out, no
        // amount, no context — while web rendered no row for it at all. All
        // three clients now narrate the five payment types in the same words
        // (`paymentEventLine`), which is what makes this refetch a fact arriving
        // rather than a label being redrawn.
        //
        // Refunds and disputes ride this event too and want precisely the same
        // two refreshes — which is why the arm keys on the event and not on the
        // `type` discriminator inside it. Nothing here reads that value: the
        // strip renders each row's own state from the API, so branching on the
        // payload would be this client deciding a question the row answers.
        //
        // `payment_request_id` is in the payload and is deliberately unused.
        // There is no route that reads ONE request — the strip renders the list
        // from `GET /v1/conversations/:id/payment-requests` — so the id would
        // only be a value to get wrong. ID-only hint, one list refetch,
        // authorization left on the server: SPEC §8, same as every arm above.
        case "payment.updated":
            guard payloadString(event, "conversation_id") == conversationId else { return }
            // Bumped SYNCHRONOUSLY, ahead of the refetch it triggers. The pane's
            // reload and this refetch are independent reads of two different
            // routes, and neither waits on the other.
            paymentChangedTick += 1
            Task { try? await self.refreshEvents() }

        default:
            break
        }
    }

    // MARK: - Read receipts

    func markRead() {
        Task {
            try? await repo.markRead(companyId: companyId, conversationId: conversationId)
        }
    }

    // MARK: - Sending

    /// Optimistic send: a local queued row appears immediately; the server's
    /// queued insert replaces it. A failed attempt restores the draft and holds
    /// onto its Idempotency-Key — retrying the SAME body+photos reuses the key,
    /// so an airplane-mode double-send lands exactly one message.
    func sendText(
        body: String,
        photos: [StagedPhoto],
        /// #475: the saved reply this was built from, if any.
        templateId: String? = nil,
        /// #274: whether the words changed after it was inserted.
        templateEdited: Bool = false,
        onRestore: @escaping @MainActor () -> Void
    ) {
        let photoIds = photos.map(\.id)
        let key: String
        if let failed = lastFailedIntent, failed.body == body, failed.photoIds == photoIds {
            key = failed.key
        } else {
            key = UUID().uuidString
        }
        let pendingRow = PendingSend(
            localId: key,
            body: body,
            mediaCount: photos.count,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            idempotencyKey: key
        )
        pendingSends.append(pendingRow)
        Task {
            do {
                let message = try await repo.send(
                    companyId: companyId,
                    conversationId: conversationId,
                    body: body,
                    media: photos.isEmpty ? nil : photos.map { $0.toOutboundMedia() },
                    idempotencyKey: key,
                    templateId: templateId,
                    templateEdited: templateEdited
                )
                lastFailedIntent = nil
                pendingSends.removeAll { $0.localId == pendingRow.localId }
                messages = mergeMessagesFirstPage(messages, [message])
                markRead()
            } catch {
                let code = (error as? ApiError)?.code
                // #234: did we REACH the server? That is the whole decision.
                //
                // `network` means we never got an answer, so the message waits
                // for one — it stays in the thread as "Queued" and is written
                // to the durable outbox, which is what makes it survive the
                // app being killed on the walk back to the truck.
                //
                // Photos ride along, as OUR files. The picker's grant would be
                // dead after a relaunch, so the bytes the composer already read
                // are copied into our container first and the row is written
                // only if that copy succeeded — a row promising a photo we
                // cannot produce is worse than an honest failure here.
                if code == ApiErrorCode.network {
                    let stored = outbox.saveMedia(
                        key,
                        photos.map { OutboxMediaBytes(contentType: $0.contentType, bytes: $0.bytes) }
                    )
                    if stored.count == photos.count {
                        outbox.put(
                            QueuedSend(
                                localId: key,
                                companyId: companyId,
                                conversationId: conversationId,
                                body: body,
                                createdAt: pendingRow.createdAt,
                                media: stored
                            )
                        )
                        if let index = pendingSends.firstIndex(where: { $0.localId == key }) {
                            pendingSends[index].queued = true
                        }
                        lastFailedIntent = nil
                        return
                    }
                    // Storage refused us. Fall through to the honest failure
                    // below rather than showing "Queued" over nothing.
                    outbox.remove(key)
                }
                pendingSends.removeAll { $0.localId == pendingRow.localId }
                lastFailedIntent = FailedSendIntent(body: body, photoIds: photoIds, key: key)
                onRestore()
                notify(error.userMessage)
                if code == ApiErrorCode.recipientOptedOut ||
                    code == ApiErrorCode.subscriptionInactive ||
                    code == ApiErrorCode.registrationPending ||
                    code == ApiErrorCode.usageCapReached {
                    refreshGates()
                }
            }
        }
    }

    // MARK: - #234 outbox

    /// Paint the durable queue for this thread back into the timeline.
    private func restoreQueued() {
        let rows = outbox.forConversation(conversationId)
        let restored = rows.map { row in
            PendingSend(
                localId: row.localId,
                body: row.body,
                mediaCount: row.media.count,
                createdAt: row.createdAt,
                idempotencyKey: row.localId,
                queued: !row.blocked,
                blockedReason: row.blocked ? row.lastError : nil
            )
        }
        let known = Set(restored.map(\.localId))
        pendingSends = pendingSends.filter { !known.contains($0.localId) } + restored
    }

    /// Drain the queue. Safe to call from anywhere and as often as you like —
    /// `OutboxFlusher` refuses to start a second pass while one is running, so
    /// an LTE/Wi-Fi handoff firing two callbacks lands one message, not two.
    func flushOutbox() {
        Task { await flushOutboxNow() }
    }

    private func flushOutboxNow() async {
        let flusher = OutboxFlusher(outbox: outbox) { [weak self] item in
            guard let self else { return .unreachable("gone") }
            // The photos, read back from our own container. A file that is
            // gone must NOT become a quiet text-only send: the person attached
            // it for a reason, so the row stops and says so, and "Send now"
            // then sends the words on their own.
            let media = item.media.compactMap { queued in
                self.outbox.readMedia(item.localId, queued).map {
                    OutboundMedia(content_type: queued.contentType, base64: $0.base64EncodedString())
                }
            }
            guard media.count == item.media.count else {
                return .refused(outboxMediaLostMessage)
            }
            do {
                let message = try await self.repo.send(
                    companyId: item.companyId,
                    conversationId: item.conversationId,
                    body: item.body,
                    media: media.isEmpty ? nil : media,
                    // The key minted when the person pressed send, reused on
                    // every attempt — this is what makes the flush idempotent
                    // rather than merely retried.
                    idempotencyKey: item.localId
                )
                if item.conversationId == self.conversationId {
                    self.pendingSends.removeAll { $0.localId == item.localId }
                    self.messages = mergeMessagesFirstPage(self.messages, [message])
                }
                return .sent
            } catch {
                if (error as? ApiError)?.code == ApiErrorCode.network {
                    return .unreachable(error.userMessage)
                }
                return .refused(error.userMessage)
            }
        }
        let result = await flusher.flush()
        if !result.sent.isEmpty { markRead() }
        // Sweep photos left behind by a crash between writing files and writing
        // the row. Cheap, and the alternative is a folder that only ever grows
        // on a phone that is usually short of space.
        outbox.pruneMedia()
        // A refusal changes what the row says, so repaint from the store rather
        // than guessing which one was blocked.
        if !result.blocked.isEmpty {
            restoreQueued()
            refreshGates()
        }
    }

    /// Drop a queued message the person has decided against (#234).
    func discardQueued(_ localId: String) {
        outbox.remove(localId)
        pendingSends.removeAll { $0.localId == localId }
    }

    /// Try a blocked row again, because the person believes the reason is gone
    /// — the cap reset, the registration came back, or the message is old and
    /// they still want it sent. Clears the block so the next flush actually
    /// asks, rather than reporting the old answer.
    func retryQueued(_ localId: String) {
        guard var row = outbox.all().first(where: { $0.localId == localId }) else { return }
        row.blocked = false
        row.lastError = nil
        // Photos whose files are gone are dropped HERE rather than at flush,
        // because the row said "send the text on its own" and this is the
        // person taking it up. Leaving them on would make the next flush refuse
        // for the same reason and the button do nothing.
        row.media = row.media.filter { outbox.readMedia(localId, $0) != nil }
        // They have been told it is old and chose to send it, so the age-out
        // must not stop it again.
        row.staleAcknowledged = true
        outbox.put(row)
        restoreQueued()
        flushOutbox()
    }

    /// Retry a failed row (server-side rules; retryable gate is in the UI).
    func retrySend(_ messageId: String) {
        Task {
            do {
                let updated = try await repo.retry(companyId: companyId, messageId: messageId)
                replaceMessage(updated)
            } catch {
                if (error as? ApiError)?.code == ApiErrorCode.conflict {
                    // #263: SHOW THE SERVER'S SENTENCE, don't replace it. A 409
                    // used to mean one thing — a carrier-finalized row that is
                    // simply not retryable — and a fixed string was fine for it.
                    // It now also means "only 1 of your 3 photos was saved, write
                    // it again and re-attach them", which is actionable and which
                    // a hardcoded line silently threw away. Web has always shown
                    // the server message here; this is the parity fix. The
                    // refresh stays: both cases mean our copy of the row is
                    // behind.
                    notify(error.userMessage)
                    try? await refreshMessagesFirstPage()
                } else {
                    notify(error.userMessage)
                }
            }
        }
    }

    /// Who this member may name on a note here; the server owns the answer.
    func mentionableMembers() async -> [MentionableMember] {
        (try? await repo.mentionableMembers(
            companyId: companyId,
            conversationId: conversationId
        )) ?? []
    }

    /// D28 chain: the note row first, then each staged file against its id.
    func saveNote(
        body: String,
        files: [StagedFile],
        mentionUserIds: [String] = [],
        /// #294: before or after, for the photos arriving on this note.
        workPhase: String? = nil,
        onRestore: @escaping @MainActor () -> Void
    ) {
        Task {
            let note: Message
            do {
                note = try await repo.createNote(
                    companyId: companyId,
                    conversationId: conversationId,
                    body: body,
                    mentionUserIds: mentionUserIds,
                    workPhase: workPhase
                )
            } catch {
                onRestore()
                notify(error.userMessage)
                return
            }
            messages = mergeMessagesFirstPage(messages, [note])
            if files.isEmpty { return }
            var failedCount = 0
            for file in files {
                guard let bytes = await Task.detached(operation: { readStagedFile(file) }).value
                else {
                    failedCount += 1
                    continue
                }
                do {
                    _ = try await uploader.upload(
                        companyId: companyId,
                        noteId: note.id,
                        fileName: file.name,
                        contentType: file.contentType,
                        bytes: bytes
                    )
                } catch {
                    failedCount += 1
                }
                Task.detached { discardStagedFile(file) }
            }
            // Show the note's Files section with whatever landed.
            do {
                let landed = try await repo.noteAttachments(companyId: companyId, noteId: note.id)
                noteFiles[note.id] = .ready(landed.data)
            } catch {
                noteFiles[note.id] = .failed(error.userMessage)
            }
            if failedCount > 0 {
                notify(
                    failedCount == files.count
                        ? "The note saved, but its files didn't upload."
                        : "The note saved, but \(failedCount) of \(files.count) files didn't upload."
                )
            }
        }
    }

    // MARK: - Per-message facets

    private func replaceMessage(_ updated: Message) {
        messages = messages.map { $0.id == updated.id ? updated : $0 }
        pinnedMessages = pinnedMessages.map { $0.id == updated.id ? updated : $0 }
    }

    /// Optimistic done toggle with rollback.
    func toggleDone(_ message: Message) {
        let turningOn = message.done_at == nil
        let optimistic = message.replacingDone(
            doneAt: turningOn ? ISO8601DateFormatter().string(from: Date()) : nil,
            doneBy: turningOn ? meUserId : nil
        )
        replaceMessage(optimistic)
        Task {
            do {
                replaceMessage(
                    try await repo.setDone(companyId: companyId, messageId: message.id, done: turningOn)
                )
                try? await refreshEvents()
            } catch {
                replaceMessage(message)
                notify(error.userMessage)
            }
        }
    }

    func togglePin(_ message: Message) {
        let pinning = message.pinned_at == nil
        Task {
            do {
                replaceMessage(
                    try await repo.setMessagePinned(
                        companyId: companyId,
                        messageId: message.id,
                        pinned: pinning
                    )
                )
                try await refreshPinned()
            } catch {
                notify(error.userMessage)
            }
        }
    }

    /// #214: create the task with the make-task sheet's confirmed title, an
    /// optional due (offset ISO), and an optional structured address. The
    /// address block is null when the user left every field blank.
    func makeTask(
        _ message: Message,
        title: String,
        assignedUserId: String? = nil,
        dueAt: String? = nil,
        address: AddressFieldValues = AddressFieldValues(),
        provenance: String = AddressProvenance.manual
    ) {
        let addressBody = taskAddressBody(address, provenance: provenance)
        Task {
            do {
                let task = try await repo.createTask(
                    companyId: companyId,
                    messageId: message.id,
                    title: title,
                    assignedUserId: assignedUserId,
                    dueAt: dueAt,
                    address: addressBody
                )
                replaceMessage(
                    message.replacingPromotedTask(MessageTaskLink(id: task.id, title: task.title))
                )
                notify("Task created.")
            } catch {
                if (error as? ApiError)?.code == ApiErrorCode.conflict {
                    notify("This message already has a task.")
                    try? await refreshMessagesFirstPage()
                } else {
                    notify(error.userMessage)
                }
            }
        }
    }

    /// #214: the company's enrichment opt-in, for the make-task sheet. Keeps
    /// `companyId` private (the sheet only ever reads through the controller).
    /// Throws-free — a failed read degrades to all-off (no enrichment attempted).
    func aiSettingsForTaskDraft() async -> CompanyAiSettings {
        (try? await repo.aiSettings(companyId: companyId))
            ?? CompanyAiSettings(enrich_task_address: false, enrich_task_due: false)
    }

    /// #214: enrich a make-task draft from the message text (session-cached,
    /// throws-free — the empty enrichment on any failure or blank text).
    func enrichTaskDraft(for message: Message) async -> TaskEnrichment {
        let text = message.body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return TaskEnrichment.empty }
        return await repo.enrichTask(
            companyId: companyId,
            messageId: message.id,
            conversationId: conversationId,
            text: text
        )
    }

    // MARK: - #247 the catch-up

    /// Is this thread long enough, or forgotten for long enough, to be worth a
    /// catch-up?
    ///
    /// The identical rule the server applies before it reserves anything
    /// (`shouldOfferThreadSummary`), so the control is never on screen to answer
    /// "there was nothing to summarise". Computed from the LOADED page, which
    /// makes it a lower bound on a long paged thread — under-offering costs a
    /// scroll somebody was doing anyway, over-offering spends a unit to be told
    /// no.
    var catchUpOffer: ThreadCatchUpOffer {
        threadCatchUpOffer(for: messages)
    }

    /// One tap, one AI unit. Never automatic on open, and never on an inbound.
    ///
    /// A thread is the largest input this product hands a model, and a trigger
    /// that fired on new messages would make the spend scale with the CUSTOMER's
    /// behaviour rather than the crew's. Re-entrancy is refused for the same
    /// reason a re-roll is: every ask is real money.
    func askForCatchUp() {
        if catchUp.isLoading { return }
        // `asking()` rather than a `.loading` written here: the pending state
        // keeps the carrier standing the last answer carried. A STOP is not
        // Lou's to withdraw and does not stop being true while a second request
        // is in flight — see `ThreadCatchUpState`.
        catchUp = catchUp.asking()
        catchUpOutcomeReported = false
        Task {
            let answer = await repo.summarizeThread(
                companyId: companyId,
                conversationId: conversationId
            )
            // `answered(...)` for the same reason, one hop later and worse: an
            // ask that was rejected came back with no response to read a
            // standing from, and a phase assembled here out of one would state
            // that the carrier is fine — permanently, rather than for the length
            // of a request. See `ThreadCatchUpAnswer`.
            catchUp = catchUp.answered(answer)
        }
    }

    /// Put the card away. Nothing is re-fetched if it is asked for again within
    /// the same open thread — the server's cache answers for free.
    ///
    /// `putAway()` rather than a bare `.idle`, because this is the FIRST half of
    /// a re-ask on this client: a shown card has a Hide and no ask control, so
    /// every second request goes through here. Dropping the carrier standing at
    /// this hop would lose it before `asking()` ever ran.
    func hideCatchUp() {
        catchUp = catchUp.putAway()
    }

    /// #431/#247: somebody tapped a line through to the message it cites.
    ///
    /// The one observable outcome this feature has, and the reason it is the
    /// POSITIVE one: the citation that makes a catch-up safe was actually used.
    /// Reported once per catch-up (see `catchUpOutcomeReported`).
    func reportCatchUpOpened() {
        guard !catchUpOutcomeReported else { return }
        catchUpOutcomeReported = true
        reportAiOutcome(
            feature: AiOutcome.featureThreadSummary,
            outcome: AiOutcome.openedCitedMessage
        )
    }

    /// #431: record what a human did with one piece of AI output.
    ///
    /// Detached so it can never delay the create or send it describes, and the
    /// repository swallows every failure — losing an outcome costs a data point,
    /// interrupting somebody mid-job costs a job. Lives here rather than in the
    /// view so `companyId` stays private.
    func reportAiOutcome(feature: String, outcome: String) {
        Task { [repo, companyId] in
            await repo.reportAiOutcome(
                companyId: companyId,
                feature: feature,
                outcome: outcome
            )
        }
    }

    // MARK: - Conversation controls

    private func applyConversationRow(_ row: Conversation) {
        conversation = conversation?.applying(row)
    }

    func setStatus(_ status: String) {
        Task {
            do {
                applyConversationRow(
                    try await repo.setStatus(
                        companyId: companyId,
                        conversationId: conversationId,
                        status: status
                    )
                )
                try? await refreshEvents()
            } catch {
                notify(error.userMessage)
            }
        }
    }

    func setAssignee(_ userId: String?) {
        Task {
            do {
                applyConversationRow(
                    try await repo.setAssignee(
                        companyId: companyId,
                        conversationId: conversationId,
                        userId: userId
                    )
                )
                try? await refreshEvents()
            } catch {
                notify(error.userMessage)
            }
        }
    }

    /// #301: the workspace's own source list, for the panel's picker.
    func leadSources() async throws -> [LeadSource] {
        try await repo.leadSources(companyId: companyId)
    }

    /**
     #301: where this customer came from, as a person answered it.

     Returns the updated row rather than only applying it, because the picker
     needs the ORIGIN back — the server decides that a person's answer reads as
     'manual', and a client that assumed it would be inventing the one
     distinction the report depends on.
     */
    @discardableResult
    func setLeadSource(_ leadSourceId: String?) async throws -> Conversation {
        let next = try await repo.setLeadSource(
            companyId: companyId,
            conversationId: conversationId,
            leadSourceId: leadSourceId
        )
        applyConversationRow(next)
        return next
    }

    func setSpam(_ spam: Bool) {
        Task {
            do {
                applyConversationRow(
                    try await repo.setSpam(
                        companyId: companyId,
                        conversationId: conversationId,
                        spam: spam
                    )
                )
                try? await refreshEvents()
                if spam {
                    notify("Marked as spam.", actionLabel: "Undo") { [weak self] in
                        self?.setSpam(false)
                    }
                } else {
                    notify("Marked as not spam. It stays closed.")
                }
            } catch {
                notify(error.userMessage)
            }
        }
    }

    /// #250 — the crew looked, and it is a real customer.
    ///
    /// No undo offered, unlike `setSpam`: the server accepts only false, so
    /// there would be nothing for an Undo to call. An action that cannot be
    /// reversed should not advertise that it can.
    func clearSpamSuspicion() {
        Task {
            do {
                applyConversationRow(
                    try await repo.clearSpamSuspicion(
                        companyId: companyId,
                        conversationId: conversationId
                    )
                )
                notify("Thanks. We won't flag this one.")
            } catch {
                notify(error.userMessage)
            }
        }
    }

    /// #293 — defer this thread out of MY inbox until `untilISO`.
    ///
    /// Reversible in one tap and cancelled outright by a customer reply, so the
    /// toast confirms rather than offering an undo — and it says WHEN it comes
    /// back, because "Snoozed" alone leaves the crew guessing what they just
    /// agreed to.
    func snooze(
        untilISO: String,
        note: String? = nil,
        kind: DeferralKind = .snooze
    ) {
        Task {
            do {
                try await repo.snooze(
                    companyId: companyId,
                    conversationId: conversationId,
                    untilISO: untilISO,
                    note: note,
                    kind: kind
                )
                conversation?.snoozed_until = untilISO
                conversation?.snooze_note = note
                conversation?.snooze_kind = kind.rawValue
                notify(
                    snoozeReturnLabel(untilISO)
                        .replacingOccurrences(
                            of: "Back",
                            with: kind == .followUp
                                ? "I'll remind you — back" : "Snoozed — back"
                        )
                )
            } catch {
                notify(error.userMessage)
            }
        }
    }

    /// #293 — bring it back now. Idempotent, so one tap is always safe.
    func unsnooze() {
        Task {
            do {
                try await repo.unsnooze(
                    companyId: companyId,
                    conversationId: conversationId
                )
                let wasFollowUp =
                    conversation?.snooze_kind == DeferralKind.followUp.rawValue
                conversation?.snoozed_until = nil
                conversation?.snooze_note = nil
                conversation?.snooze_kind = nil
                notify(wasFollowUp ? "Reminder cancelled." : "Back in your inbox.")
            } catch {
                notify(error.userMessage)
            }
        }
    }

    func toggleConversationPin() {
        let pinning = conversation?.pinned_at == nil
        Task {
            do {
                applyConversationRow(
                    try await repo.setConversationPinned(
                        companyId: companyId,
                        conversationId: conversationId,
                        pinned: pinning
                    )
                )
            } catch {
                notify(error.userMessage)
            }
        }
    }

    func optOutContact() {
        guard let contactId = conversation?.contact_id else { return }
        Task {
            do {
                _ = try await repo.optOut(companyId: companyId, contactId: contactId)
                try? await refreshContact()
                try? await refreshEvents()
            } catch {
                notify(error.userMessage)
            }
        }
    }

    func revokeOptOut() {
        guard let contactId = conversation?.contact_id else { return }
        Task {
            do {
                _ = try await repo.revokeOptOut(companyId: companyId, contactId: contactId)
                try? await refreshContact()
                try? await refreshEvents()
            } catch {
                notify(error.userMessage)
            }
        }
    }

    // MARK: - Tags

    /// Attach by plan (an existing tag or create-on-attach by name), then
    /// refetch the detail — the tags row renders from server rows, never from
    /// an optimistic guess (the server may have matched an existing tag
    /// case-insensitively).
    func attachTag(_ plan: TagAttachPlan) {
        Task {
            do {
                switch plan {
                case .existing(let tag):
                    _ = try await repo.attachTag(
                        companyId: companyId,
                        conversationId: conversationId,
                        tagId: tag.id
                    )
                case .createNew(let name):
                    _ = try await repo.attachTagByName(
                        companyId: companyId,
                        conversationId: conversationId,
                        name: name
                    )
                }
                try? await refreshConversationDetail()
                try? await refreshEvents()
            } catch {
                notify(error.userMessage)
            }
        }
    }

    func detachTag(_ tag: Tag) {
        // Optimistic remove — a chip that lingers after the tap feels broken.
        let before = conversation
        conversation = before?.replacingTags((before?.tags ?? []).filter { $0.id != tag.id })
        Task {
            do {
                try await repo.detachTag(
                    companyId: companyId,
                    conversationId: conversationId,
                    tagId: tag.id
                )
                try? await refreshEvents()
            } catch {
                if (error as? ApiError)?.code == ApiErrorCode.notFound {
                    // Already detached elsewhere — the optimistic state is right.
                    try? await refreshConversationDetail()
                } else {
                    conversation = before
                    notify(error.userMessage)
                }
            }
        }
    }

    // MARK: - Contact panel

    /// Load the sheet's secondary lists; refreshes on every open.
    func loadContactPanel() {
        if let phone = conversation?.contact.phone_e164 {
            otherConversations = .loading
            Task {
                do {
                    let rows = try await repo.conversationsForPhone(
                        companyId: companyId,
                        phoneE164: phone
                    ).data.filter { $0.id != conversationId }
                    otherConversations = .ready(rows)
                } catch {
                    otherConversations = .failed(error.userMessage)
                }
            }
        }
        conversationTasks = .loading
        Task {
            do {
                conversationTasks = .ready(
                    try await repo.conversationTasks(
                        companyId: companyId,
                        conversationId: conversationId
                    ).data
                )
            } catch {
                conversationTasks = .failed(error.userMessage)
            }
        }
    }

    /// One contact field write for the sheet's auto-save (the G6 800ms clock
    /// lives in the field view). Refreshes the header/consent line on success;
    /// throws so the field shows its calm failure sentence.
    func saveContactField(_ field: String, _ value: String?) async throws {
        guard let contactId = conversation?.contact_id else { return }
        let previous = contact
        var saved = try await contacts.updateField(
            companyId: companyId,
            contactId: contactId,
            field: field,
            value: value
        )
        // #505: PATCH echoes the stored COLUMNS and nothing derived — the
        // relationship counts are computed only in the GET handler
        // (apps/api/src/routes/contacts.ts). Assigning the response wholesale
        // therefore blanked `conversation_count`, so editing a name made the
        // header's repeat chip — and the contact sheet's "Customer since"
        // line, which is #410 and shipped — disappear until a refetch.
        saved.conversation_count =
            previous?.conversation_count ?? saved.conversation_count
        saved.first_conversation_at =
            previous?.first_conversation_at ?? saved.first_conversation_at
        contact = saved
        try? await refreshConversationDetail()
    }

    /// Checklist toggle — completion is ALWAYS the source message's done bit
    /// (PATCH /v1/messages/:id), never a task route. Optimistic with rollback.
    func toggleTaskDone(_ task: TaskItem) {
        guard case .ready(let rows)? = conversationTasks else { return }
        let turningOn = !task.done
        func swap(_ rows: [TaskItem], _ value: Bool) -> [TaskItem] {
            rows.map { $0.id == task.id ? $0.replacingDone(value) : $0 }
        }
        conversationTasks = .ready(swap(rows, turningOn))
        Task {
            do {
                _ = try await repo.setDone(
                    companyId: companyId,
                    messageId: task.message_id,
                    done: turningOn
                )
                try? await refreshMessagesFirstPage()
                try? await refreshEvents()
            } catch {
                if case .ready(let current)? = conversationTasks {
                    conversationTasks = .ready(swap(current, task.done))
                }
                notify(error.userMessage)
            }
        }
    }

    // MARK: - Note files + pinned jump

    func loadNoteFiles(_ noteId: String) {
        if noteFiles[noteId] != nil { return }
        noteFiles[noteId] = .loading
        Task {
            do {
                let page = try await repo.noteAttachments(companyId: companyId, noteId: noteId)
                noteFiles[noteId] = .ready(page.data)
            } catch {
                noteFiles[noteId] = .failed(error.userMessage)
            }
        }
    }

    /// Page back (bounded) until `messageId` is loaded; true when found.
    func ensureMessageLoaded(_ messageId: String) async -> Bool {
        var guardCount = 0
        while !messages.contains(where: { $0.id == messageId }),
              let cursor = messagesCursor,
              guardCount < 20 {
            do {
                let page = try await repo.messages(
                    companyId: companyId,
                    conversationId: conversationId,
                    cursor: cursor
                )
                messages = appendPage(messages, page.data) { $0.id }
                messagesCursor = page.next_cursor
                if page.next_cursor == nil { allMessagesLoaded = true }
            } catch {
                notify(error.userMessage)
                return false
            }
            guardCount += 1
        }
        try? await ensureEventsCoverMessages()
        return messages.contains { $0.id == messageId }
    }
}

// MARK: - Wire-model copy helpers (models are lets; rebuild via memberwise init)

extension ConversationDetail {
    /// The optimistic tag-detach local copy.
    func replacingTags(_ tags: [Tag]) -> ConversationDetail {
        ConversationDetail(
            id: id,
            company_id: company_id,
            contact_id: contact_id,
            phone_number_id: phone_number_id,
            status: status,
            is_spam: is_spam,
            assigned_user_id: assigned_user_id,
            pinned_at: pinned_at,
            pinned_by_user_id: pinned_by_user_id,
            last_message_at: last_message_at,
            closed_at: closed_at,
            opt_out_hint_at: opt_out_hint_at,
            created_at: created_at,
            updated_at: updated_at,
            contact: contact,
            tags: tags,
            // #293: carried explicitly. These rebuild the whole struct through
            // the memberwise init, so a field omitted here is a field SILENTLY
            // CLEARED — pinning a deferred thread would have made its snooze
            // banner vanish while the server still had it deferred.
            snoozed_until: snoozed_until,
            snooze_note: snooze_note,
            snooze_kind: snooze_kind,
            messages: messages,
            viewer_level: viewer_level,
            destination_clock: destination_clock,
            spam_suspected_at: spam_suspected_at,
            spam_signals: spam_signals
        )
    }

    /// Apply a PATCH response row onto the detail (the fields the row owns).
    func applying(_ row: Conversation) -> ConversationDetail {
        ConversationDetail(
            id: id,
            company_id: company_id,
            contact_id: contact_id,
            phone_number_id: phone_number_id,
            status: row.status,
            is_spam: row.is_spam,
            assigned_user_id: row.assigned_user_id,
            pinned_at: row.pinned_at,
            pinned_by_user_id: row.pinned_by_user_id,
            last_message_at: last_message_at,
            closed_at: row.closed_at,
            opt_out_hint_at: opt_out_hint_at,
            created_at: created_at,
            updated_at: row.updated_at,
            contact: contact,
            tags: tags,
            // #293: carried explicitly. These rebuild the whole struct through
            // the memberwise init, so a field omitted here is a field SILENTLY
            // CLEARED — pinning a deferred thread would have made its snooze
            // banner vanish while the server still had it deferred.
            snoozed_until: snoozed_until,
            snooze_note: snooze_note,
            // Carried for the same reason, and each of these was being
            // silently cleared until #250 went looking: a status, assign,
            // spam or pin PATCH rebuilt the struct without them, so the
            // opt-out warning, the follow-up kind and the customer's clock
            // all vanished from a thread the server still had them on.
            snooze_kind: snooze_kind,
            messages: messages,
            viewer_level: viewer_level,
            destination_clock: destination_clock,
            spam_suspected_at: spam_suspected_at,
            spam_signals: spam_signals
        )
    }
}

extension Message {
    /// The optimistic done toggle's local copy.
    func replacingDone(doneAt: String?, doneBy: String?) -> Message {
        Message(
            id: id,
            conversation_id: conversation_id,
            direction: direction,
            body: body,
            status: status,
            segments: segments,
            encoding: encoding,
            sent_by_user_id: sent_by_user_id,
            error_code: error_code,
            error_detail: error_detail,
            telnyx_message_id: telnyx_message_id,
            done_at: doneAt,
            done_by_user_id: doneBy,
            pinned_at: pinned_at,
            pinned_by_user_id: pinned_by_user_id,
            created_at: created_at,
            attachments: attachments,
            has_task: has_task,
            promoted_task: promoted_task,
            task_id: task_id,
            task: task
        )
    }
}

extension TaskItem {
    /// The contact-panel checklist's optimistic done toggle (`done`/`status`
    /// are DERIVED from the source message server-side; this is the local echo).
    func replacingDone(_ done: Bool) -> TaskItem {
        TaskItem(
            id: id,
            company_id: company_id,
            message_id: message_id,
            conversation_id: conversation_id,
            title: title,
            description: description,
            assigned_user_id: assigned_user_id,
            due_at: due_at,
            created_by_user_id: created_by_user_id,
            created_at: created_at,
            updated_at: updated_at,
            done: done,
            status: done ? "done" : "open",
            contact: contact,
            attachment_count: attachment_count,
            addr_street: addr_street,
            addr_unit: addr_unit,
            addr_city: addr_city,
            addr_state: addr_state,
            addr_postal_code: addr_postal_code,
            addr_country: addr_country,
            addr_provenance: addr_provenance
        )
    }
}

extension Message {
    /// The "Make a task" local echo (has_task + the link chip).
    func replacingPromotedTask(_ link: MessageTaskLink) -> Message {
        Message(
            id: id,
            conversation_id: conversation_id,
            direction: direction,
            body: body,
            status: status,
            segments: segments,
            encoding: encoding,
            sent_by_user_id: sent_by_user_id,
            error_code: error_code,
            error_detail: error_detail,
            telnyx_message_id: telnyx_message_id,
            done_at: done_at,
            done_by_user_id: done_by_user_id,
            pinned_at: pinned_at,
            pinned_by_user_id: pinned_by_user_id,
            created_at: created_at,
            attachments: attachments,
            has_task: true,
            promoted_task: link,
            task_id: task_id,
            task: task
        )
    }
}
