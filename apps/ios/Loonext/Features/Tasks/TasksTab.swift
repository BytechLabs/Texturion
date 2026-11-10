import SwiftUI

/// /tasks — segmented Open | Mine | All | Done with the route's exact
/// default-filter semantics, assignee/unassigned/due chips, debounced title
/// search, sequential multi-arm cursor pagination, and a List ⇄ Board toggle.
/// Done toggles ALWAYS write `PATCH /v1/messages/{message_id}` (derived done).
/// A row tap routes `AppRouter.openTaskId` up to the shell, which pushes
/// `TaskDetailView` ABOVE the tab shell (#186 — no pill on the detail).
@MainActor
struct TasksTab: View {
    let graph: AppGraph
    let companyId: String
    let me: Me

    @State private var tab: TasksTabKind = .open
    @State private var view: TaskViewKind = .list
    @State private var assigneeChip: String?
    @State private var unassignedChip = false
    @State private var dueChip: DueChip?
    @State private var search = ""
    @State private var debouncedQ = ""
    @State private var refreshKey = 0
    @State private var members: [Member] = []
    @State private var newTaskOpen = false
    // #693: priority and label filters, and the sort.
    @State private var priorityFilter: [String] = []
    @State private var tagFilter: String?
    @State private var sortChoice: String?
    @State private var workspaceTags: [Tag] = []
    // #690: the rest of what the one Filters control holds.
    @State private var contactFilter: String?
    @State private var contactFilterName: String?
    @State private var createdByFilter: String?
    @State private var sourceFilter: String?
    @State private var hasAttachmentsFilter = false
    @State private var hasReferencesFilter = false
    @State private var dueAfterFilter: String?
    @State private var dueBeforeFilter: String?
    @State private var statusOnlyFilter: String?
    // #689 G: how the list is laid out, and the saved views.
    @State private var groupChoice = TaskGroup.status
    @State private var filtersOpen = false
    @State private var quickAddOpen = false
    @State private var fullFormAfterQuickAdd = false
    @State private var viewsController: TaskViewsController?
    @State private var saveViewOpen = false
    @State private var manageViewsOpen = false
    @State private var renamingView: SavedView?
    @State private var appliedDefaultView = false

    @State private var state: LoadState<Void> = .loading
    @State private var rows: [TaskItem] = []
    @State private var hasMore = false
    @State private var loadingMore = false
    @State private var loader: TaskListLoader?
    @State private var toggleError: String?

    // #478 multi-select. Named `bulkSelection` for the same reason the inbox
    // does: `selection` on a SwiftUI list means the navigation selection, and
    // two things called selection on one screen is a bug waiting for whoever
    // reads it next.
    @State private var bulkSelection: BulkSelection = .empty
    @State private var bulkRunning = false
    @State private var bulkAssignOpen = false

    @Environment(\.appLocale) private var appLocale

    /// Deleting a task is the `records.delete` capability (admins and owners);
    /// a member never sees the bulk Delete item.
    private var canDeleteTasks: Bool {
        let role = me.memberships.first { $0.company_id == companyId }?.role
        return RecordDeletion.canDelete(role: role)
    }

    /// #693: what the Priority, Label and Sort chips add to every view's query.
    private var metaFilters: TaskMetaFilters {
        TaskMetaFilters(
            priority: priorityFilter,
            tagId: tagFilter,
            sort: sortChoice,
            contactId: contactFilter,
            createdBy: createdByFilter,
            source: sourceFilter,
            hasAttachments: hasAttachmentsFilter,
            hasReferences: hasReferencesFilter,
            dueAfter: dueAfterFilter,
            dueBefore: dueBeforeFilter,
            statusOnly: statusOnlyFilter
        )
    }

    /// Everything the controls hold, as one value a saved view can describe.
    private var currentState: TaskViewState {
        TaskViewState(
            tab: tab,
            assigneeUserId: assigneeChip,
            unassigned: unassignedChip,
            due: dueChip,
            meta: metaFilters,
            group: groupChoice
        )
    }

    /// Put a state (from the Filters sheet or a saved view) on the controls.
    private func applyState(_ state: TaskViewState, contactName: String? = nil) {
        tab = state.tab
        assigneeChip = state.assigneeUserId
        unassignedChip = state.unassigned
        dueChip = state.due
        priorityFilter = state.meta.priority
        tagFilter = state.meta.tagId
        sortChoice = state.meta.sort
        if state.meta.contactId != contactFilter { contactFilterName = contactName }
        contactFilter = state.meta.contactId
        createdByFilter = state.meta.createdBy
        sourceFilter = state.meta.source
        hasAttachmentsFilter = state.meta.hasAttachments
        hasReferencesFilter = state.meta.hasReferences
        dueAfterFilter = state.meta.dueAfter
        dueBeforeFilter = state.meta.dueBefore
        statusOnlyFilter = state.meta.statusOnly
        groupChoice = state.group
    }

    private func applyView(_ view: SavedView) {
        applyState(taskViewState(view.filters, meUserId: me.user_id))
    }

    private var filtersActive: Bool {
        assigneeChip != nil || unassignedChip || dueChip != nil || !debouncedQ.isEmpty
            || metaFilters.hasFilter
    }

