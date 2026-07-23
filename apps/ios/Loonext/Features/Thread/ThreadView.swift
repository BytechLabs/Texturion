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
@MainActor
private struct ThreadBody: View {
    let graph: AppGraph
    @Bindable var controller: ThreadController
    let composer: ComposerState
    let me: Me
    let onBack: @MainActor () -> Void

    @State private var makeTaskFor: Message?
    @State private var makeTaskTitle = ""
    @State private var assigneeSheetOpen = false
    @State private var confirmOptOut = false
    @State private var confirmRevoke = false
    @State private var showNewPill = false
    @State private var isAtBottom = true
    @State private var jumpToMessageId: String?
    @State private var visibleNotice: ThreadNotice?
    @State private var noticeDismissTask: Task<Void, Never>?
    @State private var contactPanelOpen = false
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
                    onOpenContactPanel: { contactPanelOpen = true },
                    onCall: { startCall(detail: detail, contactName: contactName) },
                    onPickAssignee: { assigneeSheetOpen = true },
                    onOpenGallery: { galleryOpen = true },
                    onConfirmOptOut: { confirmOptOut = true },
                    onConfirmRevoke: { confirmRevoke = true }
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
            .sheet(isPresented: $assigneeSheetOpen) {
                AssigneePickerSheet(
                    members: controller.members,
                    meUserId: me.user_id,
                    selectedUserId: detail.assigned_user_id
                ) { userId in
                    assigneeSheetOpen = false
                    if userId != detail.assigned_user_id {
                        controller.setAssignee(userId)
                    }
                }
            }
            .sheet(isPresented: $contactPanelOpen) {
                ContactPanelSheet(
                    controller: controller,
                    members: controller.members,
                    onOpenConversation: { conversationId in
                        contactPanelOpen = false
                        // The inbox tab consumes the command and swaps threads.
                        AppRouter.shared.openConversationId = conversationId
                    }
                )
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
                        message: message,
                        contactName: contactName,
                        title: $makeTaskTitle,
                        onCancel: { makeTaskFor = nil },
                        onCreate: {
                            let title = makeTaskTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                            if !title.isEmpty {
                                controller.makeTask(message, title: String(title.prefix(200)))
                            }
                            makeTaskFor = nil
                        }
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
                                itemView(item, names: names, contactName: contactName)
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
                    .onChange(of: controller.newestMessageId ?? "") { _, _ in
                        if isAtBottom, let first = timeline.first {
                            proxy.scrollTo(first.key, anchor: .bottom)
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
                    // Pinned-banner jump: scroll once the message is loaded.
                    .onChange(of: jumpToMessageId) { _, target in
                        guard let target else { return }
                        withAnimation { proxy.scrollTo("m:\(target)", anchor: .center) }
                        jumpToMessageId = nil
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
                        makeTaskTitle = String(
                            message.body.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120)
                        )
                        if makeTaskTitle.isEmpty { makeTaskTitle = "Follow up" }
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

@MainActor
private struct ThreadHeader: View {
    @Bindable var controller: ThreadController
    let detail: ConversationDetail
    let contactName: String
    let phoneLabel: String
    let meUserId: String
    let calling: Bool
    let onBack: @MainActor () -> Void
    let onOpenContactPanel: @MainActor () -> Void
    let onCall: @MainActor () -> Void
    let onPickAssignee: @MainActor () -> Void
    let onOpenGallery: @MainActor () -> Void
    let onConfirmOptOut: @MainActor () -> Void
    let onConfirmRevoke: @MainActor () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onBack) {
                Image(systemName: "chevron.backward")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(BrandColor.ink)
                    .frame(width: 36, height: 36)
            }
            .accessibilityLabel("Back")

            // The identity block opens the contact panel sheet.
            Button(action: onOpenContactPanel) {
                HStack(spacing: 8) {
                    InitialsAvatar(name: contactName, size: 38)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(contactName)
                            .font(.golos(14.5, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                            .lineLimit(1)
                        Text(
                            controller.contact?.opted_out == true
                                ? "\(phoneLabel) · Opted out"
                                : phoneLabel
                        )
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted500)
                        .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Contact details for \(contactName)")

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

            // Status pill + menu (the single status control).
            Menu {
                ForEach(
                    [
                        ConversationStatus.new,
                        ConversationStatus.open,
                        ConversationStatus.waiting,
                        ConversationStatus.closed,
                    ],
                    id: \.self
                ) { status in
                    Button {
                        if status != detail.status { controller.setStatus(status) }
                    } label: {
                        if detail.status == status {
                            Label(statusLabel(status), systemImage: "checkmark")
                        } else {
                            Text(statusLabel(status))
                        }
                    }
                }
            } label: {
                Text(statusLabel(detail.status))
                    .font(.golos(11.5, weight: .semibold))
                    .foregroundStyle(BrandColor.muted900)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(BrandColor.avatarTint))
            }

            // Assignee control.
            Button(action: onPickAssignee) {
                if let assignee = controller.members.first(where: {
                    $0.user_id == detail.assigned_user_id
                }) {
                    InitialsAvatar(
                        name: assignee.display_name.isBlank ? nil : assignee.display_name,
                        size: 28
                    )
                } else {
                    Image(systemName: "person")
                        .foregroundStyle(BrandColor.muted500)
                        .frame(width: 28, height: 28)
                }
            }
            .accessibilityLabel("Assign")

            // Overflow.
            Menu {
                Button {
                    controller.toggleConversationPin()
                } label: {
                    Label(
                        detail.pinned_at == nil ? "Pin conversation" : "Unpin conversation",
                        systemImage: "pin"
                    )
                }
                Button {
                    onOpenGallery()
                } label: {
                    Label("Photos & files", systemImage: "photo.on.rectangle")
                }
                // The flipped timeline can't host a sane pull-to-refresh, so
                // the manual refetch lives here (same first-page reload as the
                // reconnect path).
                Button {
                    controller.refreshAfterReconnect()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                Button {
                    controller.setSpam(!detail.is_spam)
                } label: {
                    Label(
                        detail.is_spam ? "Not spam" : "Mark as spam",
                        systemImage: "exclamationmark.octagon"
                    )
                }
                if controller.contact?.opted_out == true {
                    Button {
                        onConfirmRevoke()
                    } label: {
                        Label("Remove opt-out", systemImage: "hand.raised.slash")
                    }
                } else {
                    Button {
                        onConfirmOptOut()
                    } label: {
                        Label("Opt out of texts", systemImage: "hand.raised")
                    }
                }
                Divider()
                Toggle(
                    "Show messages",
                    isOn: Binding(
                        get: { controller.filter.messages },
                        set: { _ in controller.filter = controller.filter.toggledMessages() }
                    )
                )
                Toggle(
                    "Show notes",
                    isOn: Binding(
                        get: { controller.filter.notes },
                        set: { _ in controller.filter = controller.filter.toggledNotes() }
                    )
                )
                Toggle(
                    "Show events",
                    isOn: Binding(
                        get: { controller.filter.events },
                        set: { _ in controller.filter = controller.filter.toggledEvents() }
                    )
                )
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body.weight(.medium))
                    .foregroundStyle(BrandColor.muted700)
                    .frame(width: 36, height: 36)
            }
            .accessibilityLabel("More")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 14)
        .padding(.top, 4)
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

// MARK: - Make a task (spec 22)

/// "Make a task — from a message": quoted source message with a lime bar,
/// title field on paper, ink Create bar with a lime check circle. Assign-to
/// and due chips are OMITTED — createTask takes a title only (no data layer
/// for assignee/due at creation).
@MainActor
private struct MakeTaskSheet: View {
    let message: Message
    let contactName: String
    @Binding var title: String
    let onCancel: @MainActor () -> Void
    let onCreate: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
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
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(BrandColor.muted700)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(BrandColor.inset))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel")
            }

            if !message.body.isBlank {
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

            Button(action: onCreate) {
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
            .accessibilityLabel("Create task")

            Text("The thread shows the task line")
                .font(.golos(11))
                .foregroundStyle(BrandColor.muted300)
                .frame(maxWidth: .infinity)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(BrandColor.canvas)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
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
