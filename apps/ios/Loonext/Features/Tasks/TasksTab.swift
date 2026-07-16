import SwiftUI

/// /tasks — the thin LIST screen: segmented Open | Mine | All | Done with the
/// route's exact default-filter semantics, due chips, debounced title search,
/// sequential multi-arm cursor pagination, and the derived-done toggle.
/// Done toggles ALWAYS write `PATCH /v1/messages/{message_id}` (derived done).
/// The board view + task detail land with the full tasks pass (#160).
@MainActor
struct TasksTab: View {
    let graph: AppGraph
    let companyId: String
    let me: Me

    @State private var tab: TasksTabKind = .open
    @State private var dueChip: DueChip?
    @State private var search = ""
    @State private var debouncedQ = ""
    @State private var refreshKey = 0

    @State private var state: LoadState<Void> = .loading
    @State private var rows: [TaskItem] = []
    @State private var hasMore = false
    @State private var loadingMore = false
    @State private var loader: TaskListLoader?
    @State private var toggleError: String?

    private var filtersActive: Bool {
        dueChip != nil || !debouncedQ.isEmpty
    }

    private var reloadToken: String {
        "\(companyId)|\(tab.rawValue)|\(dueChip?.rawValue ?? "")|\(debouncedQ)|\(refreshKey)"
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Filter", selection: $tab) {
                ForEach(TasksTabKind.allCases) { item in
                    Text(item.rawValue).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 10)

            searchField

            dueChips

            content
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
        .task(id: reloadToken) { await reload() }
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

    private var dueChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(DueChip.allCases) { chip in
                    let selected = dueChip == chip
                    Button {
                        dueChip = selected ? nil : chip
                    } label: {
                        Text(chip.rawValue)
                            .font(.subheadline)
                            .foregroundStyle(
                                selected
                                    ? AnyShapeStyle(BrandColor.onPetrolContainer)
                                    : AnyShapeStyle(Color.primary)
                            )
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(
                                selected
                                    ? AnyShapeStyle(BrandColor.petrolContainer)
                                    : AnyShapeStyle(Color(.secondarySystemFill)),
                                in: Capsule()
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private var content: some View {
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
            assigneeUserId: nil,
            unassigned: false,
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
