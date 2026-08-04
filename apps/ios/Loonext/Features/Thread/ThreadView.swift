import SwiftUI

/// One conversation: header (identity → contact panel, Call, status,
/// assignee, overflow) → tags row → interleaved timeline (newest-first,
/// flipped scroll so index 0 is the bottom) → composer or gate banner.
/// State-based detail screen — callers own the "which conversation is open"
/// state, mirroring the Android ThreadScreen.
@MainActor
struct ThreadView: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    let conversationId: String
    /// Search-result jump target: scroll to + flash this message once it is in
    /// the timeline (#186 item 2). Nil for an ordinary open.
    var highlightMessageId: String? = nil
    let onBack: @MainActor () -> Void

    @State private var controller: ThreadController?
    @State private var composer: ComposerState?

    var body: some View {
        Group {
            if let controller, let composer {
                ThreadBody(
                    graph: graph,
                    controller: controller,
                    composer: composer,
                    me: me,
                    highlightMessageId: highlightMessageId,
                    onBack: onBack
                )
            } else {
                CenteredLoading()
            }
        }
        .task(id: conversationId) {
            if controller?.conversationId != conversationId {
                let repo = MessagingRepository(api: graph.api)
                let created = ThreadController(
                    repo: repo,
                    meApi: graph.meApi,
                    uploader: NoteFileUploader(
                        sessionStore: graph.sessionStore,
                        meApi: graph.meApi
                    ),
                    contacts: ContactMutations(
                        api: graph.api,
                        multipart: MultipartClient(api: graph.api, sessionStore: graph.sessionStore)
                    ),
                    companyId: companyId,
                    conversationId: conversationId,
                    meUserId: me.user_id
                )
                controller = created
                composer = ComposerState(draftKey: conversationId, drafts: ComposerDrafts())
                created.start()
            }
        }
        .task(id: conversationId) {
            for await event in await graph.realtime.events() {
                controller?.onRealtime(event)
            }
        }
        .task(id: conversationId) {
            for await _ in await graph.realtime.reconnected() {
                controller?.refreshAfterReconnect()
                // #234: the socket re-JOINing IS this app's "signal came back"
                // signal, already plumbed and already torn down with the view.
                // It covers the case a foreground return does not — the phone
                // regaining bars while the thread is open in someone's hand —
                // without a second NWPathMonitor per opened thread, which is
                // what a controller-owned one would have cost.
                controller?.flushOutbox()
            }
        }
        // #215 Part A: a frame missed while this thread was backgrounded/blurred
        // (the #215 repro) self-heals on return — the same page-1 refetch the
        // socket re-JOIN runs.
        .resyncOnForeground {
            controller?.refreshAfterReconnect()
            // #234: coming back to the app is the most common moment the bars
            // came back too — the walk out of the basement to the truck.
            controller?.flushOutbox()
        }
    }
}

/// The loaded thread — split out so the controller is non-optional inside.
/// The chained detail sheets off the thread header (#186 item 3). One
/// `.sheet(item:)` swaps between them in place, so the conversation card's
/// "View contact" / "Assign" rows can open the next sheet without the
/// dismiss-then-present flicker two separate presentations would cause.
private enum ThreadDetailSheet: Identifiable {
    case conversation
    case contactPanel
    case assignee

    var id: String {
        switch self {
        case .conversation: "conversation"
        case .contactPanel: "contact"
        case .assignee: "assignee"
        }
    }
}

@MainActor
private struct ThreadBody: View {
    let graph: AppGraph
    @Bindable var controller: ThreadController
    let composer: ComposerState
    let me: Me
    let highlightMessageId: String?
    let onBack: @MainActor () -> Void

