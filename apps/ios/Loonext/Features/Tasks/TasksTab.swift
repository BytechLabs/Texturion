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
    @State private var pickerOpen = false

    @State private var state: LoadState<Void> = .loading
    @State private var rows: [TaskItem] = []
    @State private var hasMore = false
    @State private var loadingMore = false
    @State private var loader: TaskListLoader?
    @State private var toggleError: String?

    private var filtersActive: Bool {
        assigneeChip != nil || unassignedChip || dueChip != nil || !debouncedQ.isEmpty
    }

    private var reloadToken: String {
        [
            companyId, tab.rawValue, assigneeChip ?? "", unassignedChip ? "u" : "",
            dueChip?.rawValue ?? "", debouncedQ, String(refreshKey), view.rawValue,
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
            filterChips
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
        .sheet(isPresented: $pickerOpen) {
            MemberPickerSheet(
                members: members,
                meUserId: me.user_id,
                selectedUserId: assigneeChip,
                showUnassigned: false
            ) { userId in
                assigneeChip = userId
                if userId != nil { unassignedChip = false }
            }
        }
        .alert(
            "Couldn't update the task",
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
            ScreenTitle(text: "Tasks")
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                viewToggle(kind: .list, icon: "list.bullet", label: "List view")
                viewToggle(kind: .board, icon: "square.grid.2x2", label: "Board view")
                viewToggle(kind: .calendar, icon: "calendar", label: "Calendar view")
                viewToggle(kind: .map, icon: "map", label: "Map view")
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
    }

    private func viewToggle(kind: TaskViewKind, icon: String, label: String) -> some View {
        let selected = view == kind
        return Button {
            if view != kind { view = kind }
        } label: {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(selected ? BrandColor.paper : BrandColor.muted700)
                .frame(width: 38, height: 38)
                .background(selected ? BrandColor.ink : BrandColor.paper, in: Circle())
                .shadow(color: Color.black.opacity(0.06), radius: 2, y: 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
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
                } label: {
                    Text(item.rawValue)
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
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(BrandColor.muted400)
            TextField("Search task titles", text: $search)
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
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 10)
        .background(BrandColor.paper, in: Capsule())
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
    }

    private var assigneeChipLabel: String {
        guard let id = assigneeChip else { return "Assignee" }
        if id == me.user_id { return "You" }
        let name = members.first { $0.user_id == id }?.display_name
        return (name?.isBlank ?? true) ? "Teammate" : (name ?? "Teammate")
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                filterChip(
                    label: assigneeChipLabel,
                    selected: assigneeChip != nil,
                    clearLabel: assigneeChip != nil ? "Clear assignee filter" : nil,
                    onTap: { pickerOpen = true },
                    onClear: { assigneeChip = nil }
                )
                filterChip(
                    label: "Unassigned",
                    selected: unassignedChip,
                    clearLabel: nil,
                    onTap: {
                        unassignedChip.toggle()
                        if unassignedChip { assigneeChip = nil }
                    },
                    onClear: {}
                )
                ForEach(DueChip.allCases) { chip in
                    filterChip(
                        label: chip.rawValue,
                        selected: dueChip == chip,
                        clearLabel: nil,
                        onTap: { dueChip = dueChip == chip ? nil : chip },
                        onClear: {}
                    )
                }
            }
            .padding(.horizontal, 18)
        }
        .padding(.bottom, 6)
    }

    private func filterChip(
        label: String,
        selected: Bool,
        clearLabel: String?,
        onTap: @escaping @MainActor () -> Void,
        onClear: @escaping @MainActor () -> Void
    ) -> some View {
        let foreground = selected
            ? AnyShapeStyle(BrandColor.muted900)
            : AnyShapeStyle(BrandColor.muted500)
        return HStack(spacing: 4) {
            Button(action: onTap) {
                Text(label)
                    .font(.golos(11, weight: selected ? .semibold : .medium))
                    .foregroundStyle(foreground)
            }
            .buttonStyle(.plain)
            if let clearLabel {
                Button(action: onClear) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(foreground)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(clearLabel)
            }
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 6)
        .background(
            selected
                ? AnyShapeStyle(BrandColor.avatarTint)
                : AnyShapeStyle(BrandColor.paper),
            in: Capsule()
        )
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
                    filtersActive || tab != .open
                        ? "Nothing on this list."
                        : "No tasks yet. Promote a message from its ⋯ menu in a conversation."
                )
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted500)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(spacing: 14) {
                        PaperCard {
                            ForEach(rows, id: \.id) { task in
                                TaskListRow(task: task, assigneeName: assigneeName(task)) { done in
                                    toggleDone(task, done: done)
                                }
                                .contentShape(Rectangle())
                                .onTapGesture { AppRouter.shared.openTaskId = task.id }
                                if task.id != rows.last?.id {
                                    RowDivider()
                                }
                            }
                        }
                        if hasMore {
                            Button(loadingMore ? "Loading…" : "Load more") {
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
                            Text("Every task links back to its message")
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
            }
        }
    }

    /// The row's assignee initials come from the members roster the picker
    /// already fetches — nil (no avatar) when unassigned or the name is blank.
    private func assigneeName(_ task: TaskItem) -> String? {
        guard let id = task.assigned_user_id else { return nil }
        if id == me.user_id { return me.display_name }
        let name = members.first { $0.user_id == id }?.display_name
        return (name?.isBlank ?? true) ? nil : name
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
            q: debouncedQ.isEmpty ? nil : debouncedQ
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
        Task {
            // Derived-done invariant: the write path is the SOURCE MESSAGE.
            do {
                _ = try await graph.tasksApi.setDone(
                    companyId: companyId,
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
    let assigneeName: String?
    let onToggleDone: @MainActor (Bool) -> Void

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
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(BrandColor.onLime)
                    } else {
                        Circle().strokeBorder(BrandColor.muted250, lineWidth: 1.8)
                    }
                }
                .frame(width: 22, height: 22)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(task.done ? "Mark not done" : "Mark done")

            VStack(alignment: .leading, spacing: 3) {
                Text(task.title)
                    .font(.golos(13.5, weight: .semibold))
                    .lineLimit(1)
                    .strikethrough(task.done)
                    .foregroundStyle(
                        task.done
                            ? AnyShapeStyle(BrandColor.muted400)
                            : AnyShapeStyle(BrandColor.ink)
                    )
                if task.due_at != nil {
                    let overdue = isOverdue(task)
                    Text(
                        overdue
                            ? "Overdue · due \(formatDue(task.due_at))"
                            : "Due \(formatDue(task.due_at))"
                    )
                    .font(.golos(11.5, weight: overdue ? .semibold : .regular))
                    // Overdue = amber, never red.
                    .foregroundStyle(
                        overdue
                            ? AnyShapeStyle(BrandColor.overdueAmber)
                            : AnyShapeStyle(BrandColor.muted400)
                    )
                }
            }
            Spacer(minLength: 0)
            if let assigneeName {
                InitialsAvatar(name: assigneeName, size: 28)
            }
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
                assigneeName: "Sam Carpenter",
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
                assigneeName: nil,
                onToggleDone: { _ in }
            )
            RowDivider()
            TaskListRow(
                task: previewTask(id: "t3", title: "Invoice the Hendersons", done: true),
                assigneeName: "Alex Mason",
                onToggleDone: { _ in }
            )
        }
    }
    .padding(18)
    .background(BrandColor.canvas)
}
