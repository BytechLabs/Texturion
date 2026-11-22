import SwiftUI

/// One conversation: header (identity → contact panel, Call, status,
/// assignee, overflow) → interleaved timeline (newest-first,
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
    var findQuery: String? = nil
    var incomingShare: SharedAttachments? = nil
    var onShareConsumed: @MainActor () -> Void = {}
    let onBack: @MainActor () -> Void

    @State private var controller: ThreadController?
    @State private var composer: ComposerState?
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Group {
            if let controller, let composer {
                ThreadBody(
                    graph: graph,
                    companyId: companyId,
                    controller: controller,
                    composer: composer,
                    me: me,
                    highlightMessageId: highlightMessageId,
                    findQuery: findQuery,
                    incomingShare: incomingShare,
                    onShareConsumed: onShareConsumed,
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
                        meApi: graph.meApi,
                        locale: appLocale
                    ),
                    contacts: ContactMutations(
                        api: graph.api,
                        multipart: MultipartClient(api: graph.api, sessionStore: graph.sessionStore)
                    ),
                    companyId: companyId,
                    conversationId: conversationId,
                    meUserId: me.user_id,
                    outbox: graph.outbox.store,
                    requestOutboxFlush: graph.outbox.requestFlush
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
            }
        }
        .onChange(of: graph.outbox.store.all(), initial: true) { _, rows in
            controller?.updateQueuedRows(rows)
        }
        // #215 Part A: a frame missed while this thread was backgrounded/blurred
        // (the #215 repro) self-heals on return — the same page-1 refetch the
        // socket re-JOIN runs.
        .resyncOnForeground {
            controller?.refreshAfterReconnect()
        }
    }
}

@MainActor
struct ThreadActionCards<Content: View>: View {
    private let content: () -> Content
    @State private var contentHeight: CGFloat = 1

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0, content: content)
                .onGeometryChange(for: CGFloat.self) { proxy in
                    proxy.size.height
                } action: { height in
                    contentHeight = min(height, 192)
                }
        }
        .frame(height: contentHeight)
        .scrollBounceBehavior(.basedOnSize)
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
    case tags

    var id: String {
        switch self {
        case .conversation: "conversation"
        case .contactPanel: "contact"
        case .assignee: "assignee"
        case .tags: "tags"
        }
    }
}

private struct MessagePhoneSelection: Identifiable {
    let number: String
    var id: String { number }
}

@MainActor
private struct ThreadBody: View {
    let graph: AppGraph
    let companyId: String
    @Bindable var controller: ThreadController
    let composer: ComposerState
    let me: Me
    let highlightMessageId: String?
    let findQuery: String?
    let incomingShare: SharedAttachments?
    let onShareConsumed: @MainActor () -> Void
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
    @State private var quoteDraftOpen = false
    @State private var newTaskOpen = false
    @State private var detailSheet: ThreadDetailSheet?
    @State private var confirmOptOut = false
    @State private var confirmRevoke = false
    @State private var confirmBlock = false
    @State private var confirmDiscardQueued: PendingSend?
    @State private var deletingMessage: PendingMessageDeletion?
    @State private var confirmDeleteConversation = false
    @State private var showNewPill = false
    /// #302: who else is on this thread, and this viewer's typing window.
    @State private var presenceByTopic: [String: PresenceMap] = [:]
    @State private var presenceNow = Date().timeIntervalSince1970
    @State private var typingUntilMs = 0
    @State private var lastTypingSentMs = 0
    @State private var isAtBottom = true
    @State private var jumpToMessageId: String?
    @State private var findOpen: Bool?
    @State private var findTarget: String?
    /// The message to FLASH (search-result indication); cleared after ~2.2s.
    @State private var flashMessageId: String?
    @State private var visibleNotice: ThreadNotice?
    @State private var noticeDismissTask: Task<Void, Never>?
    @State private var galleryOpen = false
    @State private var placingCall = false
    @State private var messagePhone: MessagePhoneSelection?
    @State private var afterMessagePhoneDismiss: (@MainActor () -> Void)?
    @Environment(\.openURL) private var openURL
    @Environment(\.appLocale) private var appLocale

    private var canLinkPhones: Bool {
        guard let detail = controller.conversation else { return false }
        return controller.canLinkMessagePhones && !detail.is_spam && detail.spam_suspected_at == nil
    }