    /// #520: is there a job on this thread due TODAY?
    ///
    /// Asked here rather than in the composer, which stays presentational —
    /// and "today" is the DEVICE's day, because the person tapping is standing
    /// somewhere and means their today, not the workspace's.
    ///
    /// A failed read leaves it false, so the affordance simply does not
    /// appear. Offering it and having the send find no job would be worse than
    /// not offering it at all.
    @State private var hasJobToday = false
    @State private var makeTaskFor: Message?
    @State private var detailSheet: ThreadDetailSheet?
    @State private var confirmOptOut = false
    @State private var confirmRevoke = false
    @State private var confirmDiscardQueued: PendingSend?
    @State private var showNewPill = false
    /// #302: who else is on this thread, and this viewer's typing window.
    @State private var presenceByTopic: [String: PresenceMap] = [:]
    @State private var presenceNow = Date().timeIntervalSince1970
    @State private var typingUntilMs = 0
    @State private var lastTypingSentMs = 0
    @State private var isAtBottom = true
    @State private var jumpToMessageId: String?
    /// The message to FLASH (search-result indication); cleared after ~2.2s.
    @State private var flashMessageId: String?
    @State private var visibleNotice: ThreadNotice?
    @State private var noticeDismissTask: Task<Void, Never>?
    @State private var tagSheetOpen = false
    @State private var galleryOpen = false
    @State private var placingCall = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        ZStack(alignment: .bottom) {
            content
            if let notice = visibleNotice {
                ToastView(notice: notice) {
                    visibleNotice = nil
                }
                .padding(.bottom, 90)
            }
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        .onChange(of: controller.notice?.id) { _, _ in
            guard let notice = controller.notice else { return }
            visibleNotice = notice
            noticeDismissTask?.cancel()
            noticeDismissTask = Task {
                try? await Task.sleep(for: .seconds(notice.actionLabel == nil ? 3 : 5))
                if !Task.isCancelled { visibleNotice = nil }
            }
        }
        // Mark read on open and again whenever the newest message id changes.
        .task(id: controller.newestMessageId ?? "") {
            controller.markRead()
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    @ViewBuilder
    private var content: some View {
        switch controller.load {
        case .loading:
            CenteredLoading()
        case .failed(let message):
            if controller.loadErrorCode == ApiErrorCode.notFound {
                VStack(spacing: 12) {
                    Text("This conversation doesn't exist or was removed.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("Back to inbox", action: onBack)
                        .buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                CenteredError(message: message) { controller.retryInitialLoad() }
            }
        case .ready:
            loaded
        }
    }

    @ViewBuilder
    private var loaded: some View {
        if let detail = controller.conversation {
            let names = memberNames(controller.members)
            let contactName = detail.contact.name ?? formatPhone(detail.contact.phone_e164)

            VStack(spacing: 0) {
                ThreadHeader(
                    controller: controller,
                    detail: detail,
                    contactName: contactName,
                    phoneLabel: formatPhone(detail.contact.phone_e164),
                    meUserId: me.user_id,
                    calling: placingCall,
                    onBack: onBack,
                    onOpenSheet: { detailSheet = .conversation },
                    onCall: { startCall(detail: detail, contactName: contactName) }
                )

                ThreadTagsRow(
                    tags: detail.tags,
                    onManage: { tagSheetOpen = true },
                    onRemove: { controller.detachTag($0) }
                )

                // #250: the classifier's only visible effect. It suppressed
                // a push and nothing else, so without this the thread simply
                // went quiet for a reason nobody could see. Above the snooze
                // banner: "is this even a customer" outranks "when does this
                // come back".
                if detail.spam_suspected_at != nil {
                    SpamSuspectedBanner(
                        reasons: (detail.spam_signals ?? []).map(\.why),
                        // Clearing it PATCHes the thread, which read_only
                        // cannot do. The reasons stay readable either way.
                        canAct: me.memberships
                            .first { $0.company_id == detail.company_id }?.role
                            != MemberRole.readOnly,
                        onNotSpam: { controller.clearSpamSuspicion() }
                    )
                }

                // #293: a deferred thread says so IN PLACE, with a one-tap
                // way back. The alternative is opening a thread you snoozed,
                // seeing nothing, and finding it gone from the inbox again an
                // hour later — a state the app knew about and did not mention.
                if let until = detail.snoozed_until, isSnoozed(until) {
                    SnoozedBanner(label: snoozeReturnLabel(until)) {
                        controller.unsnooze()
                    }
                }

                if !controller.pinnedMessages.isEmpty {
                    PinnedBanner(pinned: controller.pinnedMessages) { messageId in
                        Task {
                            if await controller.ensureMessageLoaded(messageId) {
                                jumpToMessageId = messageId
                            }
                        }
                    }
                }

                timelinePane(names: names, contactName: contactName)

                presenceStrip(detail: detail)
                // #233: what this thread is about to say. Above the composer
                // and below the transcript, because a scheduled message is not
                // a message — it has no delivery status and may never become
                // one, and putting it in the history would mean a reader has to
                // check a badge before believing anything above the fold
                // actually went. Rendered outside the banner branch so a HELD
                // text still says why: a banner means something is wrong with
                // sending, which is exactly when a queued text is stuck and
                // most needs saying out loud.
                // #244: above the scheduled strip, because this is the only
                // thing on the screen with a clock running on it — somebody is
                // waiting for a callback, and if nobody claims it the alert
                // widens to the whole crew.
                AlertBanner(
                    alert: detail.open_alert,
                    viewerId: me.user_id
                ) { id in
                    controller.acknowledgeAlert(id)
                }
                ScheduledStrip(rows: controller.scheduled) { id in
                    controller.cancelScheduled(id)
                }
                composerPane(detail: detail)
            }
        // #302: presence for as long as this thread is on screen.
        .task(id: controller.conversationId) {
            guard let detail = controller.conversation else { return }
            let numberId = detail.phone_number_id
            await graph.realtime.joinPresence(numberId: numberId)
            announcePresence(typing: false)
            defer {
                // Leaving stops the announcement immediately rather than waiting
                // out the TTL — "promptly" is the acceptance criterion, and 45
                // seconds of a ghost is not prompt.
                Task { await graph.realtime.leavePresence(numberId: numberId) }
            }
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(PresenceTiming.heartbeatMs))
                if Task.isCancelled { break }
                let nowMs = Int(Date().timeIntervalSince1970 * 1000)
                announcePresence(typing: nowMs < typingUntilMs)
            }
        }
        // A faster tick purely for staleness: a viewer who simply stops speaking
        // must leave the screen, and on a quiet thread nothing else would
        // trigger that. Cheap, and it fetches nothing.
        .task(id: controller.conversationId) {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                presenceNow = Date().timeIntervalSince1970
            }
        }
        .task(id: controller.conversationId) {
            for await snapshot in await graph.realtime.presence() {
                presenceByTopic = snapshot
                presenceNow = Date().timeIntervalSince1970
            }
        }
        // #520: is there a job on this thread due today? The composer's
        // affordance hangs on it, and a failed read leaves it hidden — offering
        // the control and then finding no job is worse than not offering it.
        //
        // In ThreadBody, beside the state it writes. It was first written into
        // ThreadView, which owns neither the state nor the composer: the diff
        // hunk read correctly and only the compiler disagreed.
        .task(id: controller.conversationId) {
            let startOfDay = Calendar.current.startOfDay(for: Date())
            guard
                let endOfDay = Calendar.current.date(
                    byAdding: .day, value: 1, to: startOfDay
                )
            else { return }
            let iso = ISO8601DateFormatter()
            // `controller`, not `detail`: `detail` is bound INSIDE `body` by
            // `if let detail = controller.conversation`, so it does not exist
            // out here in the modifier chain. Caught by listing where each
            // name is actually declared rather than by reading the hunk.
            guard let companyId = controller.conversation?.company_id else {
                return
            }
            let page = try? await graph.tasksApi.list(
                companyId: companyId,
                filters: TaskListFilters(
                    status: "open",
                    conversationId: controller.conversationId,
                    dueBefore: iso.string(from: endOfDay),
                    dueAfter: iso.string(from: startOfDay)
                ),
                limit: 1
            )
            hasJobToday = !(page?.data.isEmpty ?? true)
        }
            // One swappable sheet: the conversation card and the two surfaces it
            // opens one tap deeper (contact panel, assignee picker).
            .sheet(item: $detailSheet) { which in
                switch which {
                case .conversation:
                    ConversationSheet(
                        controller: controller,
                        detail: detail,
                        contactName: contactName,
                        onOpenContactPanel: { detailSheet = .contactPanel },
                        onAssign: { detailSheet = .assignee },
                        onOpenGallery: { detailSheet = nil; galleryOpen = true },
                        onOptOut: { detailSheet = nil; confirmOptOut = true },
                        onRevokeOptOut: { detailSheet = nil; confirmRevoke = true },
                        onRefresh: { detailSheet = nil; controller.refreshAfterReconnect() },
                        onDismiss: { detailSheet = nil }
                    )
                case .contactPanel:
                    ContactPanelSheet(
                        controller: controller,
                        members: controller.members,
                        onOpenConversation: { conversationId in
                            detailSheet = nil
                            // The shell pushes the thread ABOVE the current one.
                            AppRouter.shared.openConversationId = conversationId
                        },
                        onOpenTask: { taskId in
                            // #217: dismiss the panel, then push the task detail
                            // ABOVE this thread (the shell's openTaskId route).
                            detailSheet = nil
                            AppRouter.shared.openTaskId = taskId
                        },
                        onOpenContact: { contactId in
                            // #465: the panel holds a copy of the contact's
                            // fields; the contact SCREEN holds its history, its
                            // calls and every conversation. Same dismiss-then-
                            // push route the two rows above use.
                            detailSheet = nil
                            AppRouter.shared.openContactId = contactId
                        }
                    )
                case .assignee:
                    AssigneePickerSheet(
                        members: controller.members,
                        meUserId: me.user_id,
                        selectedUserId: detail.assigned_user_id
                    ) { userId in
                        detailSheet = nil
                        if userId != detail.assigned_user_id {
                            controller.setAssignee(userId)
                        }
                    }
                }
            }
            .sheet(isPresented: $tagSheetOpen) {
                TagManageSheet(
                    repo: controller.repo,
                    companyId: detail.company_id,
                    attached: detail.tags,
                    // #298: a workspace that keeps a set list hides Create here
                    // rather than failing it. Defaults to allowed while the
                    // company is still loading — the server is the gate, and an
                    // affordance that flickers off is worse than one that
                    // occasionally has to say no.
                    mayCreate: controller.company?.tags_locked != true
                        || MemberRole.has(
                            me.memberships
                                .first { $0.company_id == detail.company_id }?.role,
                            Capability.settingsManage
                        ),
                    onAttach: { controller.attachTag($0) },
                    onDetach: { controller.detachTag($0) }
                )
            }
            .fullScreenCover(isPresented: $galleryOpen) {
                AttachmentsGalleryView(
                    repo: controller.repo,
                    companyId: detail.company_id,
                    conversationId: controller.conversationId,
                    contactName: contactName,
                    onBack: { galleryOpen = false }
                )
            }
            .alert("Opt this customer out?", isPresented: $confirmOptOut) {
                Button("Cancel", role: .cancel) {}
                Button("Opt out") { controller.optOutContact() }
            } message: {
                Text(
                    "They won't receive texts from you until the opt-out is removed. "
                        + "This is recorded in the conversation timeline."
                )
            }
            .alert("Remove the opt-out?", isPresented: $confirmRevoke) {
                Button("Cancel", role: .cancel) {}
                Button("Remove opt-out") { controller.revokeOptOut() }
            } message: {
                Text(
                    "You'll be able to text this customer again. Only do this if they "
                        + "asked to hear from you."
                )
            }
            // #234: deleting a queued message throws away words the person
            // wrote and that nothing else holds — the draft is long gone by
            // then. Confirming is the one place in this screen where a step is
            // worth the friction.
            // *Applying: Ethical Friction — a deliberate pause before the
            // irreversible.*
            .alert(
                "Delete this message?",
                isPresented: Binding(
                    get: { confirmDiscardQueued != nil },
                    set: { if !$0 { confirmDiscardQueued = nil } }
                ),
                presenting: confirmDiscardQueued
            ) { pending in
                Button("Keep it", role: .cancel) { confirmDiscardQueued = nil }
                Button("Delete", role: .destructive) {
                    controller.discardQueued(pending.localId)
                    confirmDiscardQueued = nil
                }
            } message: { pending in
                // Quoting it back is the point: a queued row shows a couple of
                // lines, and the person is about to lose whichever ones they
                // cannot see.
                Text(
                    "It hasn't been sent, and deleting it here is the only copy gone.\n\n"
                        + "“\(pending.body)”"
                )
            }
            .sheet(
                isPresented: Binding(
                    get: { makeTaskFor != nil },
                    set: { if !$0 { makeTaskFor = nil } }
                )
            ) {
                if let message = makeTaskFor {
                    MakeTaskSheet(
                        controller: controller,
                        message: message,
                        contactName: contactName,
                        onDismiss: { makeTaskFor = nil }
                    )
                }
            }
        }
    }

    // MARK: - Timeline

    private func timelinePane(names: [String: String], contactName: String) -> some View {
        let timeline = buildTimeline(
            messages: controller.messages,
            events: controller.events,
            pending: controller.pendingSends,
            filter: controller.filter,
            allMessagesLoaded: controller.allMessagesLoaded,
            calendar: .current,
            now: Date()
        )
        return ZStack(alignment: .bottom) {
            if timeline.isEmpty {
                Text("No messages yet.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(timeline.enumerated()), id: \.element.key) { index, item in
                                let flashed = isFlashed(item)
                                itemView(item, names: names, contactName: contactName)
                                    // Search-result flash on the matched message
                                    // (#186 item 2) — a brief lime wash.
                                    .background(
                                        flashed
                                            ? BrandColor.lime.opacity(0.22)
                                            : Color.clear,
                                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    )
                                    .animation(.easeInOut(duration: 0.3), value: flashed)
                                    .scaleEffect(x: 1, y: -1)
                                    .id(item.key)
                                    .onAppear { handleItemAppear(index: index, total: timeline.count) }
                                    .onDisappear { handleItemDisappear(index: index) }
                            }
                            if controller.loadingOlder {
                                ProgressView()
                                    .padding(12)
                                    .scaleEffect(x: 1, y: -1)
                            }
                        }
                    }
                    .scaleEffect(x: 1, y: -1)
                    .scrollDismissesKeyboard(.interactively)
                    // A new row (teammate message, note, task line): stick to
                    // bottom when already there, otherwise surface the pill
                    // instead of silently growing the list below the fold
                    // (#186 item 4; the Android newestMessageId twin). The pill
                    // is a "someone else added something" cue — your OWN send
                    // (its newest row is self-authored) never pills, or every
                    // reply-while-scrolled-up would nag you about your own text.
                    .onChange(of: controller.newestMessageId ?? "") { _, _ in
                        if isAtBottom {
                            if let first = timeline.first {
                                proxy.scrollTo(first.key, anchor: .bottom)
                            }
                        } else if controller.messages.first?.sent_by_user_id != me.user_id {
                            showNewPill = true
                        }
                    }
                    .onChange(of: controller.pendingSends.count) { _, _ in
                        if isAtBottom, let first = timeline.first {
                            proxy.scrollTo(first.key, anchor: .bottom)
                        }
                    }
                    // "New message ↓" pill when an inbound lands while scrolled up.
                    .onChange(of: controller.newInboundTick) { _, tick in
                        guard tick > 0 else { return }
                        if isAtBottom {
                            if let first = timeline.first {
                                withAnimation { proxy.scrollTo(first.key, anchor: .bottom) }
                            }
                        } else {
                            showNewPill = true
                        }
                    }
                    // Pinned-banner / search-highlight jump: scroll once loaded.
                    .onChange(of: jumpToMessageId) { _, target in
                        guard let target else { return }
                        withAnimation { proxy.scrollTo("m:\(target)", anchor: .center) }
                        jumpToMessageId = nil
                    }
                    // Search-result highlight (#186 item 2): load the matched
                    // message if it's beyond the first page, then jump + flash.
                    .task(id: highlightMessageId) {
                        guard let target = highlightMessageId, flashMessageId != target
                        else { return }
                        if await controller.ensureMessageLoaded(target) {
                            jumpToMessageId = target
                            flashMessageId = target
                        }
                    }
                    // Clear the flash after it has played (~2.2s, Android parity).
                    .task(id: flashMessageId) {
                        guard flashMessageId != nil else { return }
                        try? await Task.sleep(for: .milliseconds(2200))
                        if !Task.isCancelled { flashMessageId = nil }
                    }
                    .overlay(alignment: .bottom) {
                        if showNewPill {
                            Button {
                                showNewPill = false
                                if let first = timeline.first {
                                    withAnimation { proxy.scrollTo(first.key, anchor: .bottom) }
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    Text("New message")
                                        .font(.golos(12, weight: .semibold))
                                    Image(systemName: "chevron.down")
                                        .font(.system(size: 12, weight: .semibold))
                                }
                                .foregroundStyle(BrandColor.canvas)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(Capsule().fill(BrandColor.ink))
                            }
                            .padding(.bottom, 12)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func handleItemAppear(index: Int, total: Int) {
        if index == 0 {
            isAtBottom = true
            showNewPill = false
        }
        // Flipped list: high indexes are the oldest items at the visual top.
        if total > 0, index >= total - 5 {
            controller.loadOlderMessages()
        }
    }

    private func handleItemDisappear(index: Int) {
        if index == 0 { isAtBottom = false }
    }

    /// #465: what tapping this timeline line does, or nil to leave it inert.
    ///
    /// A task line opens that task above the thread (the shell's `openTaskId`
    /// route, the same target every other task affordance uses). A done line
    /// goes to the message it quotes, loading older pages first if the message
    /// is behind the current window — a jump that silently does nothing reads
    /// as a broken line, which is worse than one that was never tappable.
    private func eventTapAction(
        for event: ConversationEvent
    ) -> (@MainActor () -> Void)? {
        guard let target = eventTarget(of: event) else { return nil }
        switch target {
        case .openTask(let taskId):
            return { AppRouter.shared.openTaskId = taskId }
        case .jumpToMessage(let messageId):
            return {
                Task { @MainActor in
                    if await controller.ensureMessageLoaded(messageId) {
                        jumpToMessageId = messageId
                        flashMessageId = messageId
                    }
                }
            }
        }
    }

    /// VoiceOver reads the sentence AND where it goes; the dotted underline
    /// that carries that for sighted readers is invisible to it.
    private func eventTapLabel(
        for event: ConversationEvent,
        sentence: String
    ) -> String? {
        guard let target = eventTarget(of: event) else { return nil }
        switch target {
        case .openTask:
            return "\(sentence). Open the task"
        case .jumpToMessage:
            return "\(sentence). Go to that message"
        }
    }

    /// True when this timeline item is the search-highlight target currently
    /// flashing (#186 item 2).
    private func isFlashed(_ item: TimelineItem) -> Bool {
        guard let flashMessageId, case .message(let message) = item else { return false }
        return message.id == flashMessageId
    }

    @ViewBuilder
    private func itemView(
        _ item: TimelineItem,
        names: [String: String],
        contactName: String
    ) -> some View {
        switch item {
        case .message(let message):
            MessageBubble(
                message: message,
                // #101 shared-inbox attribution: in a shared inbox the first
                // question about an outbound text is who already answered this
                // customer, so sends carry the teammate's name like the web.
                authorName: message.direction == MessageDirection.note
                    ? (message.sent_by_user_id.flatMap { names[$0] } ?? "Internal note")
                    : (message.direction == MessageDirection.outbound
                        ? message.sent_by_user_id.flatMap { names[$0] }
                        : nil),
                doneByName: message.done_by_user_id.flatMap { names[$0] },
                noteFilesState: message.direction == MessageDirection.note
                    ? controller.noteFiles[message.id]
                    : nil,
                onLoadNoteFiles: { controller.loadNoteFiles(message.id) },
                onOpenFile: { openFile($0) },
                mintAttachmentUrl: {
                    try await controller.mintAttachmentUrl($0, variant: $1)
                },
                actions: MessageBubbleActions(
                    onToggleDone: { controller.toggleDone(message) },
                    onTogglePin: { controller.togglePin(message) },
                    onRetry: { controller.retrySend(message.id) },
                    onMakeTask: {
                        // The sheet seeds its own editable title from the body
                        // (#214 also pre-fills a due + address via enrichment).
                        makeTaskFor = message
                    },
                    onCopied: { controller.markCopied() },
                    // #217: the bubble's task indicator opens that task's detail
                    // ABOVE this thread (the shell's existing openTaskId route,
                    // which passes onOpenConversation so the task can jump back
                    // to its source message).
                    onOpenTask: { AppRouter.shared.openTaskId = $0 }
                )
            )
        case .pending(let pending):
            PendingBubble(
                pending: pending,
                onSendNow: { controller.retryQueued(pending.localId) },
                onDelete: { confirmDiscardQueued = pending }
            )
        case .event(let event):
            // #465: an event that names a task or a message goes there. A done
            // line whose message is older than the loaded window still works:
            // the jump goes through `ensureMessageLoaded`, the same path the
            // search highlight uses, rather than a presence check that would
            // silently do nothing.
            let sentence = eventLine(event, memberNames: names, contactName: contactName)
            EventLine(
                text: sentence,
                timeIso: event.created_at,
                transcript: voicemailTranscript(of: event),
                onTap: eventTapAction(for: event),
                tapLabel: eventTapLabel(for: event, sentence: sentence)
            )
        case .dayDivider(let label, _):
            DayDividerLine(label: label)
        }
    }

    private func openFile(_ attachment: Attachment) {
        Task {
            do {
                // #240: handing the file to another app means handing over the
                // FILE, not a picture of it.
                let minted = try await controller.mintAttachmentUrl(
                    attachment.id,
                    variant: "original"
                )
                if let url = URL(string: minted) {
                    openURL(url)
                }
            } catch {
                controller.notifyExternally(error.userMessage)
            }
        }
    }

    // MARK: - Calling

    /// Call button: authorize + place through the softphone. The mic is
    /// preflighted BEFORE authorizing (a denial never reserves the line or
    /// bills); gate refusals arrive coded (usage_cap_reached,
    /// subscription_inactive, conflict "line on another call") with honest
    /// server copy — surfaced verbatim on the toast. Stays enabled for
    /// opted-out contacts: voice consent ≠ SMS consent.
    private func startCall(detail: ConversationDetail, contactName: String) {
        guard !placingCall else { return }
        let manager = CallsManager.get(graph: graph)
        Task {
            if !manager.hasMicPermission {
                guard await manager.requestMicPermission() else {
                    controller.notifyExternally(
                        "Loonext needs the microphone to place calls. "
                            + "Allow it in Settings › Loonext."
                    )
                    return
                }
            }
            placingCall = true
            // Idempotent registration — the thread may be the first calls
            // surface this process touches.
            manager.start(companyId: detail.company_id, callerIdName: me.display_name)
            do {
                try await manager.placeCall(
                    displayName: contactName,
                    conversationId: controller.conversationId
                )
            } catch {
                controller.notifyExternally(error.userMessage)
            }
            placingCall = false
        }
    }

    // MARK: - Composer

    /// Deliberately NOT a @ViewBuilder: this returns a single view, so the
    /// result-builder transform buys nothing and spends type-checker budget
    /// this function has none of to spare.
    /// #302 — who else is on this thread.
    ///
    /// Advisory and quiet, at the composer rather than the header: the header is
    /// read once when the thread opens and forgotten, and the decision this
    /// exists to change — "I'll answer this" — is made with a thumb already on
    /// the keyboard. Nothing here is tappable and nothing is locked; a person
    /// who sees a colleague's name simply stops, which is the whole mechanism.
    @ViewBuilder
    private func presenceStrip(detail: ConversationDetail) -> some View {
        let topic = RealtimeClient.presenceTopic(detail.company_id, detail.phone_number_id)
        let viewers = viewersOf(
            entries: presenceEntries(presenceByTopic[topic] ?? [:]),
            conversationId: detail.id,
            selfUserId: me.user_id,
            now: Int(presenceNow * 1000),
            // The topic's presence in the map IS the health signal, and it is
            // more precise than the socket state: the key exists only once the
            // server has sent a `presence_state` for it, and the client removes
            // it on close or error. An empty ROOM is `[:]` — present and empty,
            // so healthy with nobody here. A dead channel is absent entirely, so
            // "we do not know", which must look like silence rather than like
            // "nobody is here".
            healthy: presenceByTopic[topic] != nil
        )
        if let line = presenceLabel(viewers) {
            HStack(spacing: 6) {
                Circle()
                    .fill(viewers.contains(where: { $0.typing }) ? BrandColor.olive : BrandColor.muted500)
                    .frame(width: 6, height: 6)
                Text(line)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted700)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 2)
            .accessibilityElement(children: .combine)
        }
    }

    /// Announce this viewer on the thread's presence topic.
    private func announcePresence(typing: Bool) {
        guard let detail = controller.conversation else { return }
        let entry: JSONValue = .object([
            "user_id": .string(me.user_id),
            "display_name": .string(me.display_name),
            "conversation_id": .string(detail.id),
            "typing": .bool(typing),
            "at": .number(Date().timeIntervalSince1970 * 1000),
        ])
        Task {
            await graph.realtime.trackPresence(
                numberId: detail.phone_number_id,
                entry: entry
            )
        }
    }

    private func composerPane(detail: ConversationDetail) -> some View {
        // #315: a view-only observer may read this thread and change nothing
        // in it. Resolved from the membership, the same way the settings index
        // does it.
        let viewerReadOnly = me.memberships
            .first { $0.company_id == detail.company_id }?.role == MemberRole.readOnly
        let banner = selectComposerBanner(
            contactOptedOut: controller.contact?.opted_out == true,
            contactOptOutSource: controller.contact?.opt_out_source,
            subscriptionStatus: controller.company?.subscription_status
                ?? SubscriptionStatus.active,
            destinationCountry: Nanp.destinationCountry(detail.contact.phone_e164),
            usApproved: controller.company.map(usSendApproved) ?? true,
            usTextingOff: controller.company.map(usTextingOff) ?? false,
            usage: controller.usage,
            // #396: a shared inbox means the person replying is often not the
            // person who read the request.
            optOutHint: detail.opt_out_hint_at != nil,
            // #423: the carrier took an approved registration away.
            usSuspended: controller.company.map(usSuspended) ?? false,
            // #363: the reader's own level on THIS number — the one banner
            // about them rather than about the conversation.
            viewerLevel: detail.viewer_level,
            viewerReadOnly: viewerReadOnly
        )
        // #106: calling is outreach like texting, so a notes-only member gets
        // no control the API would refuse.
        //
        // Assigned through an `if` rather than a ternary. A @MainActor function
        // type is implicitly @Sendable, and a ternary does not carry that
        // contextual type into the closure literal: the literal is inferred as
        // a plain `() -> ()` and then will not convert.
        // #253: assigned as a local for the same type-checker reason as
        // `onCallInstead` below — a @MainActor closure literal needs its
        // contextual type, and this call site has exhausted the budget before.
        // `detail.company_id` rather than a `companyId` of its own: this
        // function has no such binding, and the conversation already carries
        // the only workspace the report could possibly be about.
        let reportCompanyId = detail.company_id
        let companyName = controller.company?.name
        let companyPlan = controller.company?.plan
        let reportBanner: @MainActor (ComposerBanner) -> Void = { banner in
            let kind = bannerKind(banner)
            guard let url = supportMailto(
                companyId: reportCompanyId,
                companyName: companyName,
                plan: companyPlan,
                appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
                subject: supportSubjectFor(kind),
                situation: supportSituation(kind),
                recentErrors: DiagnosticsLog.recentLines()
            ) else { return }
            openURL(url)
        }
        var onCallInstead: (@MainActor () -> Void)?
        if detail.viewer_level == "text" {
            let callContactName = detail.contact.name
                ?? formatPhone(detail.contact.phone_e164)
            onCallInstead = {
                startCall(detail: detail, contactName: callContactName)
            }
        }
        // #233: queue it instead of sending it. Withheld from a notes-only or
        // view-only member for the same reason the send path is — the API
        // would refuse it, and an affordance that only ever fails is worse than
        // no affordance.
        //
        // An `if` and a local, not a ternary, for the reason `onCallInstead`
        // gives above: a @MainActor function type is implicitly @Sendable, and
        // a ternary does not carry that contextual type into the literal.
        var onScheduleSend: (@MainActor (String, String, Bool) async -> ScheduleOutcome)?
        if detail.viewer_level == "text", !viewerReadOnly {
            let scheduleController = controller
            onScheduleSend = { body, sendAtISO, confirmed in
                await scheduleController.scheduleSend(
                    body: body,
                    sendAtISO: sendAtISO,
                    quietHoursConfirmed: confirmed
                )
            }
        }
        // #408: built as a LOCAL with an explicit type before the view
        // expression, for the reason the comment above `onCallInstead` gives —
        // this call site has run the Swift type checker out of budget before,
        // and anything inferred inline is what does it.
        let members = controller.members
        // `first(where:)` spelled out rather than `.first { … }`. Swift has
        // BOTH a `first` property and a `first(where:)` method, and when the
        // closure's type cannot be inferred on the spot it resolves to the
        // property and then tries to call `Member?` — which is the error this
        // exact line produced. Naming the label removes the ambiguity.
        let lastOutbound = controller.messages.first(where: { message in
            message.direction == "outbound"
        })
        // `display_name` is a non-Optional String carrying @Default — an
        // absent one decodes to "", not nil — so the empty check is the whole
        // guard. Binding it with `guard let` would not compile.
        let resolveMemberName: @Sendable (String) -> String? = { id in
            guard let match = members.first(where: { $0.user_id == id }),
                  !match.display_name.isBlank
            else { return nil }
            return match.display_name
        }
        // #507: hold the mic in the note box, say what was agreed, get the
        // words back to check and post. Offered to anyone who reaches this
        // composer at all — both number levels may post a note, and #315
        // read-only never gets a composer.
        //
        // Whether the WORKSPACE wants it is left to the server: it answers
        // `disabled` with copy that names the setting, which beats a client
        // that hides the control and explains nothing (and beats fetching AI
        // settings on every thread open to decide).
        //
        // Built as a LOCAL with an explicit type before the view expression,
        // for the reason `onCallInstead` gives above — this call site has run
        // the Swift type checker out of budget before.
        let wrapUpUploader = MultipartClient(
            api: graph.api,
            sessionStore: graph.sessionStore
        )
        let wrapUpCompanyId = detail.company_id
        let wrapUpConversationId = detail.id
        let wrapUpDictation = WrapUpDictationContext(
            // D117: never while a call still holds the line. `peek` rather
            // than `get` — a member who has never opened a calls surface has
            // no softphone, and asking the question must not build one.
            callInProgress: {
                guard let manager = CallsManager.peek() else { return false }
                return !manager.state.liveCalls.isEmpty
            },
            transcribe: { audio, seconds in
                await wrapUpUploader.wrapUpTranscript(
                    companyId: wrapUpCompanyId,
                    conversationId: wrapUpConversationId,
                    audio: audio,
                    seconds: seconds
                )
            }
        )
        let duplicateReply = DuplicateReplyContext(
            // A note reaches no customer, so it is not a collision: the whole
            // harm here is the CUSTOMER receiving two answers.
            lastOutbound: lastOutbound,
            memberName: resolveMemberName,
            meUserId: me.user_id
        )
        return ThreadComposerView(
            state: composer,
            noteOnly: detail.viewer_level == "note",
            readOnly: viewerReadOnly,
            banner: banner,
            contactName: detail.contact.name,
            businessName: controller.company?.name,
            // #274: everything this side can answer honestly. The visit day and
            // time are the server's to resolve — a cached answer would be
            // confidently wrong the moment a teammate reschedules the task.
            //
            // In DECLARATION order: a SwiftUI view's memberwise initialiser
            // takes its arguments in the order the properties are declared, so
            // these belong here rather than beside the other new argument.
            contactAddress: detail.contact.address,
            senderName: me.display_name,
            ourNumberE164: controller.company?.numbers
                .first { $0.id == detail.phone_number_id }?.number_e164,
            loadTemplates: { [repo = controller.repo, companyId = detail.company_id] in
                // #274: most-used first. Somebody opening the picker is
                // about to send, and the reply they send twenty times a
                // day should not be wherever its name happens to fall.
                try await repo.templates(companyId: companyId, byUse: true).data
            },
            onSendText: { body, photos, templateId, templateEdited in
                controller.sendText(
                    body: body,
                    photos: photos,
                    templateId: templateId,
                    templateEdited: templateEdited
                ) {
                    composer.restore(body: body, photos: photos, files: [])
                }
            },
            onSaveNote: { body, files, mentionUserIds in
                let picked = composer.picked
                controller.saveNote(body: body, files: files, mentionUserIds: mentionUserIds) {
                    // Put the picks back with the words: a restored draft that
                    // still reads "@Sam" must still be able to tell Sam.
                    composer.restore(body: body, photos: [], files: files, picked: picked)
                }
            },
            hasJobToday: hasJobToday,
            onSendOnMyWay: { minutes in
                // The ORDINARY send path: the opt-out gate, quiet hours and
                // number access all apply. Being fast is not a reason for an
                // exemption, and the server's refusal is what gets shown.
                controller.sendText(
                    body: OnMyWay.text(minutes),
                    photos: [],
                    templateId: nil,
                    templateEdited: false
                ) {
                    // The restore hook every other send takes. Nothing to put
                    // back here — the words were never in the box — which is
                    // said rather than left as an empty closure somebody
                    // wonders about.
                }
            },
            loadMentionableMembers: { await controller.mentionableMembers() },
            onNotice: { controller.notifyExternally($0) },
            duplicateReply: duplicateReply,
            suggestReplies: { [repo = controller.repo, companyId = detail.company_id] draft in
                await repo.suggestReplies(
                    companyId: companyId,
                    conversationId: detail.id,
                    draft: draft
                )
            },
            // #431: detached inside the controller, so a slow or failed outcome
            // report can never delay or fail the send it describes.
            reportAiOutcome: { feature, outcome in
                controller.reportAiOutcome(feature: feature, outcome: outcome)
            },
            onCallInstead: onCallInstead,
            // #253: the honest banner named exactly what is wrong; without
            // this it is still a dead end. The diagnostics ring is read at
            // TAP time, not here — the useful errors are the ones that
            // happened while the person was staring at the banner.
            onReportBanner: reportBanner,
            onTyping: {
                // #302: throttled — the keystroke rate is not the broadcast rate.
                let now = Int(Date().timeIntervalSince1970 * 1000)
                typingUntilMs = now + PresenceTiming.typingTtlMs
                guard now - lastTypingSentMs >= PresenceTiming.typingThrottleMs else { return }
                lastTypingSentMs = now
                announcePresence(typing: true)
            },
            // Reuse drafts already paid for until a message moves the thread.
            draftCacheKey: DraftSuggestionsCache.key(
                conversationId: detail.id,
                lastActivityAt: detail.last_message_at
            ),
            destinationClock: detail.destination_clock,
            // Last, matching its declaration position on the view — a SwiftUI
            // memberwise initialiser takes its arguments in that order.
            wrapUp: wrapUpDictation,
            onScheduleSend: onScheduleSend
        )
    }
}

// MARK: - Header

/// The paper pill header (#186 item 3): back · avatar · name (+ the #505
/// repeat-customer chip) + status line · ink call circle. The avatar / name /
/// status line all open the conversation info sheet (a bottom-sheet CARD, not a
/// scatter of menus) — assign, pin, gallery, spam, opt-out, and timeline
/// visibility live there, with the full contact panel one tap deeper. The
/// Android ThreadHeader + ConversationSheet twin.
@MainActor
private struct ThreadHeader: View {
    @Bindable var controller: ThreadController
    let detail: ConversationDetail
    let contactName: String
    let phoneLabel: String
    let meUserId: String
    let calling: Bool
    let onBack: @MainActor () -> Void
    let onOpenSheet: @MainActor () -> Void
    let onCall: @MainActor () -> Void

    /// The one status line under the name: status · assignee (or number), plus
    /// an opted-out tail — the Android header subtitle.
    private var subtitle: String {
        var parts = statusLabel(detail.status)
        let assigneeName = controller.members
            .first { $0.user_id == detail.assigned_user_id }?
            .display_name
        let trailing = (assigneeName?.isBlank == false) ? assigneeName! : phoneLabel
        parts += " · \(trailing)"
        if controller.contact?.opted_out == true { parts += " · Opted out" }
        return parts
    }

    /// #505: "7 conversations", or nil for a first-time caller.
    ///
    /// Read off `controller.contact` — the same number-access-filtered record
    /// (#106/D88) this header already asks for `opted_out`, fetched once on
    /// open. The conversation's own `detail.contact` cannot answer this: it is
    /// a `ConversationDetailContact`, which carries no counts. Nil until that
    /// read lands, so the chip simply arrives with the header's other late
    /// facts rather than being a second thing that flickers.
    private var repeatBadge: String? {
        contactRepeatBadge(controller.contact?.conversation_count)
    }

    /// VoiceOver hears the chip too.
    ///
    /// An `accessibilityLabel` on a Button REPLACES its children's text, so a
    /// chip left out of this string is a signal that does not exist at all for
    /// a screen-reader user — which is the same complaint #505 opened with, one
    /// surface further in.
    private var identityLabel: String {
        guard let badge = repeatBadge else { return "Conversation options for \(contactName)" }
        return "Conversation options for \(contactName), \(badge)"
    }

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onBack) {
                Image(systemName: "chevron.backward")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandColor.ink)
                    .frame(width: 36, height: 36)
            }
            .accessibilityLabel("Back")

            // Avatar + name + status line all open the conversation info sheet.
            Button(action: onOpenSheet) {
                HStack(spacing: 8) {
                    InitialsAvatar(name: contactName, size: 38)

                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 6) {
                            Text(contactName)
                                .font(.golos(14.5, weight: .semibold))
                                .foregroundStyle(BrandColor.ink)
                                .lineLimit(1)
                            // #505: the repeat-customer signal where the reply
                            // actually gets written, instead of only inside a
                            // panel that defaults closed. The contacts list's
                            // "Opted out" chip verbatim — a quiet grey capsule
                            // beside a name is vocabulary this app already has,
                            // and a second one would only be a second thing to
                            // learn. Subordinate to the name by every measure:
                            // 10pt against 14.5, muted against ink.
                            if let badge = repeatBadge {
                                DsChip(
                                    text: badge,
                                    container: BrandColor.insetDeep,
                                    content: BrandColor.muted700
                                )
                                // The NAME yields first when both cannot fit.
                                // This row is tighter than the contacts list's
                                // — a back chevron, a 38pt avatar and a 44pt
                                // call circle are already spending the width —
                                // and a chip clipped to "7 conve…" says less
                                // than a clipped name does. The chip is
                                // intrinsically small, so nothing else in the
                                // header moves for it.
                                .layoutPriority(1)
                            }
                        }
                        HStack(spacing: 5) {
                            Circle()
                                .fill(BrandColor.lime)
                                .frame(width: 6, height: 6)
                            Text(subtitle)
                                .font(.golos(11))
                                .foregroundStyle(BrandColor.muted500)
                                .lineLimit(1)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(identityLabel)

            // Call — enabled even for opted-out contacts (voice ≠ SMS
            // consent); #106: outreach like texting, so note-level viewers
            // get no dead control (the API would 403).
            if detail.viewer_level == "text" {
                Button(action: onCall) {
                    if calling {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: 44, height: 44)
                    } else {
                        Image(systemName: "phone")
                            .font(.system(size: 17, weight: .medium))
                            .foregroundStyle(BrandColor.canvas)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(BrandColor.ink))
                    }
                }
                .disabled(calling)
                .accessibilityLabel("Call \(contactName)")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 14)
        .padding(.top, 4)
    }
}