    private var reloadToken: String {
        [
            companyId, tab.rawValue, assigneeChip ?? "", unassignedChip ? "u" : "",
            dueChip?.rawValue ?? "", debouncedQ, String(refreshKey), view.rawValue,
            metaFilters.token,
        ].joined(separator: "|")
    }

    /// Which status tabs actually DO something per view (the web's tabsForView):
    /// Board's columns ARE the status dimension, so it keeps Mine | All; the
    /// Map consumes only the assignee chips, so status tabs disappear there;
    /// List and Calendar consume all four (Calendar applies Open/Done
    /// client-side over the month grid).
    private var visibleTabs: [TasksTabKind] {
        switch view {
        case .board: return [.mine, .all]
        case .map: return []
        case .list, .calendar: return TasksTabKind.allCases
        }
    }

    var body: some View {
        // #186: a flat surface — a row tap routes UP to the shell's root stack
        // (`AppRouter.openTaskId`), so the task detail renders ABOVE the tab
        // shell with no pill (it used to push inside this tab, under the pill).
        VStack(spacing: 0) {
            headerRow
            tabPills
            searchField
            controlsRow
            switch view {
            case .list:
                listContent
            case .board:
                TaskBoardView(
                    graph: graph,
                    companyId: companyId,
                    tab: tab,
                    assigneeChip: assigneeChip,
                    unassignedChip: unassignedChip,
                    dueChip: dueChip,
                    q: debouncedQ,
                    meta: metaFilters,
                    refreshKey: refreshKey,
                    onOpenTask: { AppRouter.shared.openTaskId = $0 },
                    onToggleDone: { task, done in toggleDone(task, done: done) }
                )
            case .calendar:
                TaskCalendarView(
                    graph: graph,
                    companyId: companyId,
                    me: me,
                    members: members,
                    tab: tab,
                    assigneeChip: assigneeChip,
                    unassignedChip: unassignedChip,
                    dueChip: dueChip,
                    q: debouncedQ,
                    meta: metaFilters,
                    refreshKey: refreshKey,
                    onOpenTask: { AppRouter.shared.openTaskId = $0 },
                    onToggleDone: { task, done in toggleDone(task, done: done) }
                )
            case .map:
                TaskMapView(
                    graph: graph,
                    companyId: companyId,
                    assigneeChip: assigneeChip,
                    unassignedChip: unassignedChip,
                    dueChip: dueChip,
                    q: debouncedQ,
                    meta: metaFilters,
                    refreshKey: refreshKey,
                    onOpenTask: { AppRouter.shared.openTaskId = $0 }
                )
            }
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        .task(id: search) {
            // Debounce typing; an empty query applies immediately.
            if !search.isEmpty {
                try? await Task.sleep(for: .milliseconds(250))
                if Task.isCancelled { return }
            }
            debouncedQ = String(
                search.trimmingCharacters(in: .whitespacesAndNewlines).prefix(taskSearchMax)
            )
        }
        .task(id: reloadToken) {
            // Board, Calendar, and Map each self-fetch; only the List arm
            // reloads through this tab's own loader.
            if view == .list { await reload() }
        }
        .task(id: companyId) {
            // Active members back the assignee chip label and the picker. A
            // quiet fetch — a failure leaves the generic chip label.
            if let page = try? await graph.tasksApi.members(companyId: companyId) {
                members = page.data
            }
        }
        .task(id: companyId) {
            // #693: the workspace tags back the Label filter and the bulk label
            // actions. A quiet fetch; without them the filter just stays hidden.
            if let page = try? await graph.tasksApi.tags(companyId: companyId) {
                workspaceTags = page.data
            }
        }
        .task(id: companyId) {
            // #689 G: the saved views for tasks. The member lands on their
            // default view only from an untouched screen: somebody who has
            // already filtered has said what they want to see.
            let controller = TaskViewsController(api: graph.savedViewsApi, companyId: companyId)
            viewsController = controller
            await controller.load()
            if !appliedDefaultView, !filtersActive, tab == .open,
               let id = controller.defaultViewId,
               let view = controller.views.first(where: { $0.id == id }) {
                appliedDefaultView = true
                applyView(view)
            }
        }
        .task(id: companyId) {
            // Realtime: any task create/assign/due/delete (task.changed) or
            // done flip (message.status) refreshes the current view quietly.
            for await event in await graph.realtime.events()
                where event.event == "task.changed" || event.event == "message.status" {
                refreshKey += 1
            }
        }
        .task(id: companyId) {
            for await _ in await graph.realtime.reconnected() {
                refreshKey += 1
            }
        }
        // #215 Part A: refresh the current view on foreground so a task
        // create/assign/done missed while backgrounded lands on return.
        .resyncOnForeground { refreshKey += 1 }
        .onChange(of: view) { _, newView in
            // Board organizes by status, so the Open/Done dimension is a
            // no-op there (#113): entering the board coerces to Mine. Calendar
            // and Map deliberately do NOT coerce — the tab the list returns to
            // is preserved.
            if newView == .board && (tab == .open || tab == .done) {
                tab = .mine
            }
        }
        .sheet(isPresented: $bulkAssignOpen) {
            TaskAssigneesSheet(
                members: members,
                meUserId: me.user_id,
                initial: [],
                titleKey: "contactsTasks.assigneesBulkTitle",
                noteKey: "contactsTasks.assigneesBulkNote",
                allowEmpty: false
            ) { userIds in
                runBulk(
                    action: "assign",
                    verbOneKey: "contactsTasks.bulkAssignedOne",
                    verbManyKey: "contactsTasks.bulkAssignedMany",
                    assigneeIds: userIds
                )
            }
        }
        .newTaskSheet(
            isPresented: $newTaskOpen,
            graph: graph,
            companyId: companyId,
            onCreated: { refreshKey += 1 }
        )
        .alert(
            AppStrings.translate(appLocale, "contactsTasks.taskUpdateFailed"),
            isPresented: Binding(
                get: { toggleError != nil },
                set: { if !$0 { toggleError = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(toggleError ?? "")
        }
    }

    /// Big display heading + the paper-circle view switcher (spec 24). Four
    /// views now (#184/#186): List, Board, Calendar, Map — icon-only pills with
    /// spoken labels, ink-filled when selected.
    private var headerRow: some View {
        HStack(alignment: .center, spacing: 8) {
            ScreenTitle(text: AppStrings.translate(appLocale, "contactsTasks.tasksTitle"))
            Spacer(minLength: 8)
            Button {
                Haptics.tap()
                quickAddOpen = true
            } label: {
                Image(systemName: "plus")
                    .font(.scaled(15, weight: .medium))
                    .foregroundStyle(BrandColor.paper)
                    .frame(width: 38, height: 38)
                    .background(BrandColor.ink, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(AppStrings.translate(appLocale, "thread.newTask"))
            HStack(spacing: 6) {
                viewToggle(kind: .list, icon: "list.bullet", labelKey: "contactsTasks.viewList")
                viewToggle(
                    kind: .board,
                    icon: "square.grid.2x2",
                    labelKey: "contactsTasks.viewBoard"
                )
                viewToggle(
                    kind: .calendar,
                    icon: "calendar",
                    labelKey: "contactsTasks.viewCalendar"
                )
                viewToggle(kind: .map, icon: "map", labelKey: "contactsTasks.viewMap")
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .sheet(
            isPresented: $quickAddOpen,
            onDismiss: {
                if fullFormAfterQuickAdd {
                    fullFormAfterQuickAdd = false
                    newTaskOpen = true
                }
            }
        ) {
            QuickAddSheet(
                graph: graph,
                companyId: companyId,
                me: me,
                members: members,
                tags: workspaceTags,
                onCreated: { refreshKey += 1 },
                onFullForm: {
                    fullFormAfterQuickAdd = true
                    quickAddOpen = false
                },
                onClose: { quickAddOpen = false }
            )
        }
    }

    private func viewToggle(
        kind: TaskViewKind,
        icon: String,
        labelKey: String
    ) -> some View {
        let selected = view == kind
        return Button {
            if view != kind { view = kind }
        } label: {
            Image(systemName: icon)
                .font(.scaled(15, weight: .medium))
                .foregroundStyle(selected ? BrandColor.paper : BrandColor.muted700)
                .frame(width: 38, height: 38)
                .background(selected ? BrandColor.ink : BrandColor.paper, in: Circle())
                .shadow(color: Color.black.opacity(0.06), radius: 2, y: 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(AppStrings.translate(appLocale, labelKey))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    /// The segmented pill track — ink-filled selected pill, paper idle pills
    /// (spec 24/31). Board mode keeps the existing Mine/All reduction.
    private var tabPills: some View {
        HStack(spacing: 6) {
            ForEach(visibleTabs) { item in
                let selected = tab == item
                Button {
                    tab = item
                    statusOnlyFilter = nil
                } label: {
                    Text(AppStrings.translate(appLocale, item.labelKey))
                        .font(.golos(12, weight: selected ? .semibold : .medium))
                        .foregroundStyle(selected ? BrandColor.paper : BrandColor.muted700)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 10)
                        .background(selected ? BrandColor.ink : BrandColor.paper, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.top, 14)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.scaled(14, weight: .medium))
                .foregroundStyle(BrandColor.muted400)
            TextField(
                AppStrings.translate(appLocale, "contactsTasks.searchTaskTitles"),
                text: $search
            )
                .font(.golos(13))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onChange(of: search) { _, next in
                    if next.count > taskSearchMax {
                        search = String(next.prefix(taskSearchMax))
                    }
                }
            if !search.isEmpty {
                Button {
                    search = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(BrandColor.muted300)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(
                    AppStrings.translate(appLocale, "contactsTasks.clearSearch")
                )
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 10)
        .background(BrandColor.paper, in: Capsule())
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
    }

    // MARK: #689 G / #690 one Filters control, Sort, and saved views

    private var canShareViews: Bool {
        MemberRole.has(
            me.memberships.first { $0.company_id == companyId }?.role,
            Capability.settingsManage
        )
    }

    private func menuChipLabel(_ label: String, selected: Bool) -> some View {
        Text(label)
            .font(.golos(11, weight: selected ? .semibold : .medium))
            .foregroundStyle(selected ? BrandColor.muted900 : BrandColor.muted500)
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(
                selected
                    ? AnyShapeStyle(BrandColor.avatarTint)
                    : AnyShapeStyle(BrandColor.paper),
                in: Capsule()
            )
            .frame(minHeight: 44)
            .contentShape(Rectangle())
    }

    private var filtersLabel: String {
        let count = taskFilterCount(currentState)
        let word = AppStrings.translate(appLocale, "taskRefs.filtersTitle")
        return count == 0 ? word : "\(word) \u{00B7} \(count)"
    }

    /// One quiet row: Filters, Sort, Views. Every filter is behind Filters.
    private var controlsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button {
                    filtersOpen = true
                } label: {
                    menuChipLabel(filtersLabel, selected: taskFilterCount(currentState) > 0)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    AppStrings.translate(
                        appLocale,
                        "taskRefs.filtersSpoken",
                        ["count": String(taskFilterCount(currentState))]
                    )
                )
                sortMenuChip
                viewsMenuChip
            }
            .padding(.horizontal, 18)
        }
        .padding(.bottom, 6)
        .sheet(isPresented: $filtersOpen) {
            TaskFiltersSheet(
                initial: currentState,
                contactName: contactFilterName,
                members: members,
                meUserId: me.user_id,
                tags: workspaceTags,
                contactSearch: contactSearchClosure(),
                onApply: { state, contactName in
                    applyState(state, contactName: contactName)
                },
                onClose: { filtersOpen = false }
            )
        }
        .sheet(isPresented: $saveViewOpen) { saveViewSheet }
        .sheet(isPresented: $manageViewsOpen) { manageViewsSheet }
        .sheet(item: $renamingView) { view in renameViewSheet(view) }
    }

    private func contactSearchClosure() -> @MainActor (String) async -> [ReferencePick] {
        let api = graph.contactsApi
        let company = companyId
        return { query in
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            let page = try? await api.contacts(
                companyId: company,
                q: trimmed.isEmpty ? nil : trimmed,
                limit: 10
            )
            return (page?.data ?? []).map { contact in
                let name = (contact.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                return ReferencePick(
                    id: "contact:" + contact.id,
                    kind: .contact,
                    targetId: contact.id,
                    insertText: "",
                    title: name.isEmpty ? contact.phone_e164 : name,
                    subtitle: name.isEmpty ? nil : contact.phone_e164
                )
            }
        }
    }

    private var sortChipText: String {
        guard let sort = sortChoice else {
            return AppStrings.translate(appLocale, "contactsTasks.sortTitle")
        }
        return AppStrings.translate(
            appLocale,
            "contactsTasks.sortedBy",
            ["sort": AppStrings.translate(appLocale, TaskSortChoice.labelKey(sort))]
        )
    }

    private var sortMenuChip: some View {
        Menu {
            ForEach(TaskSortChoice.all, id: \.self) { sort in
                let on = (sortChoice ?? TaskSortChoice.created) == sort
                Button {
                    sortChoice = sort == TaskSortChoice.created ? nil : sort
                } label: {
                    if on {
                        Label(
                            AppStrings.translate(appLocale, TaskSortChoice.labelKey(sort)),
                            systemImage: "checkmark"
                        )
                    } else {
                        Text(AppStrings.translate(appLocale, TaskSortChoice.labelKey(sort)))
                    }
                }
            }
        } label: {
            menuChipLabel(sortChipText, selected: sortChoice != nil)
        }
    }

    /// The saved views as one compact switcher rather than a second row of pills.
    private var viewsMenuChip: some View {
        let views = viewsController?.views ?? []
        let active = views.first(where: { view in
            taskViewMatches(view.filters, currentState, meUserId: me.user_id)
        })
        return Menu {
            ForEach(views, id: \.id) { view in
                Button {
                    applyView(view)
                } label: {
                    if view.id == active?.id {
                        Label(view.name, systemImage: "checkmark")
                    } else {
                        Text(view.name)
                    }
                }
            }
            Button(AppStrings.translate(appLocale, "inbox.viewsSave")) {
                saveViewOpen = true
            }
            if !views.isEmpty {
                Button(AppStrings.translate(appLocale, "taskRefs.viewsManage")) {
                    manageViewsOpen = true
                }
            }
        } label: {
            menuChipLabel(
                active?.name ?? AppStrings.translate(appLocale, "taskRefs.viewsTitle"),
                selected: active != nil
            )
        }
    }

    @ViewBuilder
    private var saveViewSheet: some View {
        if let controller = viewsController {
            let state = currentState
            TaskViewNameSheet(
                titleKey: "inbox.viewsSave",
                initialName: suggestTaskViewName(
                    state,
                    locale: appLocale,
                    tagName: workspaceTags.first(where: { $0.id == state.meta.tagId })?.name
                ),
                note: taskViewDropsDueChip(state)
                    ? AppStrings.translate(appLocale, "taskRefs.viewDropsDueChip")
                    : nil,
                canShare: canShareViews,
                onSubmit: { name, shared in
                    await controller.save(
                        name: name,
                        filters: taskViewFilters(state, meUserId: me.user_id),
                        shared: shared
                    )
                },
                onClose: { saveViewOpen = false }
            )
        }
    }

    @ViewBuilder
    private var manageViewsSheet: some View {
        if let controller = viewsController {
            TaskViewsManageSheet(
                controller: controller,
                canManageShared: canShareViews,
                onOpen: { view in
                    manageViewsOpen = false
                    applyView(view)
                },
                onRename: { view in
                    manageViewsOpen = false
                    renamingView = view
                },
                onClose: { manageViewsOpen = false }
            )
        }
    }

    @ViewBuilder
    private func renameViewSheet(_ view: SavedView) -> some View {
        if let controller = viewsController {
            TaskViewNameSheet(
                titleKey: "inbox.viewRenameTitle",
                initialName: view.name,
                note: nil,
                canShare: false,
                onSubmit: { name, _ in await controller.rename(id: view.id, name: name) },
                onClose: { renamingView = nil }
            )
        }
    }

    @ViewBuilder
    private var listContent: some View {
        switch state {
        case .loading:
            CenteredLoading()
        case .failed(let message):
            CenteredError(message: message) { refreshKey += 1 }
        case .ready:
            if rows.isEmpty {
                Text(
                    AppStrings.translate(
                        appLocale,
                        filtersActive || tab != .open
                            ? "contactsTasks.listEmptyFiltered"
                            : "contactsTasks.listEmpty"
                    )
                )
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted500)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                if !bulkSelection.isEmpty {
                    taskBulkBar
                }
                ScrollView {
                    VStack(spacing: 14) {
                        taskCards
                        if hasMore {
                            Button(
                                AppStrings.translate(
                                    appLocale,
                                    loadingMore
                                        ? "contactsTasks.loading"
                                        : "contactsTasks.loadMore"
                                )
                            ) {
                                loadMore()
                            }
                            .disabled(loadingMore)
                            .buttonStyle(.plain)
                            .font(.golos(12, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                        }
                        HStack(spacing: 7) {
                            Circle()
                                .fill(BrandColor.lime)
                                .frame(width: 6, height: 6)
                            Text(
                                AppStrings.translate(
                                    appLocale, "contactsTasks.everyTaskLinksBack"
                                )
                            )
                                .font(.golos(11))
                                .foregroundStyle(BrandColor.muted700)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(BrandColor.insetDeep, in: Capsule())
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 8)
                    .padding(.bottom, 24)
                }
                // Pull to refresh, matching Android and the inbox. Awaiting the
                // real reload means the spinner settles when the data actually
                // lands rather than the instant the gesture ends. Only the list
                // arm gets it: on the map a downward pan would become a refresh.
                .refreshable { await reload() }
            }
        }
    }

    /// The loaded rows: one card, or (#689 G) one card per group when the list is
    /// grouped by assignee or priority.
    @ViewBuilder
    private var taskCards: some View {
        if groupChoice == TaskGroup.status {
            PaperCard { taskRows(rows) }
        } else {
            let sections = groupTasks(
                rows,
                by: groupChoice,
                nameOf: { (id: String) -> String? in
                    if id == me.user_id { return me.display_name }
                    return members.first(where: { $0.user_id == id })?.display_name
                }
            )
            ForEach(sections) { section in
                VStack(alignment: .leading, spacing: 6) {
                    Text(sectionTitle(section))
                        .font(.golos(11, weight: .semibold))
                        .foregroundStyle(BrandColor.muted600)
                        .padding(.leading, 6)
                    PaperCard { taskRows(section.tasks) }
                }
            }
        }
    }

    private func sectionTitle(_ section: TaskSection) -> String {
        if let key = section.titleKey { return AppStrings.translate(appLocale, key) }
        return section.title
    }

    @ViewBuilder
    private func taskRows(_ list: [TaskItem]) -> some View {
        ForEach(list, id: \.id) { task in
            let picked = bulkSelection.isRowSelected(task.id)
            TaskListRow(task: task, faces: assigneeFaces(task)) { done in
                toggleDone(task, done: done)
            }
            .contentShape(Rectangle())
            .onTapGesture {
                // #478: while a selection is live a tap EXTENDS it. Opening a
                // task mid-selection would throw the selection away and land
                // somewhere nobody asked for, the rule the inbox already follows.
                if bulkSelection.isEmpty {
                    AppRouter.shared.openTaskId = task.id
                } else {
                    bulkSelection = bulkSelection.toggling(
                        task.id,
                        loadedIds: rows.map(\.id)
                    )
                }
            }
            // #478: long-press starts selection mode.
            .onLongPressGesture {
                bulkSelection = bulkSelection.toggling(
                    task.id,
                    loadedIds: rows.map(\.id)
                )
            }
            // A tint, not a checkbox column. The row already carries the done
            // circle, and on a phone a second column of controls costs a row's
            // worth of width for what long-press already says.
            .background(picked ? BrandColor.olive.opacity(0.12) : .clear)
            if task.id != list.last?.id {
                RowDivider()
            }
        }
    }

    /// The row's crew (#689 C): names come from the payload's own `assignees`,
    /// else the members roster the picker already fetches. Empty when nobody is
    /// assigned; a blank name draws no initials.
    private func assigneeFaces(_ task: TaskItem) -> [AssigneeFace] {
        task.assigneeFaces(roster: { id in
            if id == me.user_id { return me.display_name }
            return members.first { $0.user_id == id }?.display_name
        })
    }

    /// Any filter change (including the ordering-flipping due chips) rebuilds
    /// the loader from scratch — a cursor never crosses filter sets/orderings.
    /// Quiet refreshes preserve the pagination depth already on screen.
    private func reload() async {
        if rows.isEmpty { state = .loading }
        let arms = taskListArms(
            tab: tab,
            assigneeUserId: assigneeChip,
            unassigned: unassignedChip,
            due: dueChip,
            q: debouncedQ.isEmpty ? nil : debouncedQ,
            meta: metaFilters
        )
        let api = graph.tasksApi
        let company = companyId
        let newLoader = TaskListLoader(arms: arms) { filters, cursor, limit in
            try await api.list(companyId: company, filters: filters, cursor: cursor, limit: limit)
        }
        let target = rows.count // preserve pagination depth on quiet refreshes
        var accumulated: [TaskItem] = []
        do {
            var pages = 0
            repeat {
                accumulated += try await newLoader.nextPage()
                pages += 1
            } while newLoader.hasMore && accumulated.count < max(target, 1) && pages < 40
            rows = accumulated
            hasMore = newLoader.hasMore
            loader = newLoader
            state = .ready(())
        } catch {
            if rows.isEmpty { state = .failed(error.userMessage) }
        }
    }

    private func loadMore() {
        guard let loader, !loadingMore else { return }
        loadingMore = true
        Task {
            do {
                rows += try await loader.nextPage()
                hasMore = loader.hasMore
            } catch {
                // Leave the button; the user retries.
            }
            loadingMore = false
        }
    }

    private func toggleDone(_ task: TaskItem, done: Bool) {
        // One semantic haptic per done flip, shared by list rows and board
        // moves — marking done COMMITS, unmarking is a light touch. Fired
        // before the write, because the row animates optimistically and a
        // haptic that waited for the server would arrive after the checkmark.
        if done { Haptics.confirm() } else { Haptics.tap() }
        Task {
            // Derived-done invariant: a message task writes its SOURCE MESSAGE;
            // a call task (D64) has none and writes the task.
            do {
                try await graph.tasksApi.setTaskDone(
                    companyId: companyId,
                    taskId: task.id,
                    messageId: task.message_id,
                    done: done
                )
            } catch {
                toggleError = error.userMessage
            }
            refreshKey += 1
        }
    }
}

/// The four task views (#184/#186), the iOS sibling of the web's TaskView
/// union and the Android TaskViewKind. Persisted by rawValue through the same
/// state pattern the old List/Board toggle used; List is the default landing
/// view.
enum TaskViewKind: String, CaseIterable, Identifiable, Sendable {
    case list
    case board
    case calendar
    case map

    var id: String { rawValue }
}

private struct TaskListRow: View {
    let task: TaskItem
    let faces: [AssigneeFace]
    let onToggleDone: @MainActor (Bool) -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // The round derived-done toggle: 22pt ring → lime fill + ink check
            // (spec 24/31).
            Button {
                onToggleDone(!task.done)
            } label: {
                ZStack {
                    if task.done {
                        Circle().fill(BrandColor.lime)
                        Image(systemName: "checkmark")
                            .font(.scaled(11, weight: .bold))
                            .foregroundStyle(BrandColor.onLime)
                    } else {
                        Circle().strokeBorder(BrandColor.muted250, lineWidth: 1.8)
                    }
                }
                .frame(width: 22, height: 22)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(
                AppStrings.translate(
                    appLocale,
                    task.done ? "contactsTasks.markNotDone" : "contactsTasks.markDone"
                )
            )

            VStack(alignment: .leading, spacing: 3) {
                TaskNumberTag(number: task.number)
                Text(task.title)
                    .font(.golos(13.5, weight: .semibold))
                    .lineLimit(1)
                    .strikethrough(task.done)
                    .foregroundStyle(
                        task.done
                            ? AnyShapeStyle(BrandColor.muted400)
                            : AnyShapeStyle(BrandColor.ink)
                    )
                // D64: a call task names the call where a message task names nothing.
                if let call = task.call {
                    Text(
                        AppStrings.translate(
                            appLocale,
                            "contactsTasks.callFrom",
                            ["name": taskCallerName(call, locale: appLocale)]
                        )
                    )
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
                    .lineLimit(1)
                }
                if task.due_at != nil {
                    let overdue = isOverdue(task)
                    Text(
                        AppStrings.translate(
                            appLocale,
                            overdue
                                ? "contactsTasks.overdueDueWhen"
                                : "contactsTasks.dueWhen",
                            ["when": formatDue(task.due_at)]
                        )
                    )
                    .font(.golos(11.5, weight: overdue ? .semibold : .regular))
                    // Overdue = amber, never red.
                    .foregroundStyle(
                        overdue
                            ? AnyShapeStyle(BrandColor.overdueAmber)
                            : AnyShapeStyle(BrandColor.muted400)
                    )
                }
                // #693: priority, repeat and labels, only when there is any.
                TaskRowBadges(task: task)
            }
            Spacer(minLength: 0)
            AssigneeStack(faces: faces, size: 28)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 13)
    }
}

// MARK: - Previews

private func previewTask(
    id: String,
    title: String,
    done: Bool,
    dueAt: String? = nil
) -> TaskItem {
    TaskItem(
        id: id,
        company_id: "co1",
        message_id: "m-\(id)",
        conversation_id: "cv1",
        title: title,
        description: "",
        assigned_user_id: "u1",
        due_at: dueAt,
        created_by_user_id: "u1",
        created_at: "2026-07-14T12:00:00Z",
        updated_at: "2026-07-14T12:00:00Z",
        done: done,
        status: done ? "done" : "open",
        contact: nil,
        attachment_count: nil
    )
}

#Preview("Tasks tab") {
    TasksTab(
        graph: AppGraph(),
        companyId: "preview-co",
        me: Me(
            user_id: "u1",
            display_name: "Sam Carpenter",
            memberships: [
                Membership(
                    company_id: "preview-co",
                    name: "Carpenter Roofing",
                    role: MemberRole.owner,
                    subscription_status: SubscriptionStatus.active
                ),
            ],
            email_state: nil,
            company: nil
        )
    )
}

#Preview("Task rows") {
    VStack(spacing: 14) {
        PaperCard {
            TaskListRow(
                task: previewTask(
                    id: "t1",
                    title: "Send the quote for the deck repair",
                    done: false,
                    dueAt: "2099-07-20T15:00:00Z"
                ),
                faces: [
                    AssigneeFace(id: "u1", name: "Sam Carpenter"),
                    AssigneeFace(id: "u2", name: "Alex Mason"),
                    AssigneeFace(id: "u3", name: "Jo Rivera"),
                    AssigneeFace(id: "u4", name: "Pat Lee"),
                ],
                onToggleDone: { _ in }
            )
            RowDivider()
            TaskListRow(
                task: previewTask(
                    id: "t2",
                    title: "Order shingles for the Hendersons",
                    done: false,
                    dueAt: "2020-07-01T15:00:00Z" // past due → the amber Overdue line
                ),
                faces: [],
                onToggleDone: { _ in }
            )
            RowDivider()
            TaskListRow(
                task: previewTask(id: "t3", title: "Invoice the Hendersons", done: true),
                faces: [AssigneeFace(id: "u2", name: "Alex Mason")],
                onToggleDone: { _ in }
            )
        }
    }
    .padding(18)
    .background(BrandColor.canvas)
}

// MARK: - #478 bulk actions

extension TasksTab {
    /// The selection bar over the task list.
    ///
    /// Every rule is #275's, reused rather than restated: the selection type,
    /// the escalation ladder, the label and the result sentence all come from
    /// BulkSelection.swift. What differs is only which actions a task can take.
    ///
    /// NEVER SHOWS A NUMBER IT WAS NOT TOLD. `label` says "all matching" rather
    /// than a count when the selection is filter-wide, because this client does
    /// not know how many rows the server will find.
    @ViewBuilder
    var taskBulkBar: some View {
        HStack(spacing: 12) {
            Button {
                bulkSelection = .empty
            } label: {
                Image(systemName: "xmark")
                    .font(.scaled(13, weight: .semibold))
            }
            .buttonStyle(.plain)
            .disabled(bulkRunning)
            .accessibilityLabel(
                AppStrings.translate(appLocale, "contactsTasks.clearSelection")
            )

            Text(bulkSelection.labelText(appLocale))
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.ink)

            Spacer()

            if bulkRunning { ProgressView() }

            Button(AppStrings.translate(appLocale, "contactsTasks.columnDone")) {
                runBulk(
                    action: "mark_done",
                    verbOneKey: "contactsTasks.bulkMarkedDoneOne",
                    verbManyKey: "contactsTasks.bulkMarkedDoneMany"
                )
            }
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.olive)
                .buttonStyle(.plain)
                .disabled(bulkRunning)

            Menu {
                // #689 C: pick people, then Apply; they are ADDED to every
                // selected task (nobody is removed). Unassign clears everyone.
                Button(AppStrings.translate(appLocale, "contactsTasks.addPeople")) {
                    bulkAssignOpen = true
                }
                Button(AppStrings.translate(appLocale, "contactsTasks.unassign")) {
                    runBulk(
                        action: "assign",
                        verbOneKey: "contactsTasks.bulkUnassignedOne",
                        verbManyKey: "contactsTasks.bulkUnassignedMany",
                        unassign: true
                    )
                }
                Button(AppStrings.translate(appLocale, "contactsTasks.markNotDone")) {
                    runBulk(
                        action: "mark_undone",
                        verbOneKey: "contactsTasks.bulkMarkedNotDoneOne",
                        verbManyKey: "contactsTasks.bulkMarkedNotDoneMany"
                    )
                }
                bulkPriorityMenu
                if !workspaceTags.isEmpty {
                    bulkLabelMenu
                }
                // Destructive and last: an action adjacent to the ones people
                // use by momentum is one somebody hits by momentum.
                if canDeleteTasks {
                    Button(AppStrings.translate(appLocale, "common.delete"), role: .destructive) {
                        runBulk(
                            action: "delete",
                            verbOneKey: "contactsTasks.bulkDeletedOne",
                            verbManyKey: "contactsTasks.bulkDeletedMany"
                        )
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.scaled(13, weight: .semibold))
            }
            .disabled(bulkRunning)
            .accessibilityLabel(
                AppStrings.translate(appLocale, "contactsTasks.moreBulkActions")
            )
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(BrandColor.inset)

        // The escalation ladder: the page first, then the filter. Never one
        // "select all" that quietly means whichever of the two it feels like.
        if case let .ids(ids) = bulkSelection,
           !rows.isEmpty,
           !rows.allSatisfy({ ids.contains($0.id) }) {
            Button(
                AppStrings.translate(
                    appLocale,
                    "contactsTasks.selectThese",
                    ["count": String(rows.count)]
                )
            ) {
                bulkSelection = selectLoaded(rows.map(\.id))
            }
            .font(.golos(12.5, weight: .semibold))
            .foregroundStyle(BrandColor.olive)
            .buttonStyle(.plain)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
        if bulkSelection.canEscalate(loadedIds: rows.map(\.id), hasMore: hasMore) {
            Button(AppStrings.translate(appLocale, "contactsTasks.selectAllMatching")) {
                bulkSelection = .filter
            }
                .font(.golos(12.5, weight: .semibold))
                .foregroundStyle(BrandColor.olive)
                .buttonStyle(.plain)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
        }
    }

    /// #693: set one priority on every selected task.
    @ViewBuilder
    var bulkPriorityMenu: some View {
        Menu(AppStrings.translate(appLocale, "contactsTasks.bulkSetPriority")) {
            ForEach(TaskPriority.rankedForMenus) { priority in
                Button(AppStrings.translate(appLocale, priority.labelKey)) {
                    runBulk(
                        action: "set_priority",
                        verbOneKey: "contactsTasks.bulkPrioritySetOne",
                        verbManyKey: "contactsTasks.bulkPrioritySetMany",
                        priority: priority.rawValue
                    )
                }
            }
        }
    }

    /// Each selected task's label ids; nil for a filter selection, whose rows are not loaded.
    var selectedTaskLabelIds: [[String]]? {
        guard case let .ids(ids) = bulkSelection else { return nil }
        return rows.filter { ids.contains($0.id) }.map { $0.labelList.map(\.id) }
    }

    /// #713: one checklist for adding and removing a workspace label across the selection.
    @ViewBuilder
    var bulkLabelMenu: some View {
        Menu(AppStrings.translate(appLocale, "contactsTasks.bulkLabels")) {
            let selected = selectedTaskLabelIds
            ForEach(workspaceTags, id: \.id) { tag in
                let state = tagSelectionState(itemTagIds: selected, tagId: tag.id)
                let removing = tagToggleAction(state) == "remove"
                Button {
                    runBulk(
                        action: removing ? "remove_label" : "add_label",
                        verbOneKey: removing
                            ? "contactsTasks.bulkLabelRemovedOne"
                            : "contactsTasks.bulkLabelAddedOne",
                        verbManyKey: removing
                            ? "contactsTasks.bulkLabelRemovedMany"
                            : "contactsTasks.bulkLabelAddedMany",
                        tagId: tag.id
                    )
                } label: {
                    Label(
                        tag.name,
                        systemImage: state == .all
                            ? "checkmark"
                            : (state == .absent ? "circle" : "minus")
                    )
                }
            }
        }
    }

    /// Run one action over the current selection, then say what actually
    /// happened — from the SERVER's response, never from the selection. In
    /// filter mode this client does not know how many rows matched, and a count
    /// it guessed would be a count somebody trusted.
    func runBulk(
        action: String,
        verbOneKey: String,
        verbManyKey: String,
        targetUserId: String? = nil,
        unassign: Bool = false,
        priority: String? = nil,
        tagId: String? = nil,
        assigneeIds: [String]? = nil
    ) {
        guard !bulkRunning else { return }
        bulkRunning = true
        Task {
            defer { bulkRunning = false }
            do {
                let ids = bulkSelection.idsOrNil
                let result = try await graph.tasksApi.bulk(
                    companyId: companyId,
                    action: action,
                    ids: ids,
                    // The SAME filters the list fetched with, so "everything I
                    // am looking at" cannot mean something different here.
                    // The first arm carries the user's filters; the second
                    // exists only to union open+done on the statusless tabs and
                    // has no meaning to a bulk route.
                    filters: ids == nil
                        ? taskListArms(
                            tab: tab,
                            assigneeUserId: assigneeChip,
                            unassigned: unassignedChip,
                            due: dueChip,
                            q: debouncedQ.isEmpty ? nil : debouncedQ,
                            meta: metaFilters
                          ).first
                        : nil,
                    targetUserId: targetUserId,
                    unassign: unassign,
                    priority: priority,
                    tagId: tagId,
                    assigneeIds: assigneeIds
                )
                var summary = bulkResultMessage(
                    verb: AppStrings.translate(appLocale, verbOneKey),
                    verbMany: AppStrings.translate(appLocale, verbManyKey),
                    applied: result.applied.count,
                    failed: result.failed.count,
                    matched: result.matched,
                    capped: result.capped,
                    nounOne: AppStrings.translate(appLocale, "contactsTasks.bulkTaskOne"),
                    nounMany: AppStrings.translate(appLocale, "contactsTasks.bulkTaskMany"),
                    locale: appLocale
                )
                // #689 C: a task already at the cap is reported, not silently skipped.
                if result.failed.contains(where: { $0.reason == "too_many_assignees" }) {
                    summary += AppStrings.translate(
                        appLocale,
                        "contactsTasks.bulkTooManyAssignees",
                        ["max": String(taskAssigneeMax)]
                    )
                }
                toggleError = summary
                bulkSelection = .empty
                refreshKey += 1
            } catch {
                toggleError = AppStrings.translate(appLocale, "contactsTasks.bulkFailed")
            }
        }
    }
}
