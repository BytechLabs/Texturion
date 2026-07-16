import SwiftUI

/// /tasks — segmented Open | Mine | All | Done with the route's exact
/// default-filter semantics, assignee/unassigned/due chips, debounced title
/// search, sequential multi-arm cursor pagination, and a List ⇄ Board toggle.
/// Done toggles ALWAYS write `PATCH /v1/messages/{message_id}` (derived done).
/// Row tap pushes `TaskDetailView`.
///
/// `onOpenConversation` deep-links a task's source thread anchored to the
/// promoted message — the shell wires it to the inbox thread screen (#159);
/// until wired the affordance stays hidden.
@MainActor
struct TasksTab: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    var onOpenConversation: ((_ conversationId: String, _ messageId: String) -> Void)? = nil

    private struct TaskRoute: Hashable, Identifiable {
        let id: String
    }

    @State private var tab: TasksTabKind = .open
    @State private var board = false
    @State private var assigneeChip: String?
    @State private var unassignedChip = false
    @State private var dueChip: DueChip?
    @State private var search = ""
    @State private var debouncedQ = ""
    @State private var refreshKey = 0
    @State private var members: [Member] = []
    @State private var pickerOpen = false
    @State private var openTask: TaskRoute?

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
            dueChip?.rawValue ?? "", debouncedQ, String(refreshKey), board ? "b" : "",
        ].joined(separator: "|")
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                headerRow
                searchField
                filterChips
                if board {
                    TaskBoardView(
                        graph: graph,
                        companyId: companyId,
                        tab: tab,
                        assigneeChip: assigneeChip,
                        unassignedChip: unassignedChip,
                        dueChip: dueChip,
                        q: debouncedQ,
                        refreshKey: refreshKey,
                        onOpenTask: { openTask = TaskRoute(id: $0) },
                        onToggleDone: { task, done in toggleDone(task, done: done) }
                    )
                } else {
                    listContent
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(item: $openTask) { route in
                TaskDetailView(
                    graph: graph,
                    companyId: companyId,
                    me: me,
                    taskId: route.id,
                    onOpenConversation: onOpenConversation
                )
            }
        }
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
            if !board { await reload() }
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
        .onChange(of: board) { _, isBoard in
            // Board organizes by status, so the Open/Done dimension is a
            // no-op there (#113): entering the board coerces to Mine.
            if isBoard && (tab == .open || tab == .done) {
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

    private var headerRow: some View {
        HStack(spacing: 8) {
            Picker("Filter", selection: $tab) {
                ForEach(board ? [TasksTabKind.mine, .all] : TasksTabKind.allCases) { item in
                    Text(item.rawValue).tag(item)
                }
            }
            .pickerStyle(.segmented)
            Button {
                board.toggle()
            } label: {
                Image(systemName: board ? "list.bullet" : "square.grid.2x2")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(board ? "List view" : "Board view")
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search task titles", text: $search)
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
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
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
            .padding(.horizontal, 16)
        }
        .padding(.bottom, 4)
    }

    private func filterChip(
        label: String,
        selected: Bool,
        clearLabel: String?,
        onTap: @escaping @MainActor () -> Void,
        onClear: @escaping @MainActor () -> Void
    ) -> some View {
        let foreground = selected
            ? AnyShapeStyle(BrandColor.onPetrolContainer)
            : AnyShapeStyle(Color.primary)
        return HStack(spacing: 4) {
            Button(action: onTap) {
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(foreground)
            }
            .buttonStyle(.plain)
            if let clearLabel {
                Button(action: onClear) {
                    Image(systemName: "xmark")
                        .font(.caption2)
                        .foregroundStyle(foreground)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(clearLabel)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(
            selected
                ? AnyShapeStyle(BrandColor.petrolContainer)
                : AnyShapeStyle(Color(.secondarySystemFill)),
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
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(rows, id: \.id) { task in
                        TaskListRow(task: task) { done in
                            toggleDone(task, done: done)
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { openTask = TaskRoute(id: task.id) }
                    }
                    if hasMore {
                        HStack {
                            Spacer()
                            Button(loadingMore ? "Loading…" : "Load more") {
                                loadMore()
                            }
                            .disabled(loadingMore)
                            .font(.subheadline)
                            Spacer()
                        }
                        .listRowSeparator(.hidden)
                    }
                }
                .listStyle(.plain)
            }
        }
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

private struct TaskListRow: View {
    let task: TaskItem
    let onToggleDone: @MainActor (Bool) -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            // The round derived-done toggle: hollow circle → filled petrol check.
            Button {
                onToggleDone(!task.done)
            } label: {
                Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(
                        task.done
                            ? AnyShapeStyle(BrandColor.petrol)
                            : AnyShapeStyle(Color.secondary)
                    )
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(task.done ? "Mark not done" : "Mark done")

            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(.body)
                    .strikethrough(task.done)
                    .foregroundStyle(task.done ? AnyShapeStyle(Color.secondary) : AnyShapeStyle(Color.primary))
                if task.due_at != nil {
                    let overdue = isOverdue(task)
                    Text(
                        overdue
                            ? "Overdue · due \(formatDue(task.due_at))"
                            : "Due \(formatDue(task.due_at))"
                    )
                    .font(.caption)
                    // Overdue = amber, never red.
                    .foregroundStyle(
                        overdue
                            ? AnyShapeStyle(BrandColor.overdueAmber)
                            : AnyShapeStyle(Color.secondary)
                    )
                }
            }
        }
        .padding(.vertical, 2)
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
    List {
        TaskListRow(
            task: previewTask(
                id: "t1",
                title: "Send the quote for the deck repair",
                done: false,
                dueAt: "2099-07-20T15:00:00Z"
            ),
            onToggleDone: { _ in }
        )
        TaskListRow(
            task: previewTask(
                id: "t2",
                title: "Order shingles for the Hendersons",
                done: false,
                dueAt: "2020-07-01T15:00:00Z" // past due → the amber Overdue line
            ),
            onToggleDone: { _ in }
        )
        TaskListRow(
            task: previewTask(id: "t3", title: "Invoice the Hendersons", done: true),
            onToggleDone: { _ in }
        )
    }
    .listStyle(.plain)
}
