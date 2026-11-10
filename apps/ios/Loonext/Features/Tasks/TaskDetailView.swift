import SwiftUI
import UniformTypeIdentifiers

/// Task detail: inline-editable title/description (blur save), assignee and
/// offset-ISO due pickers, derived done circle (message PATCH), quoted source
/// message, the D28 derived read-only attachments union (per-item signed
/// URLs), the merged activity+discussion timeline, and a pinned note composer
/// (notes are the only door for task files). viewer_level 'none' shows the
/// task identity plus an access notice — nothing conversation-derived.
@MainActor
struct TaskDetailView: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    let taskId: String
    /// Deep-link: open the source thread anchored to the promoted message.
    /// The shell wires it (#159); until wired the affordance stays hidden.
    let onOpenConversation: ((_ conversationId: String, _ messageId: String?) -> Void)?

    private enum DetailState {
        case loading
        case failed(message: String, notFound: Bool)
        case ready(TaskDetail)
    }

    @State private var state: DetailState = .loading
    @State private var members: [Member] = []
    @State private var refreshKey = 0
    @State private var actionError: String?
    // #689: the task's own history and comments, oldest first.
    @State private var feed: [TaskFeedItem] = []
    @State private var feedCursor: String?
    @State private var feedLoaded = false
    @State private var feedFailed = false

    @State private var pickerOpen = false
    @State private var duePickerOpen = false
    @State private var confirmDelete = false
    @State private var deleting = false
    // #693: the workspace tags, the repeat sheet, and the "this one or this and
    // future" questions a repeating task asks before an edit or a delete.
    @State private var tags: [Tag] = []
    @State private var repeatOpen = false
    @State private var scopeDialogOpen = false
    @State private var scopeContinuation: CheckedContinuation<ScopeChoice, Never>?
    @State private var deleteScopeOpen = false

    private enum ScopeChoice {
        /// Go ahead. The scope is nil for a task that does not repeat, so its
        /// requests carry no `scope`, exactly as before #693.
        case go(String?)
        case cancelled
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale

    private var mutations: TaskMutations { TaskMutations(api: graph.api) }

    private var detail: TaskDetail? {
        if case .ready(let value) = state { return value }
        return nil
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading()
            case .failed(let message, let notFound):
                if notFound {
                    // Deleted (or never visible) — retrying would just 404 again.
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(24)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                } else {
                    CenteredError(message: message) { refreshKey += 1 }
                }
            case .ready(let detail):
                readyBody(detail)
            }
        }
        .navigationTitle(AppStrings.translate(appLocale, "contactsTasks.taskHeading"))
        .navigationBarTitleDisplayMode(.inline)
        // The tab's list screen hides the bar; the pushed detail needs it
        // back for the title, back button, and overflow menu.
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            if let detail {
                // #689 D: follow to hear when this changes. Not offered without
                // access to the task, which the server 404s.
                if !noAccess {
                    ToolbarItem(placement: .topBarTrailing) {
                        followButton(detail)
                    }
                }
                // Both entries are gated; with neither, the menu would open empty.
                if !noAccess || canDelete {
                    ToolbarItem(placement: .topBarTrailing) {
                        overflowMenu(detail)
                    }
                }
            }
        }
        .task(id: "\(taskId)|\(refreshKey)") {
            await load()
            await loadFeed()
        }
        .task(id: companyId) {
            if let page = try? await mutations.members(companyId: companyId) {
                members = page.data
            }
        }
        .task(id: companyId) {
            if let page = try? await mutations.tags(companyId: companyId) {
                tags = page.data
            }
        }
        .task(id: taskId) {
            // Realtime: metadata changes ride task.changed; done flips ride
            // message.status. Payloads are ID-only — match and refetch.
            for await event in await graph.realtime.events() {
                switch event.event {
                case "task.changed":
                    let conversation = event.payload["conversation_id"]?.stringValue
                    if detail == nil || conversation == nil
                        || detail?.conversation_id == nil
                        || conversation == detail?.conversation_id {
                        refreshKey += 1
                    }
                case "message.status":
                    let message = event.payload["message_id"]?.stringValue
                    if detail == nil || message == detail?.message_id {
                        refreshKey += 1
                    }
                default:
                    break
                }
            }
        }
        // #215: a socket re-JOIN (missed frames while offline) refetches the
        // task; Part A does the same on foreground return.
        .task(id: taskId) {
            for await _ in await graph.realtime.reconnected() {
                refreshKey += 1
            }
        }
        .resyncOnForeground { refreshKey += 1 }
        .sheet(isPresented: $pickerOpen) {
            if let detail {
                TaskAssigneesSheet(
                    members: members,
                    meUserId: me.user_id,
                    initial: detail.assigneeIds,
                    titleKey: "contactsTasks.assigneesTitle",
                    allowEmpty: true
                ) { userIds in
                    guard userIds != detail.assigneeIds else { return }
                    runScopedPatch { scope in
                        try await mutations.setAssignees(
                            companyId: companyId,
                            taskId: detail.id,
                            userIds: userIds,
                            scope: scope
                        )
                    }
                }
            }
        }
        .sheet(isPresented: $duePickerOpen) {
            if let detail {
                DuePickerSheet(
                    initial: parseWireTimestamp(detail.due_at),
                    onSet: { date in
                        // The API requires ISO 8601 WITH the local UTC offset.
                        let iso = encodeDueAt(date)
                        runScopedPatch { scope in
                            try await mutations.setDue(
                                companyId: companyId, taskId: detail.id, dueAt: iso, scope: scope
                            )
                        }
                    }
                )
            }
        }
        .sheet(isPresented: $repeatOpen) {
            if let detail {
                repeatSheet(detail)
            }
        }
        .confirmationDialog(
            AppStrings.translate(appLocale, "contactsTasks.scopeTitle"),
            isPresented: $scopeDialogOpen,
            titleVisibility: .visible
        ) {
            Button(AppStrings.translate(appLocale, "contactsTasks.scopeThis")) {
                answerScope(.go(TaskScope.this))
            }
            Button(AppStrings.translate(appLocale, "contactsTasks.scopeFuture")) {
                answerScope(.go(TaskScope.future))
            }
            Button(AppStrings.translate(appLocale, "common.cancel"), role: .cancel) {
                answerScope(.cancelled)
            }
        } message: {
            Text(AppStrings.translate(appLocale, "contactsTasks.scopeBody"))
        }
        .onChange(of: scopeDialogOpen) { _, open in
            // Dismissed without a choice (a tap outside): that is a cancel.
            if !open { answerScope(.cancelled) }
        }
        .alert(
            AppStrings.translate(appLocale, "contactsTasks.deleteTaskTitle"),
            isPresented: $confirmDelete
        ) {
            Button(
                AppStrings.translate(appLocale, "common.delete"),
                role: .destructive
            ) { deleteTask() }
                .disabled(deleting)
            Button(
                AppStrings.translate(appLocale, "contactsTasks.keepTask"),
                role: .cancel
            ) {}
        } message: {
            if let detail {
                Text(deleteWarning(detail))
            }
        }
    }

    // MARK: - Loading

    private func load() async {
        do {
            state = .ready(try await mutations.detail(companyId: companyId, taskId: taskId))
        } catch let error as ApiError where error.code == ApiErrorCode.notFound {
            // A teammate deleted it (task.changed → refetch → 404):
            // say so instead of showing a stale row forever.
            state = .failed(
                message: AppStrings.translate(appLocale, "contactsTasks.taskGone"),
                notFound: true
            )
        } catch {
            if case .ready = state {
                // Keep data on a quiet refresh failure.
            } else {
                state = .failed(message: error.userMessage, notFound: false)
            }
        }
    }

    private func loadFeed() async {
        guard detail?.viewer_level != "none" else { return }
        do {
            let page = try await mutations.activity(companyId: companyId, taskId: taskId)
            feed = page.data
            feedCursor = page.next_cursor
            feedFailed = false
        } catch {
            if !(error is CancellationError) { feedFailed = true }
        }
        feedLoaded = true
    }

    private func loadEarlier() {
        guard let cursor = feedCursor else { return }
        Task {
            do {
                let page = try await mutations.activity(
                    companyId: companyId,
                    taskId: taskId,
                    cursor: cursor
                )
                feed = page.data + feed
                feedCursor = page.next_cursor
            } catch {
                actionError = error.userMessage
            }
        }
    }

    // MARK: - Derived

    private var noAccess: Bool { detail?.viewer_level == "none" }

    private var canDelete: Bool {
        let role = me.memberships.first { $0.company_id == companyId }?.role
        return RecordDeletion.canDelete(role: role)
    }

    private func memberName(_ userId: String?) -> String? {
        guard let userId else { return nil }
        let name = members.first { $0.user_id == userId }?.display_name
        return (name?.isBlank ?? true) ? nil : name
    }

    private func hasNotes(_ detail: TaskDetail) -> Bool {
        detail.activity.contains { $0.kind == "note" }
    }

    private func deleteWarning(_ detail: TaskDetail) -> String {
        let carried = [
            hasNotes(detail)
                ? AppStrings.translate(appLocale, "contactsTasks.discussionNotes")
                : nil,
            detail.attachments.isEmpty
                ? nil
                : AppStrings.translate(appLocale, "contactsTasks.filesLower"),
        ]
            .compactMap(\.self)
            .joined(separator: AppStrings.translate(appLocale, "contactsTasks.andJoiner"))
        return AppStrings.translate(
            appLocale,
            "contactsTasks.deleteTaskBody",
            ["what": carried]
        )
    }

    // MARK: - Mutations

    /// Metadata edits reuse the fetched detail, swapping just the task
    /// columns, then quietly refetch so activity lines catch up.
    private func runPatch(_ patch: @escaping () async throws -> TaskRowPatch) {
        Task {
            actionError = nil
            do {
                let row = try await patch()
                if let detail {
                    state = .ready(merged(detail, with: row))
                }
                refreshKey += 1
            } catch {
                actionError = error.userMessage
            }
        }
    }

    private func merged(_ detail: TaskDetail, with row: TaskRowPatch) -> TaskDetail {
        TaskDetail(
            id: detail.id,
            company_id: detail.company_id,
            message_id: detail.message_id,
            conversation_id: detail.conversation_id,
            title: row.title,
            description: row.description,
            assigned_user_id: row.assigned_user_id,
            due_at: row.due_at,
            created_by_user_id: detail.created_by_user_id,
            created_at: detail.created_at,
            updated_at: row.updated_at,
            done: detail.done,
            status: detail.status,
            assignee: firstAssignee(after: row, detail: detail),
            created_by: detail.created_by,
            source_message: detail.source_message,
            attachments: detail.attachments,
            activity: detail.activity,
            viewer_level: detail.viewer_level,
            // #214: the raw row (`to_jsonb(v_task)`) carries the current address
            // after ANY mutation, so re-read it here — a rename/assign/due edit
            // never drops the address, and an address save reflects the new one.
            addr_street: row.addr_street,
            addr_unit: row.addr_unit,
            addr_city: row.addr_city,
            addr_state: row.addr_state,
            addr_postal_code: row.addr_postal_code,
            addr_country: row.addr_country,
            addr_provenance: row.addr_provenance,
            // #237: re-read for the same reason as the address — a rename or a
            // due edit must not drop the reminder state the screen is showing.
            reminders_off: row.reminders_off,
            confirmed_at: row.confirmed_at,
            confirmed_by: row.confirmed_by,
            source: detail.source,
            source_call: detail.source_call,
            contact: detail.contact,
            subscribed: detail.subscribed,
            // #693: a patch row that leaves these out keeps what the screen has;
            // the refetch that follows every edit settles the rest.
            priority: row.priority ?? detail.priority,
            labels: row.labels ?? detail.labels,
            series_id: row.series_id ?? detail.series_id,
            occurrence_no: row.occurrence_no ?? detail.occurrence_no,
            `repeat`: row.`repeat` ?? detail.`repeat`,
            // #689 C: the crew the server answered with; the refetch settles names.
            assignee_ids: row.assignee_ids ?? detail.assignee_ids,
            assignees: row.assignees ?? detail.assignees
        )
    }

    /// The legacy single `assignee` profile names the FIRST assignee, so it
    /// follows the crew a patch row answered with.
    private func firstAssignee(after row: TaskRowPatch, detail: TaskDetail) -> TaskProfile? {
        guard let crew = row.assignees else { return detail.assignee }
        return crew.first
    }

    // MARK: - #693 scope

    /// Ask "this one or this and future" when the task repeats; otherwise go
    /// straight ahead with no scope. The wait for the dialog is a continuation
    /// so a blur-save can await the answer.
    private func chooseScope() async -> ScopeChoice {
        guard taskNeedsScope(detail?.repeatRule) else { return .go(nil) }
        // A sheet that has just closed (the assignee or due picker) swallows a
        // dialog raised in the same breath, so let it finish going away.
        try? await Task.sleep(for: .milliseconds(300))
        return await withCheckedContinuation { continuation in
            scopeContinuation = continuation
            scopeDialogOpen = true
        }
    }

    private func answerScope(_ choice: ScopeChoice) {
        scopeDialogOpen = false
        let waiting = scopeContinuation
        scopeContinuation = nil
        waiting?.resume(returning: choice)
    }

    /// A metadata edit that may be asked which occurrences it reaches.
    private func runScopedPatch(_ patch: @escaping (String?) async throws -> TaskRowPatch) {
        Task {
            guard case .go(let scope) = await chooseScope() else { return }
            runPatch { try await patch(scope) }
        }
    }

    /// The same for an edit whose answer is not a task row (labels).
    private func runScopedAction(_ action: @escaping (String?) async throws -> Void) {
        Task {
            guard case .go(let scope) = await chooseScope() else { return }
            actionError = nil
            do {
                try await action(scope)
                refreshKey += 1
            } catch {
                actionError = error.userMessage
            }
        }
    }

    private func toggleDone() {
        guard let detail else { return }
        let next = !detail.done
        if next { Haptics.confirm() } else { Haptics.tap() }
        Task {
            actionError = nil
            do {
                // Derived-done invariant: a message task writes its SOURCE
                // MESSAGE; a call task (D64) has none and writes the task.
                try await mutations.setTaskDone(
                    companyId: companyId,
                    taskId: detail.id,
                    messageId: detail.message_id,
                    done: next
                )
                refreshKey += 1
            } catch {
                actionError = error.userMessage
            }
        }
    }

    private func toggleFollow() {
        guard let detail else { return }
        let next = !(detail.subscribed ?? false)
        Haptics.tap()
        // Shown at once and put back if the server refuses; the server
        // remembers an unfollow, so the next fetch is the truth.
        var shown = detail
        shown.subscribed = next
        state = .ready(shown)
        Task {
            actionError = nil
            do {
                try await mutations.follow(
                    companyId: companyId,
                    taskId: detail.id,
                    follow: next
                )
                refreshKey += 1
            } catch {
                var back = detail
                back.subscribed = !next
                state = .ready(back)
                actionError = error.userMessage
            }
        }
    }

    private func deleteTask(scope: String? = nil) {
        guard let detail else { return }
        deleting = true
        Task {
            actionError = nil
            do {
                try await mutations.delete(companyId: companyId, taskId: detail.id, scope: scope)
                dismiss()
            } catch let error as ApiError where error.code == ApiErrorCode.forbidden {
                actionError = AppStrings.translate(
                    appLocale, "contactsTasks.deleteForbidden"
                )
            } catch {
                actionError = error.userMessage
            }
            deleting = false
        }
    }

    // MARK: - Body

    private func followButton(_ detail: TaskDetail) -> some View {
        let following = detail.subscribed ?? false
        return Button {
            toggleFollow()
        } label: {
            Image(systemName: following ? "bell.fill" : "bell.slash")
        }
        .accessibilityLabel(
            AppStrings.translate(
                appLocale,
                following ? "contactsTasks.unfollowTask" : "contactsTasks.followTask"
            )
        )
    }

    private func overflowMenu(_ detail: TaskDetail) -> some View {
        Menu {
            if !noAccess {
                Button(
                    AppStrings.translate(
                        appLocale,
                        detail.done
                            ? "contactsTasks.markNotDone"
                            : "contactsTasks.markDone"
                    )
                ) { toggleDone() }
            }
            if canDelete {
                Button(
                    AppStrings.translate(appLocale, "contactsTasks.deleteTask"),
                    role: .destructive
                ) {
                    // #693: a repeating task asks which ones go.
                    if taskNeedsScope(detail.repeatRule) {
                        deleteScopeOpen = true
                    // #89: confirm only when the task carries notes or files;
                    // a plain task deletes now.
                    } else if hasNotes(detail) || !detail.attachments.isEmpty {
                        confirmDelete = true
                    } else {
                        deleteTask()
                    }
                }
                .disabled(deleting)
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel(AppStrings.translate(appLocale, "contactsTasks.taskActions"))
    }

    // fileprivate (not private) so the #Preview below can render the ready
    // state with inline mock data — the loaded view is otherwise unreachable
    // without a live API.
    fileprivate func readyBody(_ detail: TaskDetail) -> some View {
        VStack(spacing: 0) {
            if let actionError {
                Text(actionError)
                    .font(.caption)
                    .foregroundStyle(BrandColor.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 4)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header(detail)
                    metaChips(detail)
                    if !noAccess {
                        metaExtras(detail)
                    }
                    createdLine(detail)
                    if !noAccess {
                        onwardLinks(detail)
                    }
                    if noAccess {
                        noAccessCard
                        // #214: the address is a task column (not conversation-
                        // derived), so it shows even to a no-access viewer.
                        addressSection(detail)
                    } else {
                        sourceCard(detail)
                        descriptionSection(detail)
                        addressSection(detail)
                        TaskLinksSection(
                            references: TaskReferencesApi(api: graph.api),
                            search: referenceSearchClosure(
                                graph: graph,
                                companyId: companyId,
                                includeRecords: false
                            ),
                            companyId: companyId,
                            taskId: detail.id,
                            canEdit: true,
                            refreshKey: refreshKey,
                            onChanged: { Task { await loadFeed() } }
                        )
                        if !detail.attachments.isEmpty {
                            attachmentsSection(detail)
                        }
                        activitySection(detail)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .padding(.bottom, 16)
            }
            // A message task posts notes in its thread; any other task takes
            // comments on the task itself (#689).
            if !noAccess, detail.message_id == nil || detail.conversation_id != nil {
                NoteComposer(
                    mutations: mutations,
                    multipart: MultipartClient(api: graph.api, sessionStore: graph.sessionStore),
                    companyId: companyId,
                    conversationId: detail.message_id == nil ? nil : detail.conversation_id,
                    taskId: detail.id,
                    onPosted: { refreshKey += 1 },
                    referenceSearch: referenceSearchClosure(graph: graph, companyId: companyId)
                )
            }
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        // #690: chips in notes, descriptions and comments resolve through one
        // shared resolver for the workspace.
        .environment(
            \.referenceResolver,
            ReferenceResolverStore.shared.resolver(api: graph.api, companyId: companyId)
        )
        // #693: which of a repeating task's occurrences a delete reaches.
        .confirmationDialog(
            AppStrings.translate(appLocale, "contactsTasks.deleteScopeTitle"),
            isPresented: $deleteScopeOpen,
            titleVisibility: .visible
        ) {
            Button(
                AppStrings.translate(appLocale, "contactsTasks.deleteScopeThis"),
                role: .destructive
            ) { deleteTask(scope: TaskScope.this) }
            Button(
                AppStrings.translate(appLocale, "contactsTasks.deleteScopeFuture"),
                role: .destructive
            ) { deleteTask(scope: TaskScope.future) }
            Button(AppStrings.translate(appLocale, "common.cancel"), role: .cancel) {}
        }
    }

    private func header(_ detail: TaskDetail) -> some View {
        HStack(alignment: .top, spacing: 13) {
            if !noAccess {
                // The big derived-done ring: 28pt outline → lime fill + ink
                // check (spec 23).
                Button {
                    toggleDone()
                } label: {
                    ZStack {
                        if detail.done {
                            Circle().fill(BrandColor.lime)
                            Image(systemName: "checkmark")
                                .font(.scaled(13, weight: .bold))
                                .foregroundStyle(BrandColor.onLime)
                        } else {
                            Circle().strokeBorder(BrandColor.muted250, lineWidth: 2)
                        }
                    }
                    .frame(width: 28, height: 28)
                    .padding(.top, 3)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(
                    AppStrings.translate(
                        appLocale,
                        detail.done
                            ? "contactsTasks.markNotDone"
                            : "contactsTasks.markDone"
                    )
                )
            }
            VStack(alignment: .leading, spacing: 2) {
                // #690: the number people say out loud.
                TaskNumberTag(number: detail.number)
                titleField(detail)
            }
        }
    }

    @ViewBuilder
    private func titleField(_ detail: TaskDetail) -> some View {
        if noAccess {
            Text(detail.title)
                .font(.golos(21, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                .strikethrough(detail.done)
        } else {
            InlineEditField(
                initial: detail.title,
                maxLength: taskTitleMax,
                placeholder: AppStrings.translate(
                    appLocale, "contactsTasks.taskTitlePlaceholder"
                ),
                multiline: false,
                allowEmpty: false,
                font: .golos(21, weight: .semibold)
            ) { value in
                await saveField { scope in
                    try await mutations.rename(
                        companyId: companyId, taskId: detail.id, title: value, scope: scope
                    )
                }
            }
            .id("\(detail.id)|\(detail.updated_at)|title")
        }
    }

    private func metaChips(_ detail: TaskDetail) -> some View {
        let assigneeFaces = detail.assigneeFaces(roster: { memberName($0) })
        let assigneeLabel = taskAssigneeSummary(
            assigneeFaces, meUserId: me.user_id, locale: appLocale
        )
        let overdue = !detail.done && parseWireTimestamp(detail.due_at).map { $0 < Date() } == true
        let dueLabel: String = {
            if detail.due_at == nil {
                return AppStrings.translate(appLocale, "contactsTasks.noDueDate")
            }
            let when = formatDue(detail.due_at)
            if overdue {
                return AppStrings.translate(
                    appLocale, "contactsTasks.overdueDot", ["due": when]
                )
            }
            return AppStrings.translate(
                appLocale, "contactsTasks.dueWhen", ["when": when]
            )
        }()

        // Spec 23: a paper card of Assignee / Due rows with hairlines.
        return PaperCard {
            Button {
                if !noAccess { pickerOpen = true }
            } label: {
                HStack(spacing: 11) {
                    metaRowLabel(AppStrings.translate(appLocale, "contactsTasks.assignees"))
                    AssigneeStack(faces: assigneeFaces, size: 24)
                    Text(assigneeLabel)
                        .font(.golos(13, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                    Spacer(minLength: 0)
                    metaRowChevron
                }
                .padding(.horizontal, 15)
                .padding(.vertical, 11)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            RowDivider()
            HStack(spacing: 11) {
                Button {
                    if !noAccess { duePickerOpen = true }
                } label: {
                    HStack(spacing: 11) {
                        metaRowLabel(AppStrings.translate(appLocale, "contactsTasks.due"))
                        Text(dueLabel)
                            .font(.golos(13, weight: .semibold))
                            .foregroundStyle(overdue ? BrandColor.overdueAmber : BrandColor.ink)
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if detail.due_at != nil && !noAccess {
                    Button {
                        runScopedPatch { scope in
                            try await mutations.setDue(
                                companyId: companyId, taskId: detail.id, dueAt: nil, scope: scope
                            )
                        }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(BrandColor.muted300)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(
                        AppStrings.translate(appLocale, "contactsTasks.clearDueDate")
                    )
                }
                metaRowChevron
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 11)

            // #237: directly under the due date, because it only means anything
            // as a qualifier on it — a job with no date sends nothing whatever
            // this says, and the switch would read as broken sitting anywhere
            // else. Hidden without a date, for the same reason.
            if detail.due_at != nil {
                RowDivider()
                HStack(spacing: 11) {
                    metaRowLabel(AppStrings.translate(appLocale, "contactsTasks.remind"))
                    Text(reminderStateLine(detail))
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.muted500)
                        .lineLimit(2)
                    Spacer(minLength: 0)
                    Toggle(
                        "",
                        isOn: Binding(
                            get: { !(detail.reminders_off ?? false) },
                            set: { on in
                                runPatch {
                                    try await mutations.setReminders(
                                        companyId: companyId,
                                        taskId: detail.id,
                                        off: !on
                                    )
                                }
                            }
                        )
                    )
                    .labelsHidden()
                    .disabled(noAccess)
                    .accessibilityLabel(
                        AppStrings.translate(appLocale, "contactsTasks.remindAria")
                    )
                }
                .padding(.horizontal, 15)
                .padding(.vertical, 11)
            }
        }
    }

    // MARK: - #693 priority, repeat, labels

    /// A paper card under Assignee / Due: Priority, Repeat and Labels. A repeat
    /// shows its icon and the sentence ("Repeats every Monday"); editing any of
    /// the three on a repeating task asks "this one or this and future" first,
    /// except the repeat itself, which always covers this one and the future.
    private func metaExtras(_ detail: TaskDetail) -> some View {
        PaperCard {
            priorityRow(detail)
            RowDivider()
            repeatRow(detail)
            RowDivider()
            labelsRow(detail)
        }
    }

    private func priorityRow(_ detail: TaskDetail) -> some View {
        let current = detail.priorityValue
        return Menu {
            ForEach(TaskPriority.allCases) { priority in
                Button {
                    if priority != current {
                        runScopedPatch { scope in
                            try await mutations.setPriority(
                                companyId: companyId,
                                taskId: detail.id,
                                priority: priority,
                                scope: scope
                            )
                        }
                    }
                } label: {
                    if priority == current {
                        Label(
                            AppStrings.translate(appLocale, priority.labelKey),
                            systemImage: "checkmark"
                        )
                    } else {
                        Text(AppStrings.translate(appLocale, priority.labelKey))
                    }
                }
            }
        } label: {
            HStack(spacing: 11) {
                metaRowLabel(AppStrings.translate(appLocale, "contactsTasks.priority"))
                if current.isFlagged {
                    TaskPriorityMark(priority: current)
                } else {
                    Text(AppStrings.translate(appLocale, current.labelKey))
                        .font(.golos(13, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                }
                Spacer(minLength: 0)
                metaRowChevron
            }
            .padding(.horizontal, 15)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
    }

    private func repeatRow(_ detail: TaskDetail) -> some View {
        let rule = detail.repeatRule
        let live = rule != nil && rule?.isStopped == false
        return Button {
            repeatOpen = true
        } label: {
            HStack(spacing: 11) {
                metaRowLabel(AppStrings.translate(appLocale, "contactsTasks.repeat"))
                if let rule, live {
                    Image(systemName: "repeat")
                        .font(.scaled(12, weight: .semibold))
                        .foregroundStyle(BrandColor.muted500)
                    Text(taskRepeatDetailLine(rule, locale: appLocale))
                        .font(.golos(13, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .multilineTextAlignment(.leading)
                } else {
                    Text(
                        AppStrings.translate(
                            appLocale,
                            rule == nil ? "contactsTasks.repeatNone" : "contactsTasks.repeatEnded"
                        )
                    )
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
                }
                Spacer(minLength: 0)
                metaRowChevron
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 11)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func labelsRow(_ detail: TaskDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            metaRowLabel(AppStrings.translate(appLocale, "contactsTasks.labels"))
            TaskLabelsEditor(
                labels: detail.labelList,
                available: tags,
                onAdd: { tagId, name in
                    runScopedAction { scope in
                        let added = try await mutations.addTag(
                            companyId: companyId,
                            taskId: detail.id,
                            tagId: tagId,
                            name: name,
                            scope: scope
                        )
                        // A label made by name changes what the picker offers.
                        if tagId == nil, !tags.contains(where: { $0.id == added.tag.id }),
                           let page = try? await mutations.tags(companyId: companyId) {
                            tags = page.data
                        }
                    }
                },
                onRemove: { tagId in
                    runScopedAction { scope in
                        try await mutations.removeTag(
                            companyId: companyId,
                            taskId: detail.id,
                            tagId: tagId,
                            scope: scope
                        )
                    }
                }
            )
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Where a repeat is set, changed, paused or stopped. Always applies to this
    /// one and the future, so it asks nothing.
    private func repeatSheet(_ detail: TaskDetail) -> some View {
        let live: TaskRepeatRule? = detail.repeatRule?.isStopped == false ? detail.repeatRule : nil
        let initial: TaskRepeatDraft = live.map { TaskRepeatDraft(rule: $0) }
            ?? TaskRepeatDraft.starting(
                due: parseWireTimestamp(detail.due_at),
                afterDone: detail.conversation_id != nil || detail.contact != nil
            )
        return TaskRepeatSheet(
            initial: initial,
            hasDue: detail.due_at != nil,
            isEditing: live != nil,
            onSave: { draft in
                runPatch {
                    try await mutations.setRepeat(
                        companyId: companyId, taskId: detail.id, rule: draft.wireBody()
                    )
                }
            },
            onRemove: {
                runPatch {
                    try await mutations.setRepeat(
                        companyId: companyId, taskId: detail.id, rule: nil
                    )
                }
            }
        )
    }

    /// #237 — who confirmed, said plainly.
    ///
    /// A customer confirming is a promise from the person who has to be there;
    /// a crew member marking it is a note to ourselves. A dispatcher deciding
    /// whether to send a van reads them differently, so the line does too. Same
    /// wording as the web panel and the Android row.
    /// Takes the detail rather than reading the view's own, which is OPTIONAL —
    /// every other row on this card is rendered inside `metaChips(_ detail:)`,
    /// which has already unwrapped it, and a computed property reaching for
    /// `self.detail` would be a second source for the same fact.
    private func reminderStateLine(_ detail: TaskDetail) -> String {
        if detail.confirmed_at != nil {
            return AppStrings.translate(
                appLocale,
                detail.confirmed_by == "customer"
                    ? "contactsTasks.confirmedByCustomer"
                    : "contactsTasks.confirmedByCrew"
            )
        }
        return AppStrings.translate(
            appLocale,
            (detail.reminders_off ?? false)
                ? "contactsTasks.remindOff"
                : "contactsTasks.remindWorkspace"
        )
    }

    private func metaRowLabel(_ text: String) -> some View {
        Text(text)
            .font(.golos(11, weight: .semibold))
            .foregroundStyle(BrandColor.muted500)
            .frame(width: 64, alignment: .leading)
    }

    private var metaRowChevron: some View {
        Image(systemName: "chevron.down")
            .font(.scaled(12, weight: .medium))
            .foregroundStyle(BrandColor.muted250)
    }

    /// #717: the header's action row. The ways onward are labelled links
    /// here, not icons in a corner.
    @ViewBuilder
    private func onwardLinks(_ detail: TaskDetail) -> some View {
        let contactId = detail.contact?.id
        if contactId != nil {
            HStack(spacing: 4) {
                if let contactId {
                    RecordOpenLink(
                        label: AppStrings.translate(appLocale, "contactsTasks.openContact")
                    ) {
                        AppRouter.shared.openContactId = contactId
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, -6)
        }
    }

    private func createdLine(_ detail: TaskDetail) -> some View {
        let creator: String? = {
            if let name = detail.created_by?.display_name, !name.isBlank { return name }
            return memberName(detail.created_by_user_id)
        }()
        let parts = [
            creator.map {
                AppStrings.translate(
                    appLocale, "contactsTasks.createdByName", ["name": $0]
                )
            },
            relativeTime(detail.created_at),
        ].compactMap(\.self).filter { !$0.isEmpty }
        return HStack(spacing: 7) {
            DsChip(
                text: AppStrings.translate(
                    appLocale,
                    detail.done ? "contactsTasks.columnDone" : "contactsTasks.columnToDo"
                )
            )
            Text(parts.joined(separator: " · "))
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted300)
        }
    }

    private var noAccessCard: some View {
        Text(AppStrings.translate(appLocale, "contactsTasks.taskNoAccess"))
        .font(.golos(13))
        .foregroundStyle(BrandColor.muted700)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    /// #718: the link that names the source, present only when there is one.
    private func sourceLink(_ detail: TaskDetail) -> TaskSourceLink? {
        guard onOpenConversation != nil else { return nil }
        return taskSourceLink(
            conversationId: detail.conversation_id,
            messageId: detail.message_id,
            source: detail.source,
            call: detail.source_call,
            sourceMessageDirection: detail.source_message?.direction,
            contactName: detail.contact?.name,
            locale: appLocale
        )
    }

    @ViewBuilder
    private func sourceCard(_ detail: TaskDetail) -> some View {
        let link = sourceLink(detail)
        if let source = detail.source_message {
            VStack(alignment: .leading, spacing: 6) {
                sectionLabel(
                    AppStrings.translate(appLocale, "contactsTasks.fromThisMessage")
                )
                // Spec 23: paper well with the lime source-quote bar.
                HStack(alignment: .top, spacing: 10) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(BrandColor.lime)
                        .frame(width: 3)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(
                            source.body.isBlank
                                ? AppStrings.translate(appLocale, "contactsTasks.aPhoto")
                                : source.body
                        )
                            .font(.golos(12.5))
                            .foregroundStyle(BrandColor.muted700)
                        if let link {
                            Button(link.label) {
                                onOpenConversation?(link.conversationId, link.messageId)
                            }
                            .font(.golos(11, weight: .bold))
                            .foregroundStyle(BrandColor.olive)
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 15)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    BrandColor.paper,
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous)
                )
            }
        } else if let call = detail.source_call {
            // D64: the call this task was promoted from, where a message would be.
            TaskSourceCallCard(call: call, linkLabel: link?.label) {
                if let link {
                    onOpenConversation?(link.conversationId, link.messageId)
                }
            }
        } else if detail.message_id == nil {
            // #689: a standalone task has no text or call behind it.
            VStack(alignment: .leading, spacing: 4) {
                Text(AppStrings.translate(appLocale, "contactsTasks.noSource"))
                    .font(.golos(13, weight: .semibold))
                Text(AppStrings.translate(appLocale, "contactsTasks.noSourceHint"))
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted700)
                if let name = detail.contact?.name, !name.isBlank {
                    Text(name)
                        .font(.golos(12))
                        .foregroundStyle(BrandColor.muted700)
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                BrandColor.paper,
                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
            )
        }
    }

    /// #214: the structured job address, editable inline. Keyed on updated_at
    /// so a settled save (or realtime refresh) re-seeds it from the server row —
    /// the same resync the title/description inline editors use.
    private func addressSection(_ detail: TaskDetail) -> some View {
        TaskAddressSection(detail: detail) { fields, provenance in
            saveAddress(fields, provenance: provenance)
        }
        .id("\(detail.id)|\(detail.updated_at)|address")
    }

    private func saveAddress(_ fields: AddressFieldValues, provenance: String) {
        guard let detail else { return }
        runScopedPatch { scope in
            try await mutations.updateAddress(
                companyId: companyId,
                taskId: detail.id,
                fields: fields,
                provenance: provenance,
                scope: scope
            )
        }
    }

    private func descriptionSection(_ detail: TaskDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel(AppStrings.translate(appLocale, "contactsTasks.description"))
            InlineEditField(
                initial: detail.description,
                maxLength: taskDescriptionMax,
                placeholder: AppStrings.translate(
                    appLocale, "contactsTasks.descriptionPlaceholder"
                ),
                multiline: true,
                allowEmpty: true,
                font: .golos(13),
                onSave: { value in
                    await saveField { scope in
                        try await mutations.describe(
                            companyId: companyId,
                            taskId: detail.id,
                            description: value,
                            scope: scope
                        )
                    }
                },
                // #690: a `#` in the description points at a task, contact or conversation.
                referenceSearch: referenceSearchClosure(graph: graph, companyId: companyId)
            )
            .id("\(detail.id)|\(detail.updated_at)|description")
            // #690: what the description points at, as chips you can tap.
            ReferenceChipRow(text: detail.description)
        }
    }

    /// Run one inline-edit save; returns the error sentence (nil = saved).
    private func saveField(
        _ patch: @escaping (String?) async throws -> TaskRowPatch
    ) async -> String? {
        // #693: a repeating task asks which occurrences first. Cancelling leaves
        // the typed text in the field, with a line saying it was not saved.
        guard case .go(let scope) = await chooseScope() else {
            return AppStrings.translate(appLocale, "contactsTasks.scopeNotSaved")
        }
        do {
            let row = try await patch(scope)
            if let detail {
                state = .ready(merged(detail, with: row))
            }
            refreshKey += 1
            return nil
        } catch {
            return error.userMessage
        }
    }

    /// #294 — grouped into the visits they arrived on, oldest first.
    ///
    /// One flat strip made a job with four site visits look identical to a job with
    /// one, and said nothing about which pictures were the finished work. Every file
    /// already knows the note it came in on, and that note has a time, an author and
    /// a label.
    private func attachmentsSection(_ detail: TaskDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel(AppStrings.translate(appLocale, "contactsTasks.files"))
            ForEach(groupJobPhotos(detail.attachments)) { group in
                PhotoGroupHeader(
                    phase: group.workPhase,
                    at: group.at,
                    addedByUserId: group.addedByUserId,
                    fromCustomer: group.noteId == nil,
                    // The resolver this screen already uses for the assignee and
                    // the activity timeline.
                    nameOf: memberName
                )
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(group.items, id: \.id) { item in
                            AttachmentCell(
                                item: item,
                                mutations: mutations,
                                companyId: companyId,
                                onError: { actionError = $0 }
                            )
                        }
                    }
                }
                .padding(.bottom, 6)
            }
            // #294: only when there are photos to send. An offer to share an empty
            // set is an offer to look unready.
            ShareJobPhotos(
                taskId: detail.id,
                photoCount: detail.attachments.filter { $0.kind == "image" }.count,
                mutations: mutations,
                companyId: companyId,
                onError: { actionError = $0 }
            )
        }
    }

    private func activitySection(_ detail: TaskDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel(AppStrings.translate(appLocale, "contactsTasks.activity"))
            if feedFailed && feed.isEmpty {
                Text(AppStrings.translate(appLocale, "contactsTasks.activityLoadFailed"))
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
            } else if feedLoaded && feed.isEmpty {
                Text(
                    AppStrings.translate(
                        appLocale,
                        detail.message_id == nil
                            ? "contactsTasks.activityEmptyComment"
                            : "contactsTasks.activityEmpty"
                    )
                )
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted500)
            }
            if feedCursor != nil {
                Button(AppStrings.translate(appLocale, "contactsTasks.activityEarlier")) {
                    loadEarlier()
                }
                .font(.golos(13))
            }
            ForEach(feed, id: \.id) { item in
                if item.kind == "note" {
                    NoteCard(
                        author: feedName(item.author),
                        body: item.body ?? "",
                        createdAt: item.created_at
                    )
                } else if item.kind == "reference" {
                    referenceLine(item)
                } else if item.kind == "comment" {
                    CommentCard(
                        item: item,
                        author: feedName(item.author),
                        canEdit: item.author?.user_id == me.user_id,
                        canDelete: item.author?.user_id == me.user_id
                            || MemberRole.atLeast(
                                me.memberships.first { $0.company_id == companyId }?.role,
                                required: MemberRole.admin
                            ),
                        mutations: mutations,
                        companyId: companyId,
                        taskId: detail.id,
                        onChanged: { refreshKey += 1 },
                        onError: { actionError = $0 }
                    )
                } else {
                    let by = item.actor == nil ? "Loonext" : feedName(item.actor)
                    let sentence = item.event == "link_added" || item.event == "link_removed"
                        ? taskLinkSentence(item, by: by, locale: appLocale)
                        : taskHistorySentence(item, by: by, locale: appLocale)
                    // Spec 23: a muted dot bullet + quiet sentence per event.
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Circle()
                            .fill(BrandColor.muted250)
                            .frame(width: 6, height: 6)
                        Text(
                            AppStrings.translate(
                                appLocale,
                                "contactsTasks.activityLine",
                                [
                                    "sentence": sentence,
                                    "when": relativeTime(item.created_at),
                                ]
                            )
                        )
                            .font(.golos(12))
                            .foregroundStyle(BrandColor.muted600)
                    }
                    .padding(.leading, 4)
                }
            }
        }
    }

    /// #690: a note, task description or comment elsewhere that points at this
    /// task, or something this task points at. Quiet, like a history line.
    private func referenceLine(_ item: TaskFeedItem) -> some View {
        let sentence = taskReferenceSentence(item, by: feedName(item.author), locale: appLocale)
        return HStack(alignment: .firstTextBaseline, spacing: 9) {
            Image(systemName: "link")
                .font(.scaled(9, weight: .semibold))
                .foregroundStyle(BrandColor.muted500)
                .frame(width: 6)
                .accessibilityHidden(true)
            Text(
                AppStrings.translate(
                    appLocale,
                    "contactsTasks.activityLine",
                    ["sentence": sentence, "when": relativeTime(item.created_at)]
                )
            )
            .font(.golos(12))
            .foregroundStyle(BrandColor.muted600)
        }
        .padding(.leading, 4)
    }

    private func feedName(_ person: TaskProfile?) -> String {
        if let name = person?.display_name, !name.isBlank { return name }
        return memberName(person?.user_id)
            ?? AppStrings.translate(appLocale, "contactsTasks.teammate")
    }

    private func sectionLabel(_ text: String) -> some View {
        SectionHeader(label: text)
    }
}

// MARK: - Inline blur-save editor

/// Blur-save inline editor: saving happens when focus leaves the field with a
/// changed value; an empty value snaps back when `allowEmpty` is false. The
/// save callback returns an error sentence (nil = saved) so failures keep the
/// user's text and show a calm line under the field.
@MainActor
private struct InlineEditField: View {
    let initial: String
    let maxLength: Int
    let placeholder: String
    let multiline: Bool
    let allowEmpty: Bool
    let font: Font
    /// #690: set only where a `#` takes a reference (the description). Nil
    /// leaves the field a plain one.
    let referenceSearch: (@MainActor (String) async -> [ReferencePick])?
    let onSave: (String) async -> String?

    @State private var value: String
    @State private var error: String?
    @State private var referencePickerOpen = false
    @FocusState private var focused: Bool

    init(
        initial: String,
        maxLength: Int,
        placeholder: String,
        multiline: Bool,
        allowEmpty: Bool,
        font: Font,
        onSave: @escaping (String) async -> String?,
        referenceSearch: (@MainActor (String) async -> [ReferencePick])? = nil
    ) {
        self.initial = initial
        self.maxLength = maxLength
        self.placeholder = placeholder
        self.multiline = multiline
        self.allowEmpty = allowEmpty
        self.font = font
        self.referenceSearch = referenceSearch
        self.onSave = onSave
        _value = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            TextField(
                placeholder,
                text: $value,
                axis: multiline ? .vertical : .horizontal
            )
            .font(font)
            .lineLimit(multiline ? 2 ... 6 : 1 ... 1)
            .focused($focused)
            .onChange(of: value) { previous, next in
                error = nil
                if next.count > maxLength {
                    value = String(next.prefix(maxLength))
                }
                if referenceSearch != nil, opensReferencePicker(previous: previous, value: next) {
                    referencePickerOpen = true
                }
            }
            .onChange(of: focused) { wasFocused, isFocused in
                guard wasFocused, !isFocused else { return }
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed == initial.trimmingCharacters(in: .whitespacesAndNewlines) { return }
                if trimmed.isEmpty && !allowEmpty {
                    value = initial // empty snaps back
                    return
                }
                Task { error = await onSave(trimmed) }
            }
            .onSubmit { focused = false }
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(BrandColor.destructive)
            }
        }
        .referencePickerSheet(
            isPresented: $referencePickerOpen,
            search: { query in await searchReferences(query) }
        ) { pick in
            value = insertingReference(into: value, insert: pick.insertText)
        }
    }

    private func searchReferences(_ query: String) async -> [ReferencePick] {
        guard let referenceSearch else { return [] }
        return await referenceSearch(query)
    }
}

// MARK: - Address (#214)

/// The task's structured job address, editable inline. Enriched values (an
/// address suggested by AI at create time) carry a provenance badge; any edit
/// marks the address user-authored ("manual"). Saves the whole block when
/// focus leaves the group (never mid-field) or the section is dismissed, and
/// the RPC no-ops an unchanged address. Mirrors the web TaskAddressSection.
@MainActor
private struct TaskAddressSection: View {
    let detail: TaskDetail
    let onSave: @MainActor (AddressFieldValues, String) -> Void

    private enum AddrField: Hashable {
        case street, unit, city, state, postal, country
    }

    @State private var fields: AddressFieldValues
    @State private var provenance: String?
    @State private var open: Bool
    @FocusState private var focused: AddrField?

    @Environment(\.appLocale) private var appLocale

    init(detail: TaskDetail, onSave: @escaping @MainActor (AddressFieldValues, String) -> Void) {
        self.detail = detail
        self.onSave = onSave
        let initial = detail.addressFields
        _fields = State(initialValue: initial)
        _provenance = State(initialValue: detail.addr_provenance)
        _open = State(initialValue: !initial.isEmpty)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    if open { commit() } // collapsing counts as leaving the group
                    open.toggle()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "mappin.and.ellipse")
                            .font(.scaled(13, weight: .medium))
                            .foregroundStyle(BrandColor.muted500)
                        Text(AppStrings.translate(appLocale, "contactsTasks.address"))
                            .font(.golos(13.5, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                        if let label = addressProvenanceLabel(
                            provenance, locale: appLocale
                        ) {
                            provenanceBadge(label)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                Spacer(minLength: 0)

                // #220: one-tap clear — shown whenever the address has content.
                // Clearing commits (an empty address PATCHes `{"address": null}`),
                // consistent with the section's commit-on-change contract.
                if !fields.isEmpty {
                    Button(
                        AppStrings.translate(appLocale, "contactsTasks.clear"),
                        action: clearAddress
                    )
                        .font(.golos(12.5, weight: .semibold))
                        .foregroundStyle(BrandColor.muted500)
                        .buttonStyle(.plain)
                        .accessibilityLabel(
                            AppStrings.translate(appLocale, "contactsTasks.clearAddress")
                        )
                }

                // The disclosure chevron stays the trailing affordance (parity
                // with Android/web); tapping it toggles like the label.
                Image(systemName: "chevron.down")
                    .font(.scaled(12, weight: .medium))
                    .foregroundStyle(BrandColor.muted250)
                    .rotationEffect(.degrees(open ? 180 : 0))
                    .onTapGesture {
                        if open { commit() }
                        open.toggle()
                    }
            }

            if open {
                VStack(spacing: 8) {
                    addrField("contactsTasks.addrStreet", text: $fields.street, field: .street)
                    HStack(spacing: 8) {
                        addrField("contactsTasks.addrUnit", text: $fields.unit, field: .unit)
                        addrField("contactsTasks.addrCity", text: $fields.city, field: .city)
                    }
                    HStack(spacing: 8) {
                        addrField("contactsTasks.addrState", text: $fields.state, field: .state)
                        addrField(
                            "contactsTasks.addrPostalCode",
                            text: $fields.postalCode,
                            field: .postal
                        )
                    }
                    // #214: the country is a typable, searchable picker. A
                    // selection is a field edit — mark the address "manual" (as
                    // typing does) and commit right away, since there is no
                    // text-field blur to trigger the save. The binding and
                    // provenance are written before `commit()` reads them.
                    CountryField(value: $fields.country) {
                        provenance = AddressProvenance.manual
                        commit()
                    }
                }
                // Editing any field marks the whole address user-authored.
                .onChange(of: fields) { _, _ in provenance = AddressProvenance.manual }
                // Focus leaving the whole group (keyboard dismiss / tap away) is
                // the blur-out-of-group the web saves on.
                .onChange(of: focused) { _, newValue in
                    if newValue == nil { commit() }
                }
            }
        }
        .padding(.horizontal, 4)
        // Safety net: a save-on-leave if the screen pops with the keyboard up.
        .onDisappear { commit() }
    }

    private func provenanceBadge(_ label: String) -> some View {
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

    /// The placeholder IS the label here, so it comes from the catalogue by
    /// KEY rather than by sentence — one lookup at the one call site.
    private func addrField(
        _ placeholderKey: String,
        text: Binding<String>,
        field: AddrField
    ) -> some View {
        TextField(AppStrings.translate(appLocale, placeholderKey), text: text)
            .font(.golos(13))
            .foregroundStyle(BrandColor.ink)
            .textInputAutocapitalization(.words)
            .autocorrectionDisabled()
            .focused($focused, equals: field)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                BrandColor.inset,
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
    }

    /// Save the block when the edited fields differ from the SERVER's current
    /// address (the value this section was built from). Comparing against the
    /// live row — not a "last attempted" value — is what makes a failed save
    /// retryable: the server row stays stale on failure, so the next commit
    /// still differs and re-sends; a successful save recreates this section
    /// (it is keyed on updated_at) from the new server row, so it won't re-save.
    /// Mirrors the web TaskAddressSection. (If focus-leave and onDisappear both
    /// fire for one edit before the save returns, the second is an idempotent
    /// no-op the server folds away — or a free retry if the first failed.)
    private func commit() {
        guard fields.trimmed != detail.addressFields.trimmed else { return }
        onSave(fields, provenance ?? AddressProvenance.manual)
    }

    /// #220: wipe every field, drop the provenance badge, and commit so the
    /// cleared address saves. An all-empty `fields` makes `taskAddressPatchBody`
    /// send `{"address": null}` (clear); `commit()`'s guard still fires because
    /// empty differs from the server's current (non-empty) address. Mirrors the
    /// web TaskAddressSection's clear. (When there was nothing to clear the
    /// guard no-ops — the Clear button only shows when a field has content.)
    private func clearAddress() {
        fields = AddressFieldValues()
        provenance = nil
        commit()
    }
}

// MARK: - Due picker

/// Date + time picker for due_at. The caller encodes the picked Date as
/// offset-bearing ISO via `encodeDueAt`.
@MainActor
private struct DuePickerSheet: View {
    let initial: Date?
    let onSet: @MainActor (Date) -> Void

    @State private var draft: Date
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale

    init(initial: Date?, onSet: @escaping @MainActor (Date) -> Void) {
        self.initial = initial
        self.onSet = onSet
        // Default to today 9:00 like the Android picker's initial time.
        let fallback = Calendar.current.date(
            bySettingHour: 9, minute: 0, second: 0, of: Date()
        ) ?? Date()
        _draft = State(initialValue: initial ?? fallback)
    }

    var body: some View {
        VStack(spacing: 12) {
            DatePicker(
                AppStrings.translate(appLocale, "contactsTasks.due"),
                selection: $draft,
                displayedComponents: [.date, .hourAndMinute]
            )
            .datePickerStyle(.graphical)
            HStack {
                Button(AppStrings.translate(appLocale, "common.cancel")) { dismiss() }
                    .foregroundStyle(.secondary)
                Spacer()
                Button(AppStrings.translate(appLocale, "contactsTasks.setDueDate")) {
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

// MARK: - Attachments

/// One derived-union attachment. URLs are short-lived and NEVER cached:
/// images mint on entering the view (per view), files mint at open time and
/// hand the signed URL to the system — the honest path without a download
/// pipeline.
@MainActor
private struct AttachmentCell: View {
    let item: TaskAttachmentItem
    let mutations: TaskMutations
    let companyId: String
    let onError: @MainActor (String?) -> Void

    @State private var url: URL?
    @State private var failed = false
    @Environment(\.openURL) private var openURL
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        if item.kind == "image" {
            imageCell
        } else {
            fileCell
        }
    }

    private var imageCell: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(BrandColor.inset)
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        couldNotLoad
                    default:
                        ProgressView()
                    }
                }
            } else if failed {
                couldNotLoad
            }
        }
        .frame(width: 96, height: 96)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .contentShape(Rectangle())
        .onTapGesture { openFresh() }
        .task(id: item.id) {
            do {
                let minted = try await mutations.attachmentUrl(
                    companyId: companyId, attachmentId: item.id
                )
                url = URL(string: minted.url)
            } catch {
                failed = true
                onError(error.userMessage)
            }
        }
        .accessibilityLabel(
            item.file_name ?? AppStrings.translate(appLocale, "contactsTasks.photo")
        )
    }

    private var couldNotLoad: some View {
        Text(AppStrings.translate(appLocale, "contactsTasks.couldntLoad"))
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    private var fileCell: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc")
                .foregroundStyle(BrandColor.muted500)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.file_name ?? AppStrings.translate(appLocale, "contactsTasks.file"))
                    .font(.golos(11.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(1)
                Text(formatBytes(item.size_bytes))
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted400)
            }
        }
        .padding(10)
        .frame(width: 180, alignment: .leading)
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 12))
        .contentShape(Rectangle())
        .onTapGesture { openFresh() }
    }

    /// Open with a freshly minted URL — the one on screen may have expired.
    private func openFresh() {
        Task {
            do {
                let minted = try await mutations.attachmentUrl(
                    companyId: companyId, attachmentId: item.id
                )
                if let fresh = URL(string: minted.url) {
                    openURL(fresh)
                }
            } catch {
                onError(error.userMessage)
            }
        }
    }
}

// MARK: - Notes

/// A task-linked discussion note: amber card with author + time + body.
private struct NoteCard: View {
    let author: String
    let body_: String
    let createdAt: String

    init(author: String, body: String, createdAt: String) {
        self.author = author
        self.body_ = body
        self.createdAt = createdAt
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Spec 23: internal note = dashed inset well, lock + AUTHOR · TIME.
            HStack(spacing: 6) {
                Image(systemName: "lock")
                    .font(.scaled(10, weight: .semibold))
                    .foregroundStyle(BrandColor.muted600)
                Text("\(author) · \(relativeTime(createdAt))".uppercased())
                    .font(.golos(10, weight: .bold))
                    .kerning(0.8)
                    .foregroundStyle(BrandColor.muted600)
            }
            if !body_.isBlank {
                ReferencedText(text: body_, font: .golos(12.5), color: BrandColor.ink)
            }
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandColor.inset, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(
                    BrandColor.muted250,
                    style: StrokeStyle(lineWidth: 1.5, dash: [4, 4])
                )
        )
    }
}

// MARK: - Comment

/// A comment on the task (#689): author and time, text, files, and edit/delete
/// for whoever may.
private struct CommentCard: View {
    let item: TaskFeedItem
    let author: String
    let canEdit: Bool
    let canDelete: Bool
    let mutations: TaskMutations
    let companyId: String
    let taskId: String
    let onChanged: @MainActor () -> Void
    let onError: @MainActor (String?) -> Void

    @State private var editing = false
    @State private var draft = ""
    @State private var saving = false

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(author)
                    .font(.golos(12.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Text(timeLine)
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted600)
                Spacer()
                if (canEdit || canDelete) && !editing {
                    Menu {
                        if canEdit {
                            Button(AppStrings.translate(appLocale, "contactsTasks.commentEdit")) {
                                draft = item.body ?? ""
                                editing = true
                            }
                        }
                        if canDelete {
                            Button(
                                AppStrings.translate(appLocale, "contactsTasks.commentDelete"),
                                role: .destructive
                            ) {
                                delete()
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .foregroundStyle(BrandColor.muted500)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel(
                        AppStrings.translate(appLocale, "contactsTasks.commentActions")
                    )
                }
            }
            if editing {
                TextField("", text: $draft, axis: .vertical)
                    .font(.golos(13))
                    .lineLimit(1 ... 6)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Button(AppStrings.translate(appLocale, "contactsTasks.commentSave")) {
                        save()
                    }
                    .disabled(saving || draft.isBlank)
                    Button(AppStrings.translate(appLocale, "common.cancel")) {
                        editing = false
                    }
                }
                .font(.golos(13))
            } else {
                ReferencedText(text: item.body ?? "", font: .golos(13), color: BrandColor.ink)
            }
            if let files = item.attachments, !files.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(files, id: \.id) { file in
                            AttachmentCell(
                                item: TaskAttachmentItem(
                                    id: file.id,
                                    source: "task_comment",
                                    kind: (file.content_type ?? "").hasPrefix("image/")
                                        ? "image" : "file",
                                    file_name: file.file_name,
                                    content_type: file.content_type,
                                    size_bytes: file.size_bytes,
                                    created_at: file.created_at
                                ),
                                mutations: mutations,
                                companyId: companyId,
                                onError: onError
                            )
                        }
                    }
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var timeLine: String {
        let when = relativeTime(item.created_at)
        guard item.edited_at != nil else { return when }
        return "\(when) · \(AppStrings.translate(appLocale, "contactsTasks.commentEdited"))"
    }

    private func save() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        saving = true
        Task {
            do {
                _ = try await mutations.editComment(
                    companyId: companyId,
                    taskId: taskId,
                    commentId: item.id,
                    body: text
                )
                editing = false
                onChanged()
            } catch {
                onError(error.userMessage)
            }
            saving = false
        }
    }

    private func delete() {
        Task {
            do {
                try await mutations.deleteComment(
                    companyId: companyId,
                    taskId: taskId,
                    commentId: item.id
                )
                onChanged()
            } catch {
                onError(error.userMessage)
            }
        }
    }
}

// MARK: - Composer

/// One staged composer file (bytes read at post time, not at pick time).
private struct TaskStagedFile: Identifiable, Sendable {
    let id = UUID()
    let url: URL
    let name: String
    let size: Int
    let contentType: String
}

/// The pinned note composer (TASKS-V2 D-D): posts an internal note with
/// task_id, then uploads staged files against the note (owner_type='note' —
/// the only door for task files, D28). Partial upload failure keeps an honest
/// line pointing at the note in the thread.
@MainActor
private struct NoteComposer: View {
    let mutations: TaskMutations
    let multipart: MultipartClient
    let companyId: String
    /// Nil posts a comment on the task instead of a note in its thread.
    let conversationId: String?
    let taskId: String
    let onPosted: @MainActor () -> Void
    /// #690: a `#` here takes a reference, in a note and in a comment alike.
    let referenceSearch: @MainActor (String) async -> [ReferencePick]

    @State private var body_ = ""
    @State private var staged: [TaskStagedFile] = []
    @State private var posting = false
    @State private var error: String?
    @State private var pickerOpen = false
    @State private var referencePickerOpen = false

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !staged.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(staged) { file in
                            Button {
                                staged.removeAll { $0.id == file.id }
                            } label: {
                                HStack(spacing: 4) {
                                    Text(file.name)
                                        .font(.caption)
                                        .lineLimit(1)
                                    Image(systemName: "xmark")
                                        .font(.caption2)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(BrandColor.inset, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(
                                AppStrings.translate(
                                    appLocale,
                                    "contactsTasks.removeNamed",
                                    ["name": file.name]
                                )
                            )
                        }
                    }
                }
            }
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(BrandColor.destructive)
            }
            // Spec 23: paper capsule composer with the 38pt ink send circle.
            HStack(alignment: .bottom, spacing: 8) {
                Button {
                    pickerOpen = true
                } label: {
                    Image(systemName: "paperclip")
                        .foregroundStyle(BrandColor.muted500)
                }
                .buttonStyle(.borderless)
                .disabled(posting || staged.count >= noteFilesMax)
                .accessibilityLabel(
                    AppStrings.translate(appLocale, "contactsTasks.attachFiles")
                )
                TextField(
                    AppStrings.translate(
                        appLocale,
                        conversationId == nil
                            ? "contactsTasks.commentPlaceholder"
                            : "contactsTasks.noteComposerTeam"
                    ),
                    text: $body_,
                    axis: .vertical
                )
                    .font(.golos(13))
                    .lineLimit(1 ... 4)
                    .onChange(of: body_) { previous, next in
                        error = nil
                        if next.count > noteBodyMax {
                            body_ = String(next.prefix(noteBodyMax))
                        }
                        if opensReferencePicker(previous: previous, value: next) {
                            referencePickerOpen = true
                        }
                    }
                Button {
                    post()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.scaled(15, weight: .semibold))
                        .foregroundStyle(BrandColor.paper)
                        .frame(width: 38, height: 38)
                        .background(BrandColor.ink, in: Circle())
                }
                .buttonStyle(.borderless)
                .disabled(
                    posting || (body_.isBlank && (conversationId == nil || staged.isEmpty))
                )
                .accessibilityLabel(
                    AppStrings.translate(
                        appLocale,
                        conversationId == nil ? "contactsTasks.postComment" : "contactsTasks.postNote"
                    )
                )
            }
            .padding(.leading, 14)
            .padding(.trailing, 5)
            .padding(.vertical, 5)
            .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .shadow(color: Color.black.opacity(0.07), radius: 4, y: 2)
        }
        .padding(.horizontal, 14)
        .padding(.top, 6)
        .padding(.bottom, 10)
        .referencePickerSheet(isPresented: $referencePickerOpen, search: referenceSearch) { pick in
            body_ = insertingReference(into: body_, insert: pick.insertText)
        }
        .fileImporter(
            isPresented: $pickerOpen,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true
        ) { result in
            guard case .success(let urls) = result else { return }
            stage(urls)
        }
    }

    private func stage(_ urls: [URL]) {
        let room = noteFilesMax - staged.count
        var oversize = false
        var next: [TaskStagedFile] = []
        for url in urls.prefix(room) {
            let accessing = url.startAccessingSecurityScopedResource()
            defer { if accessing { url.stopAccessingSecurityScopedResource() } }
            let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
            let size = values?.fileSize ?? -1
            if size > noteFileMaxBytes {
                oversize = true
                continue
            }
            next.append(
                TaskStagedFile(
                    url: url,
                    name: url.lastPathComponent,
                    size: size,
                    contentType: values?.contentType?.preferredMIMEType
                        ?? "application/octet-stream"
                )
            )
        }
        error = {
            if urls.count > room {
                return AppStrings.translate(
                    appLocale,
                    "contactsTasks.noteFilesCap",
                    ["count": String(noteFilesMax)]
                )
            }
            if oversize {
                return AppStrings.translate(appLocale, "contactsTasks.noteFileTooBig")
            }
            return nil
        }()
        staged += next
    }

    private func post() {
        posting = true
        error = nil
        let text = body_.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = staged
        Task {
            do {
                let ownerId: String
                if let conversationId {
                    ownerId = try await mutations.postNote(
                        companyId: companyId,
                        conversationId: conversationId,
                        body: text,
                        taskId: taskId
                    ).id
                } else {
                    ownerId = try await mutations.addComment(
                        companyId: companyId,
                        taskId: taskId,
                        body: text
                    ).id
                }
                var failures = 0
                for file in files {
                    let accessing = file.url.startAccessingSecurityScopedResource()
                    let bytes = try? Data(contentsOf: file.url)
                    if accessing { file.url.stopAccessingSecurityScopedResource() }
                    guard let bytes else {
                        failures += 1
                        continue
                    }
                    do {
                        try await multipart.uploadNoteFile(
                            companyId: companyId,
                            noteId: ownerId,
                            fileName: file.name,
                            contentType: file.contentType,
                            bytes: bytes,
                            ownerType: conversationId == nil ? "task_comment" : "note"
                        )
                    } catch {
                        failures += 1
                    }
                }
                body_ = ""
                staged = []
                error = failures > 0
                    ? AppStrings.translate(
                        appLocale,
                        failures == 1
                            ? "contactsTasks.noteUploadFailedOne"
                            : "contactsTasks.noteUploadFailedMany",
                        ["count": String(failures)]
                      )
                    : nil
                onPosted()
            } catch {
                self.error = error.userMessage
            }
            posting = false
        }
    }
}

// MARK: - Previews

private let previewMe = Me(
    user_id: "u1",
    display_name: "Sam Carpenter",
    memberships: [
        Membership(
            company_id: "co1",
            name: "Carpenter Roofing",
            role: MemberRole.owner,
            subscription_status: SubscriptionStatus.active
        ),
    ],
    email_state: nil,
    company: nil
)

private let previewDetail = TaskDetail(
    id: "t1",
    company_id: "co1",
    message_id: "m1",
    conversation_id: "cv1",
    title: "Send the quote for the deck repair",
    description: "Cedar boards, two tiers. They want it before the long weekend.",
    assigned_user_id: "u1",
    due_at: "2099-07-20T15:00:00Z",
    created_by_user_id: "u2",
    created_at: "2026-07-14T12:00:00Z",
    updated_at: "2026-07-15T09:00:00Z",
    done: false,
    status: "open",
    assignee: TaskProfile(user_id: "u1", display_name: "Sam Carpenter"),
    created_by: TaskProfile(user_id: "u2", display_name: "Alex Mason"),
    source_message: TaskSourceMessage(
        id: "m1",
        body: "Can you send over the quote for the deck?",
        done_at: nil,
        done_by_user_id: nil,
        created_at: "2026-07-14T11:58:00Z",
        direction: "in"
    ),
    attachments: [],
    activity: [
        TaskActivityItem(
            kind: "event",
            id: "a1",
            created_at: "2026-07-14T12:00:00Z",
            type: "task_created",
            payload: nil,
            actor_user_id: "u2",
            actor: TaskProfile(user_id: "u2", display_name: "Alex Mason"),
            body: nil,
            author_user_id: nil,
            author: nil
        ),
        TaskActivityItem(
            kind: "note",
            id: "a2",
            created_at: "2026-07-15T09:00:00Z",
            type: nil,
            payload: nil,
            actor_user_id: nil,
            actor: nil,
            body: "Measured the yard — 14x20. Drafting the quote now.",
            author_user_id: "u1",
            author: TaskProfile(user_id: "u1", display_name: "Sam Carpenter")
        ),
    ],
    viewer_level: "text"
)

#Preview("Task detail — ready") {
    NavigationStack {
        TaskDetailView(
            graph: AppGraph(),
            companyId: "co1",
            me: previewMe,
            taskId: "t1",
            onOpenConversation: { _, _ in }
        )
        .readyBody(previewDetail)
        .navigationTitle("Task")
        .navigationBarTitleDisplayMode(.inline)
    }
}