/// The conversation info sheet (#186 item 3) — a bottom-sheet CARD, the web/
/// Android `ConversationSheet` twin: contact identity (→ full contact panel one
/// tap deeper), the four status pills, the assign / pin / gallery / spam /
/// opt-out actions (plus iOS's manual Refresh), and the timeline-visibility
/// toggles. Every action either mutates through the controller and dismisses,
/// or opens the next surface in place.
@MainActor
private struct ConversationSheet: View {
    @Bindable var controller: ThreadController
    let detail: ConversationDetail
    let contactName: String
    let onOpenContactPanel: @MainActor () -> Void
    let onAssign: @MainActor () -> Void
    let onOpenGallery: @MainActor () -> Void
    let onOptOut: @MainActor () -> Void
    let onRevokeOptOut: @MainActor () -> Void
    let onRefresh: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    /// #293: the custom-date sheet, owned here rather than inside the row, so
    /// dismissing the actions sheet cannot take the picker with it. The value
    /// is WHICH ladder it is completing; nil is closed.
    @State private var snoozePickerKind: DeferralKind?

    private let statuses = [
        ConversationStatus.new,
        ConversationStatus.open,
        ConversationStatus.waiting,
        ConversationStatus.closed,
    ]

    private var assigneeLabel: String {
        let name = controller.members
            .first { $0.user_id == detail.assigned_user_id }?
            .display_name
        return (name?.isBlank == false) ? "Assigned to \(name!)" : "Assign to…"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                identityRow
                statusSection
                actionsCard
                snoozeCard
                timelineCard
            }
            .padding(.horizontal, 18)
            .padding(.top, 16)
            .padding(.bottom, 24)
        }
        .background(BrandColor.canvas)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    /// Identity → full contact panel (the one-tap-deeper contact info).
    private var identityRow: some View {
        Button(action: onOpenContactPanel) {
            HStack(spacing: 11) {
                InitialsAvatar(name: contactName, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(contactName)
                        .font(.golos(14, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .lineLimit(1)
                    Text(formatPhone(detail.contact.phone_e164))
                        .font(.golos(11.5))
                        .monospacedDigit()
                        .foregroundStyle(BrandColor.muted500)
                }
                Spacer(minLength: 8)
                Text("View contact")
                    .font(.golos(11.5, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 12)
            .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("STATUS")
                .font(.golos(10.5, weight: .bold))
                .kerning(0.6)
                .foregroundStyle(BrandColor.muted500)
                .padding(.leading, 6)
            HStack(spacing: 7) {
                ForEach(statuses, id: \.self) { status in
                    let selected = detail.status == status
                    Button {
                        if !selected { controller.setStatus(status) }
                        onDismiss()
                    } label: {
                        Text(statusLabel(status))
                            .font(.golos(11.5, weight: .semibold))
                            .foregroundStyle(selected ? BrandColor.paper : BrandColor.muted700)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 8)
                            .background(
                                selected ? BrandColor.ink : BrandColor.paper,
                                in: Capsule()
                            )
                    }
                    .buttonStyle(.plain)
                }
                Spacer(minLength: 0)
            }
        }
    }

    private var actionsCard: some View {
        VStack(spacing: 0) {
            sheetRow(assigneeLabel, icon: "person.badge.plus", action: onAssign)
            RowDivider()
            // #465: pinned is a STATE, not a command. It was drawn as a plain
            // action row, identical to "Photos & files" below it, while this
            // sheet already had a toggleRow used only by the view filters. Same
            // vocabulary everywhere now: a trailing mark means state, and the
            // label names the state rather than flipping between two verbs.
            toggleRow("Pinned", icon: "pin", on: detail.pinned_at != nil) {
                controller.toggleConversationPin()
                onDismiss()
            }
            RowDivider()
            sheetRow("Photos & files", icon: "photo.on.rectangle", action: onOpenGallery)
            RowDivider()
            sheetRow("Refresh", icon: "arrow.clockwise") { onRefresh() }
            RowDivider()
            toggleRow("Spam", icon: "exclamationmark.octagon", on: detail.is_spam) {
                controller.setSpam(!detail.is_spam)
                onDismiss()
            }
            RowDivider()
            if controller.contact?.opted_out == true {
                // #407: a STOP the customer sent is a CARRIER block, and only
                // they can lift it. Offering to undo it here promised something
                // the next send would immediately contradict — and taught the
                // owner that consent is theirs to reinstate. So the row becomes
                // the answer they actually need: the route back, which is one
                // the customer takes.
                if isCarrierEnforcedOptOut(controller.contact?.opt_out_source) {
                    sheetNote(
                        "This customer texted STOP. Only they can undo it, by "
                            + "texting START to your number."
                    )
                } else {
                    sheetRow(
                        "Remove opt-out",
                        icon: "arrow.uturn.backward",
                        action: onRevokeOptOut
                    )
                }
            } else {
                sheetRow("Opt out of texts", icon: "nosign", action: onOptOut)
            }
        }
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    /// #293 — "needs attention, but on Thursday".
    ///
    /// Its own card rather than a row in `actionsCard`, because deferring is a
    /// CHOICE (which "later") not a toggle, and four presets folded into that
    /// list would bury the actions that are one tap each.
    ///
    /// Chunking: at most four presets, and the ladder SHRINKS as the day goes —
    /// at 4pm there is no "This afternoon" to offer, so it is not offered. A
    /// disabled row is a worse answer than a shorter list. Once deferred the
    /// card collapses to a single "Bring back now", because at that point there
    /// is exactly one thing a person wants from it.
    @ViewBuilder
    private var snoozeCard: some View {
        let isFollowUp = detail.snooze_kind == DeferralKind.followUp.rawValue
        VStack(spacing: 0) {
            if let until = detail.snoozed_until, isSnoozed(until) {
                let back = snoozeReturnLabel(until)
                sheetNote(
                    isFollowUp
                        ? back.replacingOccurrences(of: "Back", with: "Chase")
                        : back
                )
                RowDivider()
                sheetRow(
                    isFollowUp ? "Cancel the reminder" : "Bring back now",
                    icon: "alarm.slash"
                ) {
                    controller.unsnooze()
                    onDismiss()
                }
            } else {
                sheetNote("Snooze until")
                ForEach(snoozePresets()) { preset in
                    RowDivider()
                    sheetRow(preset.label, trailing: presetClock(preset.at)) {
                        controller.snooze(untilISO: snoozeInstantISO(preset.at))
                        onDismiss()
                    }
                }
                RowDivider()
                sheetRow("Pick a date…", icon: "calendar") { snoozePickerKind = .snooze }

                // #293: a SECOND ladder, not a second label on the first.
                // "This afternoon" is a sensible time to pick a thread back up
                // and a meaningless time to chase a quote — one ladder for both
                // would put three useless options in front of whichever job you
                // were actually doing.
                sheetNote("Remind me to chase")
                ForEach(followUpPresets()) { preset in
                    RowDivider()
                    sheetRow(preset.label, trailing: presetClock(preset.at)) {
                        controller.snooze(
                            untilISO: snoozeInstantISO(preset.at),
                            kind: .followUp
                        )
                        onDismiss()
                    }
                }
                RowDivider()
                sheetRow("Pick a date…", icon: "calendar") { snoozePickerKind = .followUp }
            }
        }
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .sheet(item: $snoozePickerKind) { kind in
            SnoozeDatePicker(kind: kind) { picked, note in
                snoozePickerKind = nil
                controller.snooze(
                    untilISO: snoozeInstantISO(picked),
                    note: note,
                    kind: kind
                )
                onDismiss()
            }
        }
    }

    private func presetClock(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    private var timelineCard: some View {
        VStack(spacing: 0) {
            toggleRow("Show messages", icon: "bubble.left", on: controller.filter.messages) {
                controller.filter = controller.filter.toggledMessages()
            }
            RowDivider()
            toggleRow("Show notes", icon: "lock", on: controller.filter.notes) {
                controller.filter = controller.filter.toggledNotes()
            }
            RowDivider()
            toggleRow("Show events", icon: "info.circle", on: controller.filter.events) {
                controller.filter = controller.filter.toggledEvents()
            }
        }
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    /// A row that says something rather than doing something (#407).
    ///
    /// Deliberately NOT a disabled `sheetRow`: a greyed-out row still reads as
    /// an action somebody could earn, and the whole point here is that this one
    /// is not ours to take at all. Same metrics as its tappable sibling so the
    /// sheet keeps its rhythm; muted, smaller and wrapping so it never reads as
    /// pressable.
    private func sheetNote(_ text: String) -> some View {
        Text(text)
            .font(.golos(11.5))
            .foregroundStyle(BrandColor.muted500)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
    }

    /// #465: these rows were text-only, so assign, pin and spam all read as one
    /// undifferentiated list. The icon is the fastest way to find the row you
    /// came for. `icon` is optional because the snooze presets are a list of
    /// times, where eight identical clock glyphs would be noise, not help.
    private func sheetRow(
        _ label: String,
        icon: String? = nil,
        trailing: String? = nil,
        action: @escaping @MainActor () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(BrandColor.muted500)
                        .frame(width: 20, alignment: .leading)
                }
                Text(label)
                    .font(.golos(13.5, weight: .medium))
                    .foregroundStyle(BrandColor.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let trailing {
                    Text(trailing)
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted500)
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func toggleRow(
        _ label: String,
        icon: String? = nil,
        on: Bool,
        action: @escaping @MainActor () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(on ? BrandColor.olive : BrandColor.muted500)
                        .frame(width: 20, alignment: .leading)
                }
                Text(label)
                    .font(.golos(13.5, weight: .medium))
                    .foregroundStyle(BrandColor.ink)
                Spacer()
                // #465: the box is drawn in BOTH states. A bare checkmark that
                // appears only when on leaves an unchecked row pixel-identical
                // to the plain action rows around it, which is the complaint.
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(on ? BrandColor.olive : BrandColor.muted400)
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// One choice in the make-a-task assignee row: avatar + name on paper, with an
/// ink ring when it is the one picked.
@MainActor
private struct AssigneeChoiceChip: View {
    let name: String
    let showsAvatar: Bool
    let selected: Bool
    let onTap: @MainActor () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 7) {
                if showsAvatar {
                    InitialsAvatar(name: name, size: 26)
                }
                Text(name)
                    .font(.golos(12.5, weight: selected ? .semibold : .medium))
                    .foregroundStyle(selected ? BrandColor.ink : BrandColor.muted700)
            }
            .padding(.leading, showsAvatar ? 6 : 13)
            .padding(.trailing, 13)
            .padding(.vertical, 6)
            .background(BrandColor.paper, in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    selected ? BrandColor.ink : Color.clear,
                    lineWidth: 2
                )
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
        .accessibilityAddTraits(selected ? AccessibilityTraits.isSelected : [])
    }
}

/// Active-member picker with an Unassigned entry. Shared with the inbox
/// rows' Assign swipe action — the one picker for the one mutation.
@MainActor
struct AssigneePickerSheet: View {
    let members: [Member]
    let meUserId: String
    let selectedUserId: String?
    let onPick: @MainActor (String?) -> Void

    var body: some View {
        NavigationStack {
            List {
                Button {
                    onPick(nil)
                } label: {
                    HStack {
                        Text("Unassigned")
                            .foregroundStyle(.primary)
                        Spacer()
                        if selectedUserId == nil {
                            Image(systemName: "checkmark")
                                .foregroundStyle(BrandColor.olive)
                        }
                    }
                }
                ForEach(members.filter { $0.deactivated_at == nil }, id: \.user_id) { member in
                    Button {
                        onPick(member.user_id)
                    } label: {
                        HStack(spacing: 12) {
                            InitialsAvatar(
                                name: member.display_name.isBlank ? nil : member.display_name,
                                size: 30
                            )
                            Text(
                                (member.display_name.isBlank ? "Teammate" : member.display_name)
                                    + (member.user_id == meUserId ? " (you)" : "")
                            )
                            .foregroundStyle(.primary)
                            Spacer()
                            if selectedUserId == member.user_id {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(BrandColor.olive)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Assign to")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}

/// #293 — "Back Thursday, 8:00 AM · Bring back". One line, the same shape as
/// the pinned banner so a second in-thread status strip does not invent a
/// second visual language, and the whole strip is the tap target: at this point
/// there is exactly one thing a person wants from it.
@MainActor
private struct SnoozedBanner: View {
    let label: String
    let onBringBack: @MainActor () -> Void

    var body: some View {
        Button(action: onBringBack) {
            HStack(spacing: 8) {
                Image(systemName: "clock")
                    .font(.system(size: 12))
                    .foregroundStyle(BrandColor.muted700)
                Text(label)
                    .font(.golos(11.5, weight: .semibold))
                    .foregroundStyle(BrandColor.muted900)
                Spacer()
                Text("Bring back")
                    .font(.golos(11.5, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(
                BrandColor.inset,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 18)
        .padding(.vertical, 5)
        .accessibilityHint("Brings this conversation back to your inbox now")
    }
}

/// Collapsed "Pinned · N" disclosure; expanded rows jump to the message.
/// Pinned lives in the warm cream well ("Paper & Olive").
@MainActor
private struct PinnedBanner: View {
    let pinned: [Message]
    let onJump: @MainActor (String) -> Void

    @State private var expanded = false

    /// A media-only pinned message is named by what it carries, not "Photo".
    private func pinnedPreview(_ message: Message) -> String {
        guard message.body.isBlank else { return message.body }
        let kinds = message.attachments.map { MediaKind.of($0.content_type) }
        guard !kinds.isEmpty else { return message.body }
        return attachmentLabel(
            kind: sharedMediaKind(kinds) ?? .file,
            count: kinds.count
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation { expanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "pin.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(BrandColor.muted700)
                    Text("Pinned · \(pinned.count)")
                        .font(.golos(11.5, weight: .semibold))
                        .foregroundStyle(BrandColor.muted900)
                    Spacer()
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(BrandColor.muted700)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(expanded ? "Collapse pinned" : "Expand pinned")

            if expanded {
                ForEach(pinned, id: \.id) { message in
                    Button {
                        onJump(message.id)
                    } label: {
                        HStack(spacing: 8) {
                            Text(pinnedPreview(message))
                                .font(.golos(12.5))
                                .foregroundStyle(BrandColor.ink)
                                .lineLimit(1)
                            Spacer()
                            Text(bubbleTime(message.created_at))
                                .font(.golos(10.5))
                                .foregroundStyle(BrandColor.muted400)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .background(BrandColor.cream, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
    }
}

/// One-line transient notice with an optional action — the Android snackbar's
/// calm iOS stand-in.
private struct ToastView: View {
    let notice: ThreadNotice
    let onDismiss: @MainActor () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text(notice.text)
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.ink)
                .lineLimit(2)
            if let label = notice.actionLabel {
                Button(label) {
                    notice.action?()
                    onDismiss()
                }
                .font(.golos(12.5, weight: .semibold))
                .foregroundStyle(BrandColor.olive)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: Capsule())
        .padding(.horizontal, 24)
        .onTapGesture { onDismiss() }
    }
}

// MARK: - Make a task (spec 22 + #214 enrichment)

/// "Make a task — from a message": quoted source message with a lime bar, an
/// editable title on paper, an optional due, and — when the company opted into
/// AI enrichment (Settings → AI) — a pre-filled due and a collapsible
/// structured address, each with a provenance badge and fully editable (any
/// edit marks the address "manual"). The ink Create bar posts the confirmed
/// task. Mirrors the web MakeTaskForm.
@MainActor
private struct MakeTaskSheet: View {
    let controller: ThreadController
    let message: Message
    let contactName: String
    let onDismiss: @MainActor () -> Void

    @State private var title: String
    /// Assigned to whoever is making it, matching web and Android. The default
    /// task view is "open, assigned to me", so a task made here and left
    /// unassigned landed in a list nobody was looking at.
    @State private var assigneeId: String?
    @State private var due: Date?
    @State private var dueSuggested = false
    @State private var duePickerOpen = false
    @State private var addr = AddressFieldValues()
    @State private var addrProvenance: String?
    @State private var addrOpen = false
    @State private var enriching = false
    @State private var enrichStarted = false
    /// #431: what enrichment actually filled in, so the outcome can be judged
    /// against it at create time. `suggestedDueAt` holds the VALUE rather than a
    /// flag, because "changed the due date" can only be told apart from "kept it"
    /// by comparing against what Lou proposed.
    @State private var suggestedAddress = false
    @State private var suggestedDueAt: Date?

    private enum AddrField: Hashable {
        case street, unit, city, state, postal, country
    }

    @FocusState private var addrFocus: AddrField?

    init(
        controller: ThreadController,
        message: Message,
        contactName: String,
        onDismiss: @escaping @MainActor () -> Void
    ) {
        self.controller = controller
        self.message = message
        self.contactName = contactName
        self.onDismiss = onDismiss
        _title = State(initialValue: Self.seededTitle(message.body))
        _assigneeId = State(initialValue: controller.meUserId)
    }

    /// The web's message-snippet default title, editable: the trimmed body
    /// (first 120 chars), or "Follow up" for a picture-only message.
    private static func seededTitle(_ body: String) -> String {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Follow up" : String(trimmed.prefix(120))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 15) {
                header
                if !message.body.isBlank { sourceQuote }
                titleField
                assigneeRow
                dueRow
                addressBlock
                createButton
                Text("The thread shows the task line")
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted300)
                    .frame(maxWidth: .infinity)
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(BrandColor.canvas)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await enrichIfNeeded() }
        .sheet(isPresented: $duePickerOpen) {
            MakeTaskDueSheet(initial: due) { picked in
                due = picked
                dueSuggested = false
            }
        }
    }

    // MARK: Sections

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text("New task")
                    .font(.golos(21, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Text("From \(contactName)'s message · posts to the thread")
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted500)
            }
            Spacer()
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BrandColor.muted700)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(BrandColor.inset))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel")
        }
    }

    private var sourceQuote: some View {
        HStack(alignment: .top, spacing: 9) {
            RoundedRectangle(cornerRadius: 2)
                .fill(BrandColor.lime)
                .frame(width: 3)
            VStack(alignment: .leading, spacing: 3) {
                Text("\u{201C}\(message.body)\u{201D}")
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.muted700)
                    .lineLimit(4)
                Text("\(contactName) · \(bubbleTime(message.created_at))")
                    .font(.golos(10.5, weight: .semibold))
                    .foregroundStyle(BrandColor.muted300)
            }
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            BrandColor.inset,
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
    }

    private var titleField: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: "Title")
            TextField("Task title", text: $title, axis: .vertical)
                .font(.golos(14.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                .lineLimit(1 ... 3)
                .padding(.horizontal, 15)
                .padding(.vertical, 13)
                .background(
                    BrandColor.paper,
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
        }
    }

    /// Active teammates as tappable chips with a Nobody entry, mirroring
    /// Android. Inline rather than a nested picker sheet: assigning is one tap
    /// from the sheet that is already open, not three.
    private var assigneeRow: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: "Assign to")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(
                        controller.members.filter { $0.deactivated_at == nil },
                        id: \.user_id
                    ) { member in
                        let name = member.display_name.isBlank
                            ? "Teammate" : member.display_name
                        AssigneeChoiceChip(
                            name: name,
                            showsAvatar: true,
                            selected: assigneeId == member.user_id
                        ) {
                            assigneeId =
                                assigneeId == member.user_id ? nil : member.user_id
                        }
                    }
                    AssigneeChoiceChip(
                        name: "Nobody",
                        showsAvatar: false,
                        selected: assigneeId == nil
                    ) { assigneeId = nil }
                }
                .padding(.horizontal, 1)
                .padding(.vertical, 2)
            }
        }
    }

    private var dueRow: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                SectionHeader(label: "Due (optional)")
                if dueSuggested { suggestedHint }
                Spacer(minLength: 0)
            }
            HStack(spacing: 8) {
                Button {
                    duePickerOpen = true
                } label: {
                    HStack {
                        Text(dueDisplayLabel)
                            .font(.golos(14, weight: due == nil ? .regular : .semibold))
                            .foregroundStyle(due == nil ? BrandColor.muted500 : BrandColor.ink)
                        Spacer(minLength: 0)
                        Image(systemName: "calendar")
                            .font(.system(size: 13))
                            .foregroundStyle(BrandColor.muted400)
                    }
                    .padding(.horizontal, 15)
                    .padding(.vertical, 13)
                    .background(
                        BrandColor.paper,
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                    )
                }
                .buttonStyle(.plain)
                if due != nil {
                    Button {
                        due = nil
                        dueSuggested = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(BrandColor.muted300)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Clear due date")
                }
            }
        }
    }

    private var suggestedHint: some View {
        HStack(spacing: 3) {
            AiOrb(state: .idle, size: 11)
            Text("Suggested")
                .font(.golos(10.5, weight: .semibold))
        }
        .foregroundStyle(BrandColor.muted500)
    }

    private var addressBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    addrOpen.toggle()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "mappin.and.ellipse")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(BrandColor.muted500)
                        Text("Address")
                            .font(.golos(13.5, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                        if enriching {
                            ProgressView().controlSize(.mini)
                        }
                        if let label = addressProvenanceLabel(addrProvenance) {
                            addrBadge(label)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                Spacer(minLength: 0)

                // #220: one-tap clear of a suggested/typed address — shown
                // whenever the address has content (mirrors the web MakeTaskForm).
                if !addr.isEmpty {
                    Button("Clear", action: clearAddress)
                        .font(.golos(12.5, weight: .semibold))
                        .foregroundStyle(BrandColor.muted500)
                        .buttonStyle(.plain)
                        .accessibilityLabel("Clear address")
                }

                // Disclosure chevron stays the trailing affordance (parity with
                // Android/web); tapping it toggles like the label.
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(BrandColor.muted250)
                    .rotationEffect(.degrees(addrOpen ? 180 : 0))
                    .onTapGesture { addrOpen.toggle() }
            }

            if addrOpen {
                VStack(spacing: 8) {
                    addrField("Street", keyPath: \.street, field: .street)
                    HStack(spacing: 8) {
                        addrField("Unit / suite", keyPath: \.unit, field: .unit)
                        addrField("City", keyPath: \.city, field: .city)
                    }
                    HStack(spacing: 8) {
                        addrField("State / province", keyPath: \.state, field: .state)
                        addrField("Postal code", keyPath: \.postalCode, field: .postal)
                    }
                    // #214: the country is a typable, searchable picker. A
                    // selection is a user edit → mark the address "manual" (an
                    // enrichment assigns `addr` directly, bypassing this).
                    CountryField(value: $addr.country) {
                        addrProvenance = AddressProvenance.manual
                    }
                }
            }
        }
    }

    private func addrBadge(_ label: String) -> some View {
        HStack(spacing: 4) {
            AiOrb(state: .idle, size: 11)
            Text(label)
                .font(.golos(10.5, weight: .semibold))
        }
        .foregroundStyle(BrandColor.muted600)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(BrandColor.inset, in: Capsule())
    }

    /// A custom binding marks the address "manual" ONLY on a user keystroke —
    /// an enrichment assigning `addr` directly bypasses this setter, so the
    /// suggested provenance badge survives the pre-fill (the web's editAddr vs
    /// setAddr split).
    private func addrField(
        _ placeholder: String,
        keyPath: WritableKeyPath<AddressFieldValues, String>,
        field: AddrField
    ) -> some View {
        let binding = Binding<String>(
            get: { addr[keyPath: keyPath] },
            set: { newValue in
                addr[keyPath: keyPath] = newValue
                addrProvenance = AddressProvenance.manual
            }
        )
        return TextField(placeholder, text: binding)
            .font(.golos(13))
            .foregroundStyle(BrandColor.ink)
            .textInputAutocapitalization(.words)
            .autocorrectionDisabled()
            .focused($addrFocus, equals: field)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                BrandColor.inset,
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
    }

    private var createButton: some View {
        Button(action: create) {
            HStack(spacing: 10) {
                Text("Create task")
                    .font(.golos(15, weight: .semibold))
                    .foregroundStyle(BrandColor.canvas)
                Spacer()
                Image(systemName: "checkmark")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(BrandColor.onLime)
                    .frame(width: 42, height: 42)
                    .background(Circle().fill(BrandColor.lime))
            }
            .padding(.leading, 22)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            .background(Capsule().fill(BrandColor.ink))
        }
        .buttonStyle(.plain)
        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        .accessibilityLabel("Create task")
    }

    // MARK: Logic

    /// The due row's label: "today 3:00 PM" / "Jul 8 9:00 AM", or a placeholder.
    /// Reuses the tested `dueSentenceTime` helper (round-trips through the same
    /// offset-ISO encoder the create body uses).
    private var dueDisplayLabel: String {
        guard let due else { return "Add a due date" }
        return dueSentenceTime(isoOffsetString(due, timeZone: .current))
    }

    /// #220: wipe every address field and drop the provenance badge in one tap
    /// (the web MakeTaskForm's clearAddress). This is a draft — nothing persists
    /// until Create — so it only resets local state. Assigning `addr` whole
    /// bypasses the per-field binding that would re-mark it "manual".
    private func clearAddress() {
        addr = AddressFieldValues()
        addrProvenance = nil
    }

    private func create() {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        controller.makeTask(
            message,
            title: String(trimmed.prefix(taskTitleMax)),
            assignedUserId: assigneeId,
            dueAt: due.map { encodeDueAt($0) },
            address: addr,
            provenance: addrProvenance ?? AddressProvenance.manual
        )
        // #431: report only on an actual create. Somebody who closed the sheet has
        // told us nothing about whether the address was any good, and counting that
        // as a rejection would blame Lou for an unrelated decision.
        if let outcome = AiOutcome.forEnrichment(
            suggestedAddress: suggestedAddress,
            suggestedDue: suggestedDueAt != nil,
            addressEdited: !addr.isEmpty && addrProvenance == AddressProvenance.manual,
            addressCleared: addr.isEmpty,
            dueEdited: due != nil && due != suggestedDueAt,
            dueCleared: due == nil
        ) {
            controller.reportAiOutcome(feature: AiOutcome.featureEnrich, outcome: outcome)
        }
        onDismiss()
    }

    /// #214: on open, if any enrichment toggle is on and the message has text,
    /// enrich once and pre-fill the due (when empty) and the structured address
    /// (auto-expanded, with a provenance badge). Every value stays editable.
    private func enrichIfNeeded() async {
        if enrichStarted { return }
        enrichStarted = true
        let settings = await controller.aiSettingsForTaskDraft()
        guard settings.anyEnabled else { return }
        guard !message.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        enriching = true
        let result = await controller.enrichTaskDraft(for: message)
        enriching = false
        if result.enrichment_disabled == true { return }

        if settings.enrich_task_due, due == nil,
           let iso = result.due_at, let date = parseWireTimestamp(iso) {
            due = date
            dueSuggested = true
            suggestedDueAt = date
        }
        if settings.enrich_task_address, let address = result.address {
            let seeded = AddressFieldValues(address)
            if !seeded.isEmpty {
                addr = seeded
                addrProvenance = result.address_provenance
                addrOpen = true
                suggestedAddress = true
            }
        }
    }
}

/// A compact date + time picker for the make-task due. The caller encodes the
/// picked Date as offset-bearing ISO via `encodeDueAt`.
@MainActor
private struct MakeTaskDueSheet: View {
    let initial: Date?
    let onSet: @MainActor (Date) -> Void

    @State private var draft: Date
    @Environment(\.dismiss) private var dismiss

    init(initial: Date?, onSet: @escaping @MainActor (Date) -> Void) {
        self.initial = initial
        self.onSet = onSet
        let fallback = Calendar.current.date(
            bySettingHour: 9, minute: 0, second: 0, of: Date()
        ) ?? Date()
        _draft = State(initialValue: initial ?? fallback)
    }

    var body: some View {
        VStack(spacing: 12) {
            DatePicker(
                "Due",
                selection: $draft,
                displayedComponents: [.date, .hourAndMinute]
            )
            .datePickerStyle(.graphical)
            HStack {
                Button("Cancel") { dismiss() }
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Set due date") {
                    onSet(draft)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.olive)
            }
        }
        .padding(16)
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Previews

private func previewMessage(
    id: String,
    direction: String,
    body: String,
    status: String?,
    doneAt: String? = nil
) -> Message {
    Message(
        id: id,
        conversation_id: "c1",
        direction: direction,
        body: body,
        status: status,
        segments: 1,
        encoding: "gsm7",
        sent_by_user_id: direction == MessageDirection.inbound ? nil : "u1",
        error_code: nil,
        error_detail: nil,
        telnyx_message_id: nil,
        done_at: doneAt,
        done_by_user_id: doneAt == nil ? nil : "u1",
        pinned_at: nil,
        pinned_by_user_id: nil,
        created_at: "2026-07-15T15:04:00Z",
        attachments: [],
        has_task: false,
        promoted_task: nil,
        task_id: nil,
        task: nil
    )
}

#Preview("Thread timeline") {
    let actions = MessageBubbleActions(
        onToggleDone: {},
        onTogglePin: {},
        onRetry: {},
        onMakeTask: {},
        onCopied: {},
        onOpenTask: { _ in }
    )
    return ScrollView {
        VStack(spacing: 0) {
            PinnedBanner(
                pinned: [
                    previewMessage(
                        id: "m0",
                        direction: MessageDirection.inbound,
                        body: "Gate code is 4482",
                        status: MessageStatus.received
                    ),
                ],
                onJump: { _ in }
            )
            DayDividerLine(label: "Today")
            MessageBubble(
                message: previewMessage(
                    id: "m1",
                    direction: MessageDirection.inbound,
                    body: "Can you come by Tuesday morning?",
                    status: MessageStatus.received
                ),
                authorName: nil,
                doneByName: nil,
                noteFilesState: nil,
                onLoadNoteFiles: {},
                onOpenFile: { _ in },
                mintAttachmentUrl: { _, _ in "" },
                actions: actions
            )
            MessageBubble(
                message: previewMessage(
                    id: "m2",
                    direction: MessageDirection.outbound,
                    body: "Tuesday at 9 works. See you then!",
                    status: MessageStatus.delivered
                ),
                authorName: nil,
                doneByName: nil,
                noteFilesState: nil,
                onLoadNoteFiles: {},
                onOpenFile: { _ in },
                mintAttachmentUrl: { _, _ in "" },
                actions: actions
            )
            MessageBubble(
                message: previewMessage(
                    id: "m3",
                    direction: MessageDirection.note,
                    body: "Bring the long ladder — the gutter run is 30 ft.",
                    status: nil
                ),
                authorName: "Dana Fields",
                doneByName: nil,
                noteFilesState: nil,
                onLoadNoteFiles: {},
                onOpenFile: { _ in },
                mintAttachmentUrl: { _, _ in "" },
                actions: actions
            )
            EventLine(text: "Dana Fields moved this to Waiting", timeIso: "2026-07-15T15:10:00Z")
        }
    }
}
