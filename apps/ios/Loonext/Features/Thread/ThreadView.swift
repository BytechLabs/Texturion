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
            }
        }
        // #215 Part A: a frame missed while this thread was backgrounded/blurred
        // (the #215 repro) self-heals on return — the same page-1 refetch the
        // socket re-JOIN runs.
        .resyncOnForeground { controller?.refreshAfterReconnect() }
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

    @State private var makeTaskFor: Message?
    @State private var detailSheet: ThreadDetailSheet?
    @State private var confirmOptOut = false
    @State private var confirmRevoke = false
    @State private var showNewPill = false
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

                composerPane(detail: detail)
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
                authorName: message.direction == MessageDirection.note
                    ? (message.sent_by_user_id.flatMap { names[$0] } ?? "Internal note")
                    : nil,
                doneByName: message.done_by_user_id.flatMap { names[$0] },
                noteFilesState: message.direction == MessageDirection.note
                    ? controller.noteFiles[message.id]
                    : nil,
                onLoadNoteFiles: { controller.loadNoteFiles(message.id) },
                onOpenFile: { openFile($0) },
                mintAttachmentUrl: { try await controller.mintAttachmentUrl($0) },
                actions: MessageBubbleActions(
                    onToggleDone: { controller.toggleDone(message) },
                    onTogglePin: { controller.togglePin(message) },
                    onRetry: { controller.retrySend(message.id) },
                    onMakeTask: {
                        // The sheet seeds its own editable title from the body
                        // (#214 also pre-fills a due + address via enrichment).
                        makeTaskFor = message
                    },
                    onCopied: { controller.markCopied() }
                )
            )
        case .pending(let pending):
            PendingBubble(pending: pending)
        case .event(let event):
            EventLine(
                text: eventLine(event, memberNames: names, contactName: contactName),
                timeIso: event.created_at
            )
        case .dayDivider(let label, _):
            DayDividerLine(label: label)
        }
    }

    private func openFile(_ attachment: Attachment) {
        Task {
            do {
                let minted = try await controller.mintAttachmentUrl(attachment.id)
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

    @ViewBuilder
    private func composerPane(detail: ConversationDetail) -> some View {
        let banner = selectComposerBanner(
            contactOptedOut: controller.contact?.opted_out == true,
            subscriptionStatus: controller.company?.subscription_status
                ?? SubscriptionStatus.active,
            destinationCountry: Nanp.destinationCountry(detail.contact.phone_e164),
            usApproved: controller.company.map(usSendApproved) ?? true,
            usage: controller.usage
        )
        ThreadComposerView(
            state: composer,
            noteOnly: detail.viewer_level == "note",
            banner: banner,
            contactName: detail.contact.name,
            businessName: controller.company?.name,
            loadTemplates: { [repo = controller.repo, companyId = detail.company_id] in
                try await repo.templates(companyId: companyId).data
            },
            onSendText: { body, photos in
                controller.sendText(body: body, photos: photos) {
                    composer.restore(body: body, photos: photos, files: [])
                }
            },
            onSaveNote: { body, files in
                controller.saveNote(body: body, files: files) {
                    composer.restore(body: body, photos: [], files: files)
                }
            },
            onNotice: { controller.notifyExternally($0) }
        )
    }
}

// MARK: - Header

/// The paper pill header (#186 item 3): back · avatar · name + status line ·
/// ink call circle. The avatar / name / status line all open the conversation
/// info sheet (a bottom-sheet CARD, not a scatter of menus) — assign, pin,
/// gallery, spam, opt-out, and timeline visibility live there, with the full
/// contact panel one tap deeper. The Android ThreadHeader + ConversationSheet
/// twin.
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
                        Text(contactName)
                            .font(.golos(14.5, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                            .lineLimit(1)
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
            .accessibilityLabel("Conversation options for \(contactName)")

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
            sheetRow(assigneeLabel, action: onAssign)
            RowDivider()
            sheetRow(detail.pinned_at == nil ? "Pin conversation" : "Unpin conversation") {
                controller.toggleConversationPin()
                onDismiss()
            }
            RowDivider()
            sheetRow("Photos & files", action: onOpenGallery)
            RowDivider()
            sheetRow("Refresh") { onRefresh() }
            RowDivider()
            sheetRow(detail.is_spam ? "Not spam" : "Mark as spam") {
                controller.setSpam(!detail.is_spam)
                onDismiss()
            }
            RowDivider()
            if controller.contact?.opted_out == true {
                sheetRow("Remove opt-out", action: onRevokeOptOut)
            } else {
                sheetRow("Opt out of texts", action: onOptOut)
            }
        }
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var timelineCard: some View {
        VStack(spacing: 0) {
            toggleRow("Show messages", on: controller.filter.messages) {
                controller.filter = controller.filter.toggledMessages()
            }
            RowDivider()
            toggleRow("Show notes", on: controller.filter.notes) {
                controller.filter = controller.filter.toggledNotes()
            }
            RowDivider()
            toggleRow("Show events", on: controller.filter.events) {
                controller.filter = controller.filter.toggledEvents()
            }
        }
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func sheetRow(_ label: String, action: @escaping @MainActor () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.golos(13.5, weight: .medium))
                .foregroundStyle(BrandColor.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 15)
                .padding(.vertical, 13)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func toggleRow(
        _ label: String,
        on: Bool,
        action: @escaping @MainActor () -> Void
    ) -> some View {
        Button(action: action) {
            HStack {
                Text(label)
                    .font(.golos(13.5, weight: .medium))
                    .foregroundStyle(BrandColor.ink)
                Spacer()
                if on {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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

/// Collapsed "Pinned · N" disclosure; expanded rows jump to the message.
/// Pinned lives in the warm cream well ("Paper & Olive").
@MainActor
private struct PinnedBanner: View {
    let pinned: [Message]
    let onJump: @MainActor (String) -> Void

    @State private var expanded = false

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
                            Text(message.body.isBlank ? "Photo" : message.body)
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
    @State private var due: Date?
    @State private var dueSuggested = false
    @State private var duePickerOpen = false
    @State private var addr = AddressFieldValues()
    @State private var addrProvenance: String?
    @State private var addrOpen = false
    @State private var enriching = false
    @State private var enrichStarted = false

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
            Image(systemName: "sparkles")
                .font(.system(size: 9, weight: .semibold))
            Text("Suggested")
                .font(.golos(10.5, weight: .semibold))
        }
        .foregroundStyle(BrandColor.muted500)
    }

    private var addressBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
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
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(BrandColor.muted250)
                        .rotationEffect(.degrees(addrOpen ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

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
            Image(systemName: "sparkles")
                .font(.system(size: 9, weight: .semibold))
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

    private func create() {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        controller.makeTask(
            message,
            title: String(trimmed.prefix(taskTitleMax)),
            dueAt: due.map { encodeDueAt($0) },
            address: addr,
            provenance: addrProvenance ?? AddressProvenance.manual
        )
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
        }
        if settings.enrich_task_address, let address = result.address {
            let seeded = AddressFieldValues(address)
            if !seeded.isEmpty {
                addr = seeded
                addrProvenance = result.address_provenance
                addrOpen = true
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
        onCopied: {}
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
                mintAttachmentUrl: { _ in "" },
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
                mintAttachmentUrl: { _ in "" },
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
                mintAttachmentUrl: { _ in "" },
                actions: actions
            )
            EventLine(text: "Dana Fields moved this to Waiting", timeIso: "2026-07-15T15:10:00Z")
        }
    }
}