    private var canContactPhone: Bool {
        controller.conversation?.viewer_level == "text" &&
            me.memberships.first { $0.company_id == companyId }?.role != MemberRole.readOnly
    }

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
        .sheet(
            item: $messagePhone,
            onDismiss: {
                let action = afterMessagePhoneDismiss
                afterMessagePhoneDismiss = nil
                if canLinkPhones && canContactPhone { action?() }
            }
        ) { selection in
            messagePhoneSheet(selection.number)
        }
        .onChange(of: canLinkPhones) { _, allowed in
            if !allowed { messagePhone = nil }
        }
        // #690: a note's `#T-142` draws as a chip, resolved once per workspace.
        .environment(
            \.referenceResolver,
            ReferenceResolverStore.shared.resolver(api: graph.api, companyId: companyId)
        )
        .onChange(of: controller.notice?.id) { _, _ in
            guard let notice = controller.notice else { return }
            visibleNotice = notice
            noticeDismissTask?.cancel()
            noticeDismissTask = Task {
                try? await Task.sleep(for: .seconds(notice.seconds))
                if !Task.isCancelled { visibleNotice = nil }
            }
        }
        // Mark read on open and again whenever the newest message id changes.
        .task(id: controller.newestMessageId ?? "") {
            controller.markRead()
        }
        .task(id: controller.conversation == nil ? nil : incomingShare?.id) {
            if let incomingShare, controller.conversation != nil { await stageShare(incomingShare) }
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private func stageShare(_ share: SharedAttachments) async {
        guard canContactPhone, !controller.conversationDeleted else {
            onShareConsumed()
            return
        }
        let forNote = composer.mode == .note
        let room = forNote ? maxNoteFiles - composer.files.count : maxPhotos - composer.photos.count
        let locale = appLocale
        var files: [StagedFile] = []
        var photos: [StagedPhoto] = []
        var notice: String?
        defer { files.forEach(discardStagedFile) }
        for url in share.files.prefix(max(0, room)) {
            if Task.isCancelled { return }
            if forNote {
                switch await Task.detached(operation: { stageNoteFile(pickedURL: url, locale: locale) }).value {
                case .ready(let file): files.append(file)
                case .rejected(let reason): notice = reason
                }
            } else {
                switch await Task.detached(operation: { stageMmsMedia(pickedURL: url, locale: locale) }).value {
                case .ready(let photo): photos.append(photo)
                case .rejected(let reason): notice = reason
                }
            }
        }
        if Task.isCancelled { return }
        if share.files.count > room {
            notice = forNote
                ? AppStrings.translate(locale, "thread.attachLimitNote")
                : AppStrings.translate(locale, "thread.attachLimitPhotos", ["max": String(maxPhotos)])
        }
        let filesToAdd = min(files.count, max(0, maxNoteFiles - composer.files.count))
        composer.files.append(contentsOf: files.prefix(filesToAdd))
        files.removeFirst(filesToAdd)
        composer.photos.append(contentsOf: photos.prefix(max(0, maxPhotos - composer.photos.count)))
        if let notice { controller.notifyExternally(notice) }
        share.discard()
        onShareConsumed()
    }

    private func messagePhoneSheet(_ number: String) -> some View {
        NavigationStack {
            List {
                if canContactPhone {
                    Button(AppStrings.translate(appLocale, "thread.callWithLoonext")) {
                        afterMessagePhoneDismiss = {
                            AppRouter.shared.openCalls = true
                            AppRouter.shared.dialTo = number
                        }
                        messagePhone = nil
                    }
                    Button(AppStrings.translate(appLocale, "thread.textPhoneNumber")) {
                        afterMessagePhoneDismiss = { AppRouter.shared.composeTo = number }
                        messagePhone = nil
                    }
                }
                Button(AppStrings.translate(appLocale, "contactsTasks.copyNumber")) {
                    UIPasteboard.general.string = number
                    controller.markCopied()
                    messagePhone = nil
                }
            }
            .navigationTitle(formatPhone(number))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(AppStrings.translate(appLocale, "common.close")) { messagePhone = nil }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private var content: some View {
        switch controller.load {
        case .loading:
            CenteredLoading()
        case .failed(let message):
            if controller.loadErrorCode == ApiErrorCode.notFound {
                VStack(spacing: 12) {
                    Text(AppStrings.translate(appLocale, "thread.notFound"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button(
                        AppStrings.translate(appLocale, "thread.backToInbox"),
                        action: onBack
                    )
                    .buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                LoadError(message: message) { controller.retryInitialLoad() }
            }
        case .ready:
            if controller.conversationDeleted {
                deletedPane
            } else {
                loaded
            }
        }
    }

    /// #691: the thread after "Delete conversation". It sits in the Trash for
    /// 30 days, so the way back is on screen rather than behind a toast that
    /// would leave with this screen.
    private var deletedPane: some View {
        VStack(spacing: 12) {
            Image(systemName: "trash")
                .font(.scaled(28, weight: .regular))
                .foregroundStyle(BrandColor.muted500)
                .accessibilityHidden(true)
            Text(AppStrings.translate(appLocale, "thread.conversationDeleted"))
                .font(.golos(16, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Text(AppStrings.translate(appLocale, "thread.conversationDeletedBody"))
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted500)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button(Toast.undoLabel(appLocale)) {
                controller.restoreConversation()
            }
            .buttonStyle(.bordered)
            // #710/#735: the native Trash.
            Button(AppStrings.translate(appLocale, "trash.viewTrash")) {
                AppRouter.shared.openTrash = true
            }
            .buttonStyle(.bordered)
            Button(
                AppStrings.translate(appLocale, "thread.backToInbox"),
                action: onBack
            )
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// #691: this viewer may delete records in THIS workspace. Resolved from the
    /// same membership the rest of the screen reads its role from.
    private var canDeleteRecords: Bool {
        let workspaceId = controller.conversation?.company_id
        let role = me.memberships
            .first(where: { $0.company_id == workspaceId })?.role
        return RecordDeletion.canDelete(role: role)
    }

    private func deleteMessageAction(for message: Message) -> (@MainActor () -> Void)? {
        guard canDeleteRecords else { return nil }
        return { deletingMessage = PendingMessageDeletion(message: message) }
    }

    /// `conversations.note`: status, assignment, pin, spam and block. Resolved from the
    /// same membership the rest of the screen reads its role from.
    private var canWriteConversations: Bool {
        let workspaceId = controller.conversation?.company_id
        let role = me.memberships
            .first(where: { $0.company_id == workspaceId })?.role
        return RecordViewer(role: role).canWrite
    }

    private func deleteConversationAction() -> (@MainActor () -> Void)? {
        guard canDeleteRecords else { return nil }
        return {
            detailSheet = nil
            confirmDeleteConversation = true
        }
    }

    /// #716: the sheet's Catch me up row, present while the thread offers one
    /// and none has been asked for.
    private func catchUpMenuAction() -> (@MainActor () -> Void)? {
        guard controller.catchUpOffer.isOffered, controller.catchUp.isIdle else { return nil }
        return {
            detailSheet = nil
            controller.catchMeUp()
        }
    }

    /// #726: owners manage lead sources where a number's source is set;
    /// everyone else is not offered it.
    private func addLeadSourceAction() -> (@MainActor () -> Void)? {
        let role = me.memberships.first(where: { $0.company_id == companyId })?.role
        guard canAddLeadSource(role: role) else { return nil }
        return {
            detailSheet = nil
            AppRouter.shared.openSettingsSection = .numbers
        }
    }

    @ViewBuilder
    private var loaded: some View {
        if let detail = controller.conversation {
            let names = memberNames(controller.members, locale: appLocale)
            let contactName = detail.contact.name ?? formatPhone(detail.contact.phone_e164)
            // #224: this viewer's role in THIS workspace. Resolved here rather
            // than inside the payments pane so the pane stays presentational,
            // and resolved the same way `composerPane` and the settings index
            // already do it — a second reading of "who is this" is a second
            // answer waiting to disagree.
            //
            // `first(where:)` spelled out rather than `.first { … }`, for the
            // reason `composerPane` records further down: Swift has BOTH a
            // `first` property and a `first(where:)` method, and a closure whose
            // type cannot be inferred on the spot resolves to the property.
            let viewerRole = me.memberships
                .first(where: { $0.company_id == detail.company_id })?.role

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
                    onFind: { findOpen = true },
                    onCall: { startCall(detail: detail, contactName: contactName) }
                )

                if findOpen ?? (findQuery?.isBlank == false) {
                    ThreadFindBar(
                        initialQuery: findQuery ?? "",
                        initialMessage: highlightMessageId,
                        find: { query in
                            try await MessagingRepository(api: graph.api)
                                .findMessages(companyId: companyId, conversationId: detail.id, query: query)
                        },
                        onJump: { findTarget = $0 },
                        onClose: {
                            findOpen = false
                            findTarget = nil
                        }
                    )
                    .task(id: findTarget) {
                        guard let target = findTarget else { return }
                        let loaded = await controller.ensureMessageLoaded(target)
                        guard !Task.isCancelled else { return }
                        if loaded {
                            controller.filter = ThreadFilter()
                            jumpToMessageId = target
                            flashMessageId = target
                        }
                        findTarget = nil
                    }
                }

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
                    SnoozedBanner(label: snoozeReturnLabel(until, locale: appLocale)) {
                        controller.unsnooze()
                    }
                }

                if !controller.pinnedMessages.isEmpty {
                    PinnedStack(
                        conversationId: controller.conversationId,
                        pinned: pinsNewestFirst(controller.pinnedMessages)
                    ) { messageId in
                        Task {
                            if await controller.ensureMessageLoaded(messageId) {
                                jumpToMessageId = messageId
                            }
                        }
                    }
                    .id(controller.conversationId)
                }

                // #247: the catch-up, LAST in the banner stack and immediately
                // above the stream it summarises. Every banner above it is a
                // fact about the conversation — is this a customer, is this
                // deferred, what did somebody pin — and those outrank one
                // machine's reading of the thread. Nothing here reorders or
                // hides anything: it sits on top of the inbox, and the inbox is
                // still the inbox.
                ThreadSummaryCard(
                    offer: controller.catchUpOffer,
                    state: controller.catchUp,
                    onAsk: { controller.askForCatchUp() },
                    onOpenMessage: { messageId in
                        // The pinned banner's exact path: load the message if it
                        // is beyond the first page, then jump. A cited line that
                        // scrolled to nothing would break the one promise this
                        // card makes.
                        controller.reportCatchUpOpened()
                        Task {
                            if await controller.ensureMessageLoaded(messageId) {
                                jumpToMessageId = messageId
                            }
                        }
                    },
                    onHide: { controller.hideCatchUp() }
                )

                timelinePane(
                    names: names,
                    contactName: contactName,
                    allowFailureActions: canContactPhone && controller.threadOptedOut != true
                )

                presenceStrip(detail: detail)
                ThreadActionCards {
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
                    ScheduledStrip(
                        rows: controller.scheduled,
                        clock: detail.destination_clock,
                        onUpdate: controller.updateScheduled,
                        onCancel: controller.cancelScheduled
                    )
                    // #224: what this thread is owed, what it was paid, and the ask.
                    // Directly above the composer for the same reason the scheduled
                    // strip is — it is STATE, not history, and it changes without
                    // anybody here doing anything: a customer pays, a bank pulls a
                    // payment back, a link expires. Below the scheduled strip
                    // because a text that has not gone yet is about to leave this
                    // phone, and a bill that was already sent is not.
                    //
                    // Draws nothing on almost every thread, and nothing at all for a
                    // notes-only viewer.
                    ThreadPaymentsPane(
                        api: graph.api,
                        companyId: detail.company_id,
                        conversationId: detail.id,
                        role: viewerRole,
                        viewerLevel: detail.viewer_level,
                        messageLocale: MessageLocale.resolve(
                            contact: detail.contact.locale,
                            company: controller.company?.locale
                        ),
                        businessName: controller.company?.name,
                        // #607: the strip's live wire. The controller is the thread's
                        // only realtime listener, so a `payment.updated` naming this
                        // conversation arrives there and is handed down as a tick —
                        // which the pane turns into one refetch of its list.
                        paymentChangedTick: controller.paymentChangedTick,
                        // The ask sends an ordinary text, so the transcript has a
                        // message it has not seen. The same catch-up the socket
                        // re-JOIN runs, rather than a second refetch path that could
                        // disagree with it.
                        onSent: { controller.refreshAfterReconnect() }
                    )
                    // #287: beside the payment strip because they are the same kind
                    // of thing — state that changes without anybody here doing
                    // anything. Never on a note: a note goes to the crew, a quote
                    // goes to the customer.
                    ThreadQuotesPane(
                        api: graph.api,
                        companyId: detail.company_id,
                        conversationId: detail.id,
                        quoteChangedTick: controller.quoteChangedTick,
                        role: viewerRole,
                        viewerLevel: detail.viewer_level,
                        draftOpen: Binding(
                            get: { quoteDraftOpen && composer.mode == .text },
                            set: { quoteDraftOpen = $0 }
                        ),
                        onSent: { controller.refreshAfterReconnect() }
                    )
                }

                // #716: Lou's catch-up offer, one line beside the input.
                // Answering it (Recap or Not now) hides it until somebody else
                // sends something newer; the conversation sheet keeps Catch me up.
                if catchUpHintShown(
                    offered: controller.catchUpOffer.isOffered,
                    recapOpen: !controller.catchUp.isIdle,
                    newestFromOthersId: controller.newestFromOthersId,
                    answeredId: controller.catchUpAnsweredId
                ) {
                    CatchUpHint(
                        onRecap: { controller.catchMeUp() },
                        onNotNow: { controller.answerCatchUp() }
                    )
                }
                optOutHintActions(detail: detail, viewerRole: viewerRole)
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
            .sheet(item: $detailSheet) { which in
                switch which {
                case .conversation:
                    ConversationSheet(
                        controller: controller,
                        detail: detail,
                        contactName: contactName,
                        onOpenContactPanel: { detailSheet = .contactPanel },
                        onAssign: { detailSheet = .assignee },
                        onManageTags: { detailSheet = .tags },
                        onOpenGallery: { detailSheet = nil; galleryOpen = true },
                        onNewTask: { detailSheet = nil; newTaskOpen = true },
                        onMarkUnread: {
                            // Leaving a thread unread means leaving it: opening it again reads it.
                            detailSheet = nil
                            controller.markUnread()
                            onBack()
                        },
                        onCatchUp: catchUpMenuAction(),
                        onOptOut: { detailSheet = nil; confirmOptOut = true },
                        onRevokeOptOut: { detailSheet = nil; confirmRevoke = true },
                        onBlock: { detailSheet = nil; confirmBlock = true },
                        onRefresh: { detailSheet = nil; controller.refreshAfterReconnect() },
                        onDismiss: { detailSheet = nil },
                        onDeleteConversation: deleteConversationAction(),
                        canWrite: canWriteConversations
                    )
                case .contactPanel:
                    ContactPanelSheet(
                        graph: graph,
                        companyId: companyId,
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
                        },
                        onCall: {
                            detailSheet = nil
                            startCall(detail: detail, contactName: contactName)
                        },
                        calling: placingCall,
                        onAddLeadSource: addLeadSourceAction()
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
                case .tags:
                    TagManageSheet(
                        repo: controller.repo,
                        companyId: detail.company_id,
                        attached: detail.tags,
                        mayCreate: controller.company?.tags_locked != true
                            || MemberRole.has(viewerRole, Capability.settingsManage),
                        onAttach: { controller.attachTag($0) },
                        onDetach: { controller.detachTag($0) }
                    )
                }
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
            .confirmDialog(
                AppStrings.translate(appLocale, "thread.optOutTitle"),
                isPresented: $confirmOptOut,
                message: AppStrings.translate(appLocale, "thread.optOutBody"),
                confirmLabel: AppStrings.translate(appLocale, "thread.optOut"),
                tone: .standard
            ) {
                controller.setThreadOptOut(enabled: true)
            }
            .confirmDialog(
                AppStrings.translate(appLocale, "thread.blockTitle"),
                isPresented: $confirmBlock,
                message: AppStrings.translate(appLocale, "thread.blockBody"),
                confirmLabel: AppStrings.translate(appLocale, "thread.blockConfirm")
            ) {
                controller.blockNumber()
            }
            .confirmDialog(
                AppStrings.translate(appLocale, "thread.revokeTitle"),
                isPresented: $confirmRevoke,
                message: AppStrings.translate(appLocale, "thread.revokeBody"),
                confirmLabel: AppStrings.translate(appLocale, "thread.removeOptOut"),
                tone: .standard
            ) {
                controller.setThreadOptOut(enabled: false)
            }
            // #234: deleting a queued message throws away words the person
            // wrote and that nothing else holds — the draft is long gone by
            // then. Confirming is the one place in this screen where a step is
            // worth the friction.
            // *Applying: Ethical Friction — a deliberate pause before the
            // irreversible.*
            .confirmDialog(
                AppStrings.translate(appLocale, "thread.deleteQueuedTitle"),
                item: $confirmDiscardQueued,
                // Quoting it back is the point: a queued row shows a couple of
                // lines, and the person is about to lose whichever ones they
                // cannot see. The quotation marks are punctuation around the
                // customer's own words, so they stay out of the catalogue.
                message: { pending in
                    AppStrings.translate(appLocale, "thread.deleteQueuedBody")
                        + "\n\n“\(pending.body)”"
                },
                confirmLabel: AppStrings.translate(appLocale, "common.delete"),
                cancelLabel: AppStrings.translate(appLocale, "thread.keepIt")
            ) { pending in
                controller.discardQueued(pending.localId)
            }
            .modifier(
                ThreadDeleteAlertsModifier(
                    controller: controller,
                    contactName: contactName,
                    message: $deletingMessage,
                    conversation: $confirmDeleteConversation
                )
            )
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
                        locale: appLocale,
                        onDismiss: { makeTaskFor = nil }
                    )
                }
            }
            .newTaskSheet(
                isPresented: $newTaskOpen,
                graph: graph,
                companyId: companyId,
                conversationId: controller.conversationId,
                contactName: contactName
            )
        }
    }

    // MARK: - Timeline

    private func timelinePane(
        names: [String: String],
        contactName: String,
        allowFailureActions: Bool
    ) -> some View {
        let (messages, reactions) = foldTapbacks(controller.messages)
        let timeline = buildTimeline(
            messages: messages,
            events: controller.events,
            pending: controller.pendingSends,
            filter: controller.filter,
            allMessagesLoaded: controller.allMessagesLoaded,
            calendar: .current,
            now: Date(),
            locale: appLocale,
            awayFromNewest: controller.awayFromNewest
        )
        return ZStack(alignment: .bottom) {
            if timeline.isEmpty {
                Text(AppStrings.translate(appLocale, "thread.noMessages"))
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(timeline.enumerated()), id: \.element.key) { index, item in
                                let flashed = isFlashed(item)
                                itemView(
                                    item, names: names, contactName: contactName,
                                    reactions: reactions, allowFailureActions: allowFailureActions
                                )
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
                        // Paging down an anchored window changes the first row too.
                        if controller.awayFromNewest { return }
                        if isAtBottom {
                            if let first = timeline.first {
                                proxy.scrollTo(first.key, anchor: .bottom)
                            }
                        } else if controller.messages.first?.sent_by_user_id != me.user_id {
                            showNewPill = true
                        }
                    }
                    .onChange(of: controller.pendingSends.count) { _, count in
                        // Your own send always wants the bottom, so leave an
                        // anchored window first.
                        if count > 0, controller.awayFromNewest {
                            Task { await controller.jumpToLatest() }
                            return
                        }
                        if isAtBottom, let first = timeline.first {
                            proxy.scrollTo(first.key, anchor: .bottom)
                        }
                    }
                    // "New message ↓" pill when an inbound lands while scrolled up.
                    .onChange(of: controller.newInboundTick) { _, tick in
                        guard tick > 0, !controller.awayFromNewest else { return }
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
                        if showNewPill || controller.awayFromNewest {
                            Button {
                                showNewPill = false
                                Task {
                                    await controller.jumpToLatest()
                                    if let first = timeline.first {
                                        withAnimation { proxy.scrollTo(first.key, anchor: .bottom) }
                                    }
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    Text(
                                        AppStrings.translate(
                                            appLocale,
                                            controller.awayFromNewest
                                                ? "thread.jumpToLatest"
                                                : "thread.newMessagePill"
                                        )
                                    )
                                    .font(.golos(12, weight: .semibold))
                                    Image(systemName: "chevron.down")
                                        .font(.scaled(IconSize.small, weight: .semibold))
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
        // #718: an anchored window also pages the other way. The first index
        // is the newest row, so nearing it means nearing the end of what is
        // loaded.
        if index <= 4, controller.awayFromNewest {
            controller.loadNewerMessages()
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
        // The sentence is the event line's, which is composed elsewhere; only
        // the destination is ours to translate, so it is appended rather than
        // interpolated into a catalogue string that would then have to carry
        // somebody else's grammar.
        switch target {
        case .openTask:
            return "\(sentence). "
                + AppStrings.translate(appLocale, "thread.openTheTask")
        case .jumpToMessage:
            return "\(sentence). "
                + AppStrings.translate(appLocale, "thread.goToMessage")
        }
    }

    /// True when this timeline item is the search-highlight target currently
    /// flashing (#186 item 2).
    private func isFlashed(_ item: TimelineItem) -> Bool {
        guard let flashMessageId, case .message(let message) = item else { return false }
        return message.id == flashMessageId
    }

    /// The name under a bubble. #101: a teammate's, so a shared inbox shows who
    /// already answered; #725: an automated text names its automation instead.
    private func bubbleAuthorName(_ message: Message, names: [String: String]) -> String? {
        if message.direction == MessageDirection.note {
            return message.sent_by_user_id.flatMap { names[$0] }
                ?? AppStrings.translate(appLocale, "thread.internalNote")
        }
        if message.direction == MessageDirection.outbound {
            return messageSenderLabel(message, names: names, locale: appLocale)
        }
        return nil
    }

    @ViewBuilder
    private func itemView(
        _ item: TimelineItem,
        names: [String: String],
        contactName: String,
        reactions: [String: String],
        allowFailureActions: Bool
    ) -> some View {
        switch item {
        case .message(let message):
            MessageBubble(
                message: message,
                // #101 shared-inbox attribution: in a shared inbox the first
                // question about an outbound text is who already answered this
                // customer, so sends carry the teammate's name like the web.
                authorName: message.direction == MessageDirection.inbound
                    ? contactName
                    : bubbleAuthorName(message, names: names),
                doneByName: message.done_by_user_id.flatMap { names[$0] },
                noteFilesState: message.direction == MessageDirection.note
                    ? controller.noteFiles[message.id]
                    : nil,
                onLoadNoteFiles: { controller.loadNoteFiles(message.id) },
                onOpenFile: { openFile($0) },
                mintAttachmentUrl: {
                    try await controller.mintAttachmentUrl($0, variant: $1)
                },
                actions: messageActions(
                    for: message,
                    contactName: contactName,
                    allowFailureActions: allowFailureActions
                ),
                onSelectPhone: canLinkPhones ? { messagePhone = MessagePhoneSelection(number: $0) } : nil,
                reaction: reactions[message.id]
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
            let sentence = eventLine(
                event,
                memberNames: names,
                contactName: contactName,
                locale: appLocale
            )
            EventLine(
                text: sentence,
                timeIso: event.created_at,
                transcript: voicemailTranscript(of: event),
                voicemailIntake: event.voicemail_intake,
                onTap: eventTapAction(for: event),
                tapLabel: eventTapLabel(for: event, sentence: sentence),
                trailing: callTaskTrailing(for: event)
            )
        case .dayDivider(let label, _):
            DayDividerLine(label: label)
        }
    }

    private func messageActions(
        for message: Message,
        contactName: String,
        allowFailureActions: Bool
    ) -> MessageBubbleActions {
        var actions = MessageBubbleActions(
            onToggleDone: { controller.toggleDone(message) },
            onTogglePin: { controller.togglePin(message) },
            onRetry: { controller.retrySend(message.id) },
            onMakeTask: { makeTaskFor = message },
            onCopied: { controller.markCopied() },
            onOpenTask: { AppRouter.shared.openTaskId = $0 },
            onDelete: deleteMessageAction(for: message)
        )
        if allowFailureActions {
            actions.onSendAgain = { draftFailedText(message.body) }
            actions.onCall = {
                guard let detail = controller.conversation else { return }
                startCall(detail: detail, contactName: contactName)
            }
        }
        return actions
    }

    private func draftFailedText(_ body: String) {
        guard composer.text.isBlank, composer.photos.isEmpty, composer.files.isEmpty else {
            controller.notifyExternally(AppStrings.translate(appLocale, "thread.finishCurrentDraft"))
            return
        }
        composer.mode = .text
        composer.onTextChange(body)
    }

    private func callTaskTrailing(for event: ConversationEvent) -> AnyView? {
        let session = answeredCallSessionId(of: event)
        guard session != nil || event.voicemail_task != nil,
              let companyId = controller.conversation?.company_id
        else { return nil }
        return AnyView(
            CallTaskButton(
                graph: graph,
                companyId: companyId,
                conversationId: event.conversation_id,
                callerName: callLineCaller(of: event, locale: appLocale),
                sessionId: session,
                voicemailDraft: event.voicemail_task
            )
        )
    }

    private func openFile(_ attachment: Attachment, requested: Bool = false) {
        // #289: the thread above already rendered from a 200 KB preview; this
        // is the 25 MB one, and it waits for Wi-Fi when somebody asked it to.
        // The notice carries the action, so the escape is per-photo rather than
        // per-session — the point of the setting is that data is spent
        // deliberately.
        guard MeteredMedia.mayFetch(
            variant: "original",
            connection: ConnectionWatch.shared.connection,
            wifiOnlyOriginals: graph.prefs.wifiOnlyOriginals,
            requested: requested
        ) else {
            controller.notifyExternally(
                AppStrings.translate(appLocale, MeteredMedia.meteredHint),
                actionLabel: AppStrings.translate(appLocale, "thread.loadAnyway"),
                action: { openFile(attachment, requested: true) }
            )
            return
        }
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

    private func startCall(detail: ConversationDetail, contactName: String) {
        guard !placingCall, controller.threadOptedOut != true else { return }
        let manager = CallsManager.get(graph: graph)
        Task {
            if !manager.hasMicPermission {
                guard await manager.requestMicPermission() else {
                    controller.notifyExternally(
                        AppStrings.translate(
                            appLocale, "thread.micNeededForCalls"
                        )
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
            healthy: presenceByTopic[topic] != nil,
            locale: appLocale
        )
        if let line = presenceLabel(viewers, locale: appLocale) {
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

    @ViewBuilder
    private func optOutHintActions(detail: ConversationDetail, viewerRole: String?) -> some View {
        if let hintAt = detail.opt_out_hint_at,
           let viewerRole, viewerRole != MemberRole.readOnly
        {
            HStack {
                Button(AppStrings.translate(appLocale, "thread.optOutHintConfirm")) {
                    controller.resolveOptOutHint(hintAt, optedOut: true)
                }
                Button(AppStrings.translate(appLocale, "thread.optOutHintDismiss")) {
                    controller.resolveOptOutHint(hintAt, optedOut: false)
                }
            }
            .buttonStyle(.bordered)
        }
    }

    private func composerPane(detail: ConversationDetail) -> some View {
        // #315: a view-only observer may read this thread and change nothing
        // in it. Resolved from the membership, the same way the settings index
        // does it.
        let viewerReadOnly = me.memberships
            .first { $0.company_id == detail.company_id }?.role == MemberRole.readOnly
        let banner = selectComposerBanner(
            contactOptedOut: controller.threadOptedOut == true,
            contactOptOutSource: controller.threadOptOutSource,
            subscriptionStatus: controller.company?.subscription_status
                ?? SubscriptionStatus.active,
            destinationCountry: Nanp.destinationCountry(detail.contact_phone_e164 ?? detail.contact.phone_e164),
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
                // The SUBJECT stays English on purpose — it is the inbox's
                // index, and one carrier suspension reported from Montreal and
                // from Calgary has to arrive under one heading. The SITUATION
                // is the sentence the reporter reads, so it is theirs.
                subject: supportSubjectFor(kind),
                situation: supportSituation(kind, appLocale),
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
                    seconds: seconds,
                    locale: appLocale
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
        let onNewQuote: (@MainActor () -> Void)?
        if detail.viewer_level == "text", !viewerReadOnly {
            onNewQuote = { @MainActor in quoteDraftOpen = true }
        } else {
            onNewQuote = nil
        }
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
                )
            },
            onSaveNote: { body, files, mentionUserIds, workPhase in
                let picked = composer.picked
                controller.saveNote(
                    body: body,
                    files: files,
                    mentionUserIds: mentionUserIds,
                    workPhase: workPhase
                ) {
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
                    body: OnMyWay.text(
                        minutes,
                        // The CUSTOMER's language, not the crew's: this is the
                        // one body composed on the client rather than by the
                        // server, so the resolution happens here.
                        template: OnMyWay.bodyFor(
                            contact: detail.contact.locale,
                            company: controller.company?.locale
                        )
                    ),
                    photos: []
                )
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
            onScheduleSend: onScheduleSend,
            // #690: `#` in a note points at a task, contact or conversation.
            searchReferences: referenceSearchClosure(graph: graph, companyId: detail.company_id),
            onNewQuote: onNewQuote
        )
    }
}

// MARK: - Header

private struct PendingMessageDeletion: Identifiable {
    let message: Message
    var id: String { message.id }
}

private struct ThreadDeleteAlertsModifier: ViewModifier {
    let controller: ThreadController
    let contactName: String
    @Binding var message: PendingMessageDeletion?
    @Binding var conversation: Bool

    @Environment(\.appLocale) private var appLocale

    func body(content: Content) -> some View {
        content
            .sheet(item: $message) { pending in
                TrashSourceSheet(
                    source: RecordDeletion.isNote(pending.message) ? .note : .message,
                    sentTextNotice: RecordDeletion.isSentText(pending.message)
                        ? AppStrings.translate(appLocale, "thread.deleteSentBody") : nil,
                    loadTasks: { try await controller.linkedJobsForDeleting(pending.id) },
                    onDismiss: { message = nil },
                    onConfirm: { includeTasks in
                        message = nil
                        controller.deleteMessage(pending.message, includeTasks: includeTasks)
                    }
                )
            }
            .confirmDialog(
                AppStrings.translate(
                    appLocale,
                    "thread.deleteConversationTitle",
                    ["name": contactName]
                ),
                isPresented: $conversation,
                message: AppStrings.translate(appLocale, "thread.deleteConversationBody"),
                confirmLabel: AppStrings.translate(appLocale, "common.delete"),
                cancelLabel: AppStrings.translate(appLocale, "thread.keepIt")
            ) {
                controller.deleteConversation()
            }
    }
}

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
    let onFind: @MainActor () -> Void
    let onCall: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    /// The one status line under the name: status · assignee (or number), plus
    /// an opted-out tail — the Android header subtitle.
    private var subtitle: String {
        var parts = statusLabel(detail.status, locale: appLocale)
        let assigneeName = controller.members
            .first { $0.user_id == detail.assigned_user_id }?
            .display_name
        let trailing = (assigneeName?.isBlank == false) ? assigneeName! : phoneLabel
        parts += " · \(trailing)"
        if controller.threadOptedOut == true {
            parts += " · " + AppStrings.translate(appLocale, "thread.optedOut")
        }
        if controller.blockedSender != nil {
            parts += " · " + AppStrings.translate(appLocale, "thread.blockedBadge")
        }
        if detail.muted == true {
            parts += " · " + AppStrings.translate(appLocale, "thread.mutedBadge")
        }
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
        contactRepeatBadge(controller.contact?.conversation_count, locale: appLocale)
    }

    /// VoiceOver hears the chip too.
    ///
    /// An `accessibilityLabel` on a Button REPLACES its children's text, so a
    /// chip left out of this string is a signal that does not exist at all for
    /// a screen-reader user — which is the same complaint #505 opened with, one
    /// surface further in.
    private var identityLabel: String {
        guard let badge = repeatBadge else {
            return AppStrings.translate(
                appLocale, "thread.conversationOptions", ["name": contactName]
            )
        }
        return AppStrings.translate(
            appLocale,
            "thread.conversationOptionsBadge",
            ["name": contactName, "badge": badge]
        )
    }

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onBack) {
                Image(systemName: "chevron.backward")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandColor.ink)
                    .frame(width: 36, height: 36)
            }
            .accessibilityLabel(AppStrings.translate(appLocale, "common.back"))

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

            // #565: the thread an urgent notification opens has to say it is
            // one. OUTSIDE the identity button, for two reasons: that button's
            // `accessibilityLabel` REPLACES its children, so a mark inside it
            // would not exist for a screen reader at all — the very complaint
            // #505 opened with — and out here it cannot be clipped by a long
            // name. Android places it in the same spot. It clears when the
            // thread is closed, same as the inbox row, from the same rule.
            if isConversationFlaggedUrgent(
                emergencyAt: detail.emergency_at,
                closedAt: detail.closed_at
            ) {
                UrgentBadge()
            }

            Button(action: onFind) {
                Image(systemName: "magnifyingglass")
                    .font(.scaled(IconSize.standard, weight: .medium))
                    .frame(width: 40, height: 44)
            }
            .accessibilityLabel(AppStrings.translate(appLocale, "thread.findInThread"))

            if detail.viewer_level == "text" {
                Button(action: onCall) {
                    if calling {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: 44, height: 44)
                    } else {
                        Image(systemName: "phone")
                            .font(.scaled(IconSize.standard, weight: .medium))
                            .foregroundStyle(BrandColor.canvas)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(BrandColor.ink))
                    }
                }
                .disabled(calling || controller.threadOptedOut == true)
                .accessibilityLabel(
                    AppStrings.translate(
                        appLocale, "thread.callContact", ["name": contactName]
                    )
                )
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
    let onManageTags: @MainActor () -> Void
    let onOpenGallery: @MainActor () -> Void
    let onNewTask: @MainActor () -> Void
    /// #712: leave the thread unread, then leave it.
    let onMarkUnread: @MainActor () -> Void
    /// #716: nil when the thread does not offer a catch-up, which hides the row.
    let onCatchUp: (@MainActor () -> Void)?
    let onOptOut: @MainActor () -> Void
    let onRevokeOptOut: @MainActor () -> Void
    let onBlock: @MainActor () -> Void
    let onRefresh: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void
    /// #691: nil when this member may not delete, which hides the row.
    let onDeleteConversation: (@MainActor () -> Void)?
    /// `conversations.note`: status, assignment, pin, spam and block.
    let canWrite: Bool

    /// #293: the custom-date sheet, owned here rather than inside the row, so
    /// dismissing the actions sheet cannot take the picker with it. The value
    /// is WHICH ladder it is completing; nil is closed.
    @State private var snoozePickerKind: DeferralKind?

    /// #694: the mute durations are open in the sheet.
    @State private var choosingMute = false

    @Environment(\.appLocale) private var appLocale

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
        guard let name, !name.isBlank else {
            return AppStrings.translate(appLocale, "thread.assignToEllipsis")
        }
        return AppStrings.translate(
            appLocale, "thread.assignedTo", ["name": name]
        )
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                identityRow
                ThreadTagsRow(
                    tags: detail.tags,
                    onManage: onManageTags,
                    onRemove: { controller.detachTag($0) }
                )
                // #712: the sheet draws the conversation's one action list, in its order.
                // Close and reopen are the status pills; snooze, unsnooze and follow-up are
                // the deferral card; everything else is a row.
                ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                    blockView(block)
                }
                refreshCard
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
                Text(AppStrings.translate(appLocale, "thread.viewContact"))
                    .font(.golos(11.5, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 12)
            .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .phoneNumberCopyMenu(detail.contact.phone_e164)
    }

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(AppStrings.translate(appLocale, "thread.statusHeading"))
                .padding(.leading, 6)
            statusControl
        }
    }

    private var statusControl: some View {
        // #722: a move the server would refuse is not offered.
        let offered = statuses.filter { status in
            status == detail.status
                || detail.allowed_actions.allows(
                    ConversationAllowed.statusMove(from: detail.status, to: status)
                )
        }
        let options = offered.map { status in
            SegmentedOption(status, title: statusLabel(status, locale: appLocale))
        }
        return SegmentedControl(
            options: options,
            selected: detail.status,
            size: .compact,
            fill: false
        ) { next in
            if detail.status != next { controller.setStatus(next) }
            onDismiss()
        }
    }

    /// The conversation's one action list for this thread. The thread being open IS
    /// the read state, so leaving it unread is the one choice.
    private var actions: [RecordAction] {
        conversationActions(
            ConversationActionsInput(
                unread: false,
                closed: detail.status == ConversationStatus.closed,
                pinned: detail.pinned_at != nil,
                deferred: detail.snoozed_until.map { isSnoozed($0) } ?? false,
                muted: detail.muted == true,
                followed: detail.followed == true,
                spam: detail.is_spam,
                blocked: controller.blockedSender != nil,
                optOut: controller.threadOptedOut.map {
                    OptOutState(
                        optedOut: $0,
                        carrierEnforced: isCarrierEnforcedOptOut(controller.threadOptOutSource)
                    )
                },
                viewer: RecordViewer(canWrite: canWrite, canDelete: onDeleteConversation != nil),
                hasMembers: !controller.members.isEmpty,
                surface: ConversationSurface(
                    canOpen: false,
                    hasGallery: true,
                    hasCatchUp: onCatchUp != nil,
                    hasNewTask: true
                ),
                allowedActions: detail.allowed_actions
            )
        )
    }

    private var blocks: [ConversationSheetBlock] {
        conversationSheetBlocks(actions)
    }

    @ViewBuilder
    private func blockView(_ block: ConversationSheetBlock) -> some View {
        switch block {
        case .status:
            statusSection
        case .deferral:
            snoozeCard
        case .rows(let rows):
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, action in
                    if index > 0 { RowDivider() }
                    actionRow(action)
                }
            }
            .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
    }

    /// One row of the list. Pinned, followed and spam are STATES, drawn and named as
    /// such (#465): a trailing mark means state, and the label names the state.
    @ViewBuilder
    private func actionRow(_ action: RecordAction) -> some View {
        let label = AppStrings.translate(appLocale, action.labelKey)
        let symbol = recordActionSymbol(action.id)
        switch action.id {
        case ConversationActionId.markRead, ConversationActionId.markUnread:
            sheetRow(label, icon: symbol, action: onMarkUnread)
        case ConversationActionId.assign:
            sheetRow(assigneeLabel, icon: symbol, action: onAssign)
        case ConversationActionId.pin:
            toggleRow(label, icon: symbol, on: action.checked == true) {
                controller.toggleConversationPin()
                onDismiss()
            }
        case ConversationActionId.catchUp:
            sheetRow(label, icon: symbol) { onCatchUp?() }
        case ConversationActionId.newTask:
            sheetRow(label, icon: symbol, action: onNewTask)
        // #694: mute and follow are this member's own. Mute opens the durations in place
        // rather than a second sheet. #710: Mute reads like Snooze, so its row says what
        // it keeps and what it drops.
        case ConversationActionId.unmute:
            sheetRow(label, icon: symbol) {
                controller.unmute()
                onDismiss()
            }
        case ConversationActionId.mute:
            sheetRow(
                label,
                icon: symbol,
                supporting: AppStrings.translate(appLocale, "thread.muteHint")
            ) {
                choosingMute.toggle()
            }
            if choosingMute {
                ForEach(recordMuteChoices) { choice in
                    sheetRow(
                        AppStrings.translate(appLocale, choice.labelKey ?? choice.id),
                        icon: "clock"
                    ) {
                        controller.mute(choice.id)
                        onDismiss()
                    }
                }
            }
        case ConversationActionId.follow:
            toggleRow(label, icon: symbol, on: action.checked == true) {
                controller.setFollowed(detail.followed != true)
                onDismiss()
            }
        case ConversationActionId.attachments:
            sheetRow(label, icon: symbol, action: onOpenGallery)
        case ConversationActionId.spam:
            toggleRow(label, icon: symbol, on: action.checked == true) {
                controller.setSpam(!detail.is_spam)
                onDismiss()
            }
        // #696: a block sends this number's future texts and calls straight to spam.
        // Unblocking needs no confirmation: it only lets the next one through.
        case ConversationActionId.unblock:
            sheetRow(label, icon: symbol) {
                controller.unblockNumber()
                onDismiss()
            }
        case ConversationActionId.block:
            sheetRow(label, icon: symbol, action: onBlock)
        case ConversationActionId.delete:
            if let onDeleteConversation {
                sheetRow(label, icon: symbol, action: onDeleteConversation)
            }
        // #407: a STOP the customer sent is a CARRIER block, and only they can lift it.
        // So the row becomes a note, which the customer acts on, not an undo we cannot
        // honour.
        case ConversationActionId.carrierStop:
            sheetNote(label)
        case ConversationActionId.optIn:
            sheetRow(label, icon: symbol, action: onRevokeOptOut)
        case ConversationActionId.optOut:
            sheetRow(label, icon: symbol, action: onOptOut)
        default:
            EmptyView()
        }
    }

    /// The manual refresh is this screen's own utility, not an action on the record,
    /// so it stays out of the shared list.
    private var refreshCard: some View {
        VStack(spacing: 0) {
            sheetRow(
                AppStrings.translate(appLocale, "thread.refresh"),
                icon: "arrow.clockwise"
            ) { onRefresh() }
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
                    AppStrings.translate(
                        appLocale,
                        isFollowUp
                            ? "thread.cancelReminder"
                            : "thread.bringBackNow"
                    ),
                    icon: "alarm.slash"
                ) {
                    controller.unsnooze()
                    onDismiss()
                }
            } else {
                sheetNote(
                    AppStrings.translate(appLocale, "thread.snoozeUntil"),
                    hint: AppStrings.translate(appLocale, "thread.snoozeHint")
                )
                ForEach(snoozePresets(locale: appLocale)) { preset in
                    RowDivider()
                    sheetRow(preset.label, trailing: presetClock(preset.at)) {
                        controller.snooze(untilISO: snoozeInstantISO(preset.at))
                        onDismiss()
                    }
                }
                RowDivider()
                sheetRow(
                    AppStrings.translate(appLocale, "thread.pickADate"),
                    icon: "calendar"
                ) { snoozePickerKind = .snooze }

                // #293: a SECOND ladder, not a second label on the first.
                // "This afternoon" is a sensible time to pick a thread back up
                // and a meaningless time to chase a quote — one ladder for both
                // would put three useless options in front of whichever job you
                // were actually doing.
                sheetNote(
                    AppStrings.translate(appLocale, "thread.remindMeToChase")
                )
                ForEach(followUpPresets(locale: appLocale)) { preset in
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
                sheetRow(
                    AppStrings.translate(appLocale, "thread.pickADate"),
                    icon: "calendar"
                ) { snoozePickerKind = .followUp }
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
        TimestampFormat.clock(date)
    }

    private var timelineCard: some View {
        VStack(spacing: 0) {
            toggleRow(
                AppStrings.translate(appLocale, "thread.showMessages"),
                icon: "bubble.left",
                on: controller.filter.messages
            ) {
                controller.filter = controller.filter.toggledMessages()
            }
            RowDivider()
            toggleRow(
                AppStrings.translate(appLocale, "thread.showNotes"),
                icon: "lock",
                on: controller.filter.notes
            ) {
                controller.filter = controller.filter.toggledNotes()
            }
            RowDivider()
            toggleRow(
                AppStrings.translate(appLocale, "thread.showEvents"),
                icon: "info.circle",
                on: controller.filter.events
            ) {
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
    ///
    /// #710: `hint` is a second, quieter line saying what the section does.
    private func sheetNote(_ text: String, hint: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(text)
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted500)
            if let hint {
                Text(hint)
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted500)
            }
        }
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
        supporting: String? = nil,
        action: @escaping @MainActor () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let icon {
                    Image(systemName: icon)
                        .font(.scaled(IconSize.standard, weight: .regular))
                        .foregroundStyle(BrandColor.muted500)
                        .frame(width: 20, alignment: .leading)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(.golos(13.5, weight: .medium))
                        .foregroundStyle(BrandColor.ink)
                    if let supporting {
                        Text(supporting)
                            .font(.golos(11))
                            .foregroundStyle(BrandColor.muted500)
                    }
                }
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
                        .font(.scaled(IconSize.standard, weight: .regular))
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
                    .font(.scaled(IconSize.standard, weight: .regular))
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

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        NavigationStack {
            List {
                Button {
                    onPick(nil)
                } label: {
                    HStack {
                        Text(AppStrings.translate(appLocale, "thread.unassigned"))
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
                            let name = member.display_name.isBlank
                                ? AppStrings.translate(
                                    appLocale, "thread.teammate"
                                )
                                : member.display_name
                            let suffix = member.user_id == meUserId
                                ? AppStrings.translate(
                                    appLocale, "thread.youSuffix"
                                )
                                : ""
                            Text(name + suffix)
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
            .navigationTitle(AppStrings.translate(appLocale, "thread.assignTo"))
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

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Button(action: onBringBack) {
            HStack(spacing: 8) {
                Image(systemName: "clock")
                    .font(.scaled(IconSize.small))
                    .foregroundStyle(BrandColor.muted700)
                Text(label)
                    .font(.golos(11.5, weight: .semibold))
                    .foregroundStyle(BrandColor.muted900)
                Spacer()
                Text(AppStrings.translate(appLocale, "thread.bringBack"))
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
        .accessibilityHint(
            AppStrings.translate(appLocale, "thread.bringBackHint")
        )
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
struct MakeTaskSheet: View {
    let controller: any TaskDraftHost
    let source: TaskDraftSource
    let contactName: String
    /// #228: the reader's language, handed in rather than read from the
    /// environment because `init` seeds the editable title from it.
    let locale: String
    let onDismiss: @MainActor () -> Void

    @State private var title: String
    @State private var description: String
    /// Assigned to whoever is making it, matching web and Android. The default
    /// task view is "open, assigned to me", so a task made here and left
    /// unassigned landed in a list nobody was looking at.
    @State private var assigneeId: String?
    /// #689 C: a standalone task takes a crew of up to ten, default me. Message
    /// and call tasks keep the single `assigneeId` above.
    @State private var crew: [String] = []
    @State private var crewCapHit = false
    @State private var due: Date?
    @State private var dateOnly: Bool
    @State private var dueSuggested = false
    @State private var duePickerOpen = false
    @State private var addr = AddressFieldValues()
    @State private var customerAddress: String?
    @State private var addrProvenance: String?
    @State private var addrOpen = false
    /// #689: a standalone task asks only for a title; the rest sits under More.
    @State private var moreOpen: Bool
    @State private var enriching = false
    @State private var enrichStarted = false
    /// #431: what enrichment actually filled in, so the outcome can be judged
    /// against it at create time. `suggestedDueAt` holds the VALUE rather than a
    /// flag, because "changed the due date" can only be told apart from "kept it"
    /// by comparing against what Lou proposed.
    @State private var suggestedAddress = false
    @State private var suggestedDueAt: Date?
    /// #693: priority, labels and a repeat. Only a standalone task shows them.
    @State private var meta = TaskDraftMeta()
    @State private var workspaceTags: [Tag] = []
    @State private var pickingCustomer = false
    @State private var pickedCustomer: Contact?
    @State private var changedCustomer = false
    @State private var pickedCustomerThread: String?
    @State private var resolvingCustomer = false
    @State private var linkedTasks: [LinkedSourceTask]?
    @State private var linkedTasksError = false
    @State private var linkedTasksRetry = 0

    private var textingCustomer: String? {
        if changedCustomer {
            return pickedCustomerThread == nil ? nil : (pickedCustomer?.name ?? "")
        }
        if case .standalone(let conversationId, _) = source, conversationId != nil {
            return contactName
        }
        return nil
    }

    private enum AddrField: Hashable {
        case street, unit, city, state, postal, country
    }

    @FocusState private var addrFocus: AddrField?

    init(
        controller: any TaskDraftHost,
        source: TaskDraftSource,
        contactName: String,
        locale: String,
        onDismiss: @escaping @MainActor () -> Void,
        initialDueOn: String? = nil,
        initialAddress: String? = nil
    ) {
        self.controller = controller
        self.source = source
        self.contactName = contactName
        self.locale = locale
        self.onDismiss = onDismiss
        switch source {
        case .message(let message):
            _title = State(initialValue: Self.seededTitle(message.body, locale: locale))
        case .call(_, let callerName, let voicemail):
            _title = State(
                initialValue: voicemail?.title ?? AppStrings.translate(
                    locale, "thread.callTaskTitle", ["name": callerName]
                )
            )
        case .standalone:
            _title = State(initialValue: "")
        }
        _description = State(initialValue: source.voicemail?.description ?? "")
        // A prefilled due opens More so the day it chose is on screen (#739).
        _moreOpen = State(initialValue: !source.isStandalone || initialDueOn != nil)
        _due = State(initialValue: initialDueOn.flatMap { taskDay($0) })
        _dateOnly = State(initialValue: initialDueOn != nil)
        _customerAddress = State(initialValue: initialAddress)
        if let initialAddress {
            var address = AddressFieldValues()
            address.street = initialAddress
            _addr = State(initialValue: address)
        }
        _assigneeId = State(initialValue: controller.meUserId)
        _crew = State(initialValue: [controller.meUserId])
    }

    /// The thread's "Make a task" on a message.
    init(
        controller: any TaskDraftHost,
        message: Message,
        contactName: String,
        locale: String,
        onDismiss: @escaping @MainActor () -> Void
    ) {
        self.init(
            controller: controller,
            source: .message(message),
            contactName: contactName,
            locale: locale,
            onDismiss: onDismiss
        )
    }

    /// The source message, when the task promotes one (nil for a call).
    private var message: Message? { source.message }

    /// The web's message-snippet default title, editable: the trimmed body
    /// (first 120 chars), or "Follow up" for a picture-only message.
    ///
    /// #228: the fallback is a task TITLE that gets posted, so it has to be in
    /// the writer's language — and it is seeded in `init`, where no environment
    /// value exists yet. Hence the passed-in locale rather than `\.appLocale`;
    /// this sheet has one construction site, and it hands over the same value.
    private static func seededTitle(_ body: String, locale: String) -> String {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty
            ? AppStrings.translate(locale, "thread.taskTitleFallback")
            : String(trimmed.prefix(120))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 15) {
                header
                if let message, !message.body.isBlank { sourceQuote(message) }
                if !source.isStandalone { linkedTaskList }
                titleField
                if source.isStandalone, controller is NewTaskHost {
                    Button {
                        pickingCustomer = true
                    } label: {
                        let name = changedCustomer ? (pickedCustomer?.name ?? pickedCustomer?.phone_e164 ?? "") : contactName
                        Text(AppStrings.translate(locale, "contactsTasks.bookingCustomer", [
                            "name": name.isEmpty ? AppStrings.translate(locale, "contactsTasks.pickCustomer") : name
                        ]))
                    }
                }
                if source.voicemail != nil {
                    let label = AppStrings.translate(locale, "contactsTasks.description")
                    VStack(alignment: .leading, spacing: 5) {
                        Text(label).font(.golos(12, weight: .semibold))
                        TextEditor(text: $description)
                            .frame(minHeight: 72)
                            .accessibilityLabel(label)
                    }
                }
                if moreOpen {
                    assigneeRow
                    dueRow
                    if source.isStandalone, due != nil {
                        Toggle(AppStrings.translate(locale, "contactsTasks.anyTime"), isOn: $dateOnly)
                    }
                    addressBlock
                    if source.isStandalone {
                        TaskDraftMetaSection(
                            meta: $meta,
                            tags: workspaceTags,
                            due: due,
                            linkedToCustomer: changedCustomer ? pickedCustomer != nil : source.isLinkedToCustomer,
                            textingCustomer: textingCustomer
                        )
                    }
                } else {
                    moreButton
                }
                createButton
                if !source.isStandalone {
                    Text(AppStrings.translate(locale, "thread.taskLineNote"))
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted300)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(BrandColor.canvas)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .sheet(isPresented: $pickingCustomer) {
            if let host = controller as? NewTaskHost {
                BookingCustomerPicker(load: { try await host.customers(matching: $0) }) { customer in
                    if changedCustomer && customer?.id == pickedCustomer?.id { return }
                    if addr.street.isEmpty || addr.street == customerAddress {
                        addr.street = customer?.address ?? ""
                    }
                    customerAddress = customer?.address
                    pickedCustomer = customer
                    pickedCustomerThread = nil
                    resolvingCustomer = customer != nil
                    changedCustomer = true
                }
            }
        }
        .task(id: pickedCustomer?.id) {
            guard let customer = pickedCustomer, let host = controller as? NewTaskHost else { return }
            let thread = await host.thread(for: customer)
            if !Task.isCancelled {
                pickedCustomerThread = thread
                resolvingCustomer = false
            }
        }
        .task { await enrichIfNeeded() }
        .task(id: linkedTasksRetry) {
            guard !source.isStandalone else { return }
            do { linkedTasks = try await controller.linkedTasks(for: source) }
            catch { if !Task.isCancelled { linkedTasksError = true } }
        }
        .task {
            if source.isStandalone {
                workspaceTags = await controller.workspaceTagsForTaskDraft()
            }
        }
        .sheet(isPresented: $duePickerOpen) {
            MakeTaskDueSheet(initial: due, locale: locale) { picked in
                due = picked
                dueSuggested = false
            }
        }
    }

    // MARK: Sections

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text(AppStrings.translate(locale, "thread.newTask"))
                    .font(.golos(21, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                if !(source.isStandalone && contactName.isBlank) {
                    Text(
                        AppStrings.translate(locale, subtitleKey, ["name": contactName])
                    )
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted500)
                }
            }
            Spacer()
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.scaled(IconSize.small, weight: .semibold))
                    .foregroundStyle(BrandColor.muted700)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(BrandColor.inset))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(AppStrings.translate(locale, "common.cancel"))
        }
    }

    private var subtitleKey: String {
        switch source {
        case .message: return "thread.newTaskFrom"
        case .call: return "thread.newTaskFromCall"
        case .standalone: return "thread.newTaskFor"
        }
    }

    private var moreButton: some View {
        Button {
            Haptics.tap()
            moreOpen = true
        } label: {
            Text(AppStrings.translate(locale, "thread.newTaskMore"))
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.muted500)
                .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
    }

    private func sourceQuote(_ message: Message) -> some View {
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
            SectionHeader(
                label: AppStrings.translate(locale, "thread.taskTitle")
            )
            TextField(
                AppStrings.translate(locale, "thread.taskTitlePlaceholder"),
                text: $title,
                axis: .vertical
            )
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
            SectionHeader(
                label: AppStrings.translate(locale, "thread.assignTo")
            )
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(
                        controller.members.filter { $0.deactivated_at == nil },
                        id: \.user_id
                    ) { member in
                        let name = member.display_name.isBlank
                            ? AppStrings.translate(locale, "thread.teammate")
                            : member.display_name
                        AssigneeChoiceChip(
                            name: name,
                            showsAvatar: true,
                            selected: isAssignee(member.user_id)
                        ) {
                            toggleAssignee(member.user_id)
                        }
                    }
                    AssigneeChoiceChip(
                        name: AppStrings.translate(locale, "thread.nobody"),
                        showsAvatar: false,
                        selected: nobodyAssigned
                    ) { clearAssignees() }
                }
                .padding(.horizontal, 1)
                .padding(.vertical, 2)
            }
            if source.isStandalone && (crewCapHit || crew.count >= taskAssigneeMax) {
                Text(
                    AppStrings.translate(
                        locale,
                        "contactsTasks.assigneesCap",
                        ["max": String(taskAssigneeMax)]
                    )
                )
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.overdueAmber)
                    .padding(.top, 4)
            }
        }
    }

    private func isAssignee(_ id: String) -> Bool {
        source.isStandalone ? crew.contains(id) : assigneeId == id
    }

    private var nobodyAssigned: Bool {
        source.isStandalone ? crew.isEmpty : assigneeId == nil
    }

    private func toggleAssignee(_ id: String) {
        guard source.isStandalone else {
            assigneeId = assigneeId == id ? nil : id
            return
        }
        if let next = taskAssigneesToggled(crew, id: id) {
            crew = next
            crewCapHit = false
        } else {
            crewCapHit = true
        }
    }

    private func clearAssignees() {
        assigneeId = nil
        crew = []
        crewCapHit = false
    }

    private var dueRow: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                SectionHeader(
                    label: AppStrings.translate(locale, "thread.dueOptional")
                )
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
                            .font(.scaled(IconSize.small))
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
                            .font(.scaled(IconSize.large))
                            .foregroundStyle(BrandColor.muted300)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(
                        AppStrings.translate(locale, "thread.clearDueDate")
                    )
                }
            }
        }
    }

    private var suggestedHint: some View {
        HStack(spacing: 3) {
            AiOrb(state: .idle, size: 11)
            Text(AppStrings.translate(locale, "thread.suggested"))
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
                            .font(.scaled(IconSize.small, weight: .medium))
                            .foregroundStyle(BrandColor.muted500)
                        Text(AppStrings.translate(locale, "thread.addressSection"))
                            .font(.golos(13.5, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                        if enriching {
                            ProgressView().controlSize(.mini)
                        }
                        if let label = addressProvenanceLabel(
                            addrProvenance, locale: locale
                        ) {
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
                    Button(
                        AppStrings.translate(locale, "thread.clear"),
                        action: clearAddress
                    )
                        .font(.golos(12.5, weight: .semibold))
                        .foregroundStyle(BrandColor.muted500)
                        .buttonStyle(.plain)
                        .accessibilityLabel(
                            AppStrings.translate(locale, "thread.clearAddress")
                        )
                }

                // Disclosure chevron stays the trailing affordance (parity with
                // Android/web); tapping it toggles like the label.
                Image(systemName: "chevron.down")
                    .font(.scaled(IconSize.small, weight: .medium))
                    .foregroundStyle(BrandColor.muted250)
                    .rotationEffect(.degrees(addrOpen ? 180 : 0))
                    .onTapGesture { addrOpen.toggle() }
            }

            if addrOpen {
                VStack(spacing: 8) {
                    addrField(
                        AppStrings.translate(locale, "thread.addrStreet"),
                        keyPath: \.street,
                        field: .street
                    )
                    HStack(spacing: 8) {
                        addrField(
                            AppStrings.translate(locale, "thread.addrUnit"),
                            keyPath: \.unit,
                            field: .unit
                        )
                        addrField(
                            AppStrings.translate(locale, "thread.addrCity"),
                            keyPath: \.city,
                            field: .city
                        )
                    }
                    HStack(spacing: 8) {
                        addrField(
                            AppStrings.translate(locale, "thread.addrState"),
                            keyPath: \.state,
                            field: .state
                        )
                        addrField(
                            AppStrings.translate(locale, "thread.addrPostal"),
                            keyPath: \.postalCode,
                            field: .postal
                        )
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
                Text(AppStrings.translate(locale, "thread.createTask"))
                    .font(.golos(15, weight: .semibold))
                    .foregroundStyle(BrandColor.canvas)
                Spacer()
                Image(systemName: "checkmark")
                    .font(.scaled(IconSize.standard, weight: .bold))
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
        .disabled(
            title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !meta.isValid(hasDue: due != nil) || resolvingCustomer || (!source.isStandalone && linkedTasks == nil)
        )
        .accessibilityLabel(
            AppStrings.translate(locale, "thread.createTask")
        )
    }

    @ViewBuilder
    private var linkedTaskList: some View {
        if let linkedTasks {
            if !linkedTasks.isEmpty {
                SectionLabel(AppStrings.translate(locale, "thread.tasksFromSource"))
                ForEach(linkedTasks) { task in
                    Button {
                        onDismiss()
                        AppRouter.shared.openTaskId = task.id
                    } label: {
                        HStack {
                            Text(task.title)
                            Spacer()
                            Text(AppStrings.translate(locale, task.done ? "contactsTasks.tabDone" : "contactsTasks.tabOpen"))
                                .foregroundStyle(BrandColor.muted600)
                        }
                    }
                }
            }
        } else if linkedTasksError {
            LoadError(message: AppStrings.translate(locale, "common.loadFailed"), variant: .inline) {
                linkedTasksError = false
                linkedTasksRetry += 1
            }
        } else {
            Text(AppStrings.translate(locale, "common.loading")).foregroundStyle(BrandColor.muted600)
        }
    }

    // MARK: Logic

    /// The due row's label: "today 3:00 PM" / "Jul 8 9:00 AM", or a placeholder.
    /// Reuses the tested `dueSentenceTime` helper (round-trips through the same
    /// offset-ISO encoder the create body uses).
    private var dueDisplayLabel: String {
        guard let due else {
            return AppStrings.translate(locale, "thread.addDueDate")
        }
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
        // #689 C: a standalone task sends its whole crew (an empty one means
        // nobody, which is not the same as leaving it out).
        var sent = meta
        if source.isStandalone {
            sent.assigneeIds = crew
            sent.dueOn = dateOnly ? due.map { taskDateKey($0) } : nil
        }
        var reviewedSource = source
        if source.isStandalone && changedCustomer {
            reviewedSource = .standalone(conversationId: pickedCustomerThread, contactId: pickedCustomer?.id)
        }
        if case let .call(id, name, draft?) = source {
            var reviewedVoicemail = draft
            reviewedVoicemail.description = String(description.prefix(taskDescriptionMax))
            reviewedSource = .call(id: id, callerName: name, voicemail: reviewedVoicemail)
        }
        controller.createTask(
            from: reviewedSource,
            title: String(trimmed.prefix(taskTitleMax)),
            assignedUserId: source.isStandalone ? crew.first : assigneeId,
            dueAt: sent.dueOn == nil ? due.map { encodeDueAt($0) } : nil,
            address: addr,
            provenance: addrProvenance ?? AddressProvenance.manual,
            meta: sent
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
        let result: TaskEnrichment
        enriching = true
        defer { enriching = false }
        if let voicemail = source.voicemail, settings.enrich_task_address {
            result = await controller.enrichVoicemailTaskDraft(callId: voicemail.call_id)
        } else if let message, !message.body.isBlank {
            result = await controller.enrichTaskDraft(for: message)
        } else {
            return
        }
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
    /// Handed in beside `MakeTaskSheet`'s own, so the two sheets in one flow
    /// cannot end up reading different catalogues.
    let locale: String
    let onSet: @MainActor (Date) -> Void

    @State private var draft: Date
    @Environment(\.dismiss) private var dismiss

    init(
        initial: Date?,
        locale: String,
        onSet: @escaping @MainActor (Date) -> Void
    ) {
        self.initial = initial
        self.locale = locale
        self.onSet = onSet
        let fallback = Calendar.current.date(
            bySettingHour: 9, minute: 0, second: 0, of: Date()
        ) ?? Date()
        _draft = State(initialValue: initial ?? fallback)
    }

    var body: some View {
        VStack(spacing: 12) {
            DatePicker(
                AppStrings.translate(locale, "thread.due"),
                selection: $draft,
                displayedComponents: [.date, .hourAndMinute]
            )
            .datePickerStyle(.graphical)
            HStack {
                Button(AppStrings.translate(locale, "common.cancel")) {
                    dismiss()
                }
                .foregroundStyle(.secondary)
                Spacer()
                Button(AppStrings.translate(locale, "thread.setDueDate")) {
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
    // #607 A3: what the thread says when a deposit clears. Rendered THROUGH
    // `eventLine` rather than typed, so the only preview anybody can open on a
    // Mac shows the shipped sentence and cannot drift from it. Hoisted out of
    // the `ViewBuilder` below because a construction this size inline is how a
    // body stops type-checking in reasonable time.
    let paidLine = eventLine(
        ConversationEvent(
            id: "ev-paid",
            conversation_id: "c1",
            actor_user_id: nil,
            type: "payment_paid",
            payload: .object([
                "payment_request_id": .string("pr1"),
                "amount_cents": .number(25_000),
                "currency": .string("usd"),
                "description": .string("Deposit"),
            ]),
            created_at: "2026-07-15T15:12:00Z"
        ),
        memberNames: [:],
        contactName: "Marco Alvarez"
    )
    return ScrollView {
        VStack(spacing: 0) {
            PinnedStack(
                conversationId: "preview",
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
            EventLine(text: paidLine, timeIso: "2026-07-15T15:12:00Z")
        }
    }
}
