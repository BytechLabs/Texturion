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
    private let meUserId: String

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
    private(set) var members: [Member] = []
    private(set) var contact: Contact?
    private(set) var company: CompanyView?
    private(set) var usage: Usage?
    var filter = ThreadFilter()
    private(set) var notice: ThreadNotice?

    /// Bumps when an inbound message lands while this thread is open.
    private(set) var newInboundTick = 0

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
    func mintAttachmentUrl(_ attachmentId: String) async throws -> String {
        try await repo.attachmentUrl(companyId: companyId, attachmentId: attachmentId).url
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
    func notifyExternally(_ text: String) {
        notify(text)
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
        messages = mergeFirstPage(messages, page.data, idOf: { $0.id }, sortKey: { $0.created_at })
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
        messages = mergeFirstPage(
            messages,
            detail.messages.data,
            idOf: { $0.id },
            sortKey: { $0.created_at }
        )
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
                messages = mergeFirstPage(
                    messages,
                    detail.messages.data,
                    idOf: { $0.id },
                    sortKey: { $0.created_at }
                )
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
                if direction == MessageDirection.inbound { self.newInboundTick += 1 }
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
    func sendText(body: String, photos: [StagedPhoto], onRestore: @escaping @MainActor () -> Void) {
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
                    idempotencyKey: key
                )
                lastFailedIntent = nil
                pendingSends.removeAll { $0.localId == pendingRow.localId }
                messages = mergeFirstPage(
                    messages,
                    [message],
                    idOf: { $0.id },
                    sortKey: { $0.created_at }
                )
                markRead()
            } catch {
                pendingSends.removeAll { $0.localId == pendingRow.localId }
                lastFailedIntent = FailedSendIntent(body: body, photoIds: photoIds, key: key)
                onRestore()
                notify(error.userMessage)
                let code = (error as? ApiError)?.code
                if code == ApiErrorCode.recipientOptedOut ||
                    code == ApiErrorCode.subscriptionInactive ||
                    code == ApiErrorCode.registrationPending ||
                    code == ApiErrorCode.usageCapReached {
                    refreshGates()
                }
            }
        }
    }

    /// Retry a failed row (server-side rules; retryable gate is in the UI).
    func retrySend(_ messageId: String) {
        Task {
            do {
                let updated = try await repo.retry(companyId: companyId, messageId: messageId)
                replaceMessage(updated)
            } catch {
                if (error as? ApiError)?.code == ApiErrorCode.conflict {
                    notify("This message can't be retried.")
                    try? await refreshMessagesFirstPage()
                } else {
                    notify(error.userMessage)
                }
            }
        }
    }

    /// D28 chain: the note row first, then each staged file against its id.
    func saveNote(body: String, files: [StagedFile], onRestore: @escaping @MainActor () -> Void) {
        Task {
            let note: Message
            do {
                note = try await repo.createNote(
                    companyId: companyId,
                    conversationId: conversationId,
                    body: body
                )
            } catch {
                onRestore()
                notify(error.userMessage)
                return
            }
            messages = mergeFirstPage(messages, [note], idOf: { $0.id }, sortKey: { $0.created_at })
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
        contact = try await contacts.updateField(
            companyId: companyId,
            contactId: contactId,
            field: field,
            value: value
        )
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
            created_at: created_at,
            updated_at: updated_at,
            contact: contact,
            tags: tags,
            messages: messages,
            viewer_level: viewer_level
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
            created_at: created_at,
            updated_at: row.updated_at,
            contact: contact,
            tags: tags,
            messages: messages,
            viewer_level: viewer_level
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
