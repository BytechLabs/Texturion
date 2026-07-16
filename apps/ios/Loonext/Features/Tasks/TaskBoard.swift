import SwiftUI

/// Board view: two horizontally-paged columns, "To do" (status=open) and
/// "Done" (status=done), each with its own cursor pagination. Moving a card
/// between columns is a deliberate tap on the card's move affordance (no
/// fragile drag on touch) — the write is the same derived-done
/// `PATCH /v1/messages/{message_id}` the list rows use.
@MainActor
struct TaskBoardView: View {
    let graph: AppGraph
    let companyId: String
    /// The board's assignee scope: Mine or All (status tabs are meaningless
    /// here — columns ARE the status dimension).
    let tab: TasksTabKind
    let assigneeChip: String?
    let unassignedChip: Bool
    let dueChip: DueChip?
    let q: String
    let refreshKey: Int
    let onOpenTask: @MainActor (String) -> Void
    let onToggleDone: @MainActor (TaskItem, Bool) -> Void

    @State private var state: LoadState<Void> = .loading
    @State private var todo: [TaskItem] = []
    @State private var done: [TaskItem] = []
    @State private var todoLoader: TaskListLoader?
    @State private var doneLoader: TaskListLoader?
    @State private var todoHasMore = false
    @State private var doneHasMore = false
    @State private var localRefresh = 0
    @State private var page = 0

    private var boardTab: TasksTabKind { tab == .all ? .all : .mine }

    private var reloadToken: String {
        [
            companyId, boardTab.rawValue, assigneeChip ?? "", unassignedChip ? "u" : "",
            dueChip?.rawValue ?? "", q, String(refreshKey), String(localRefresh),
        ].joined(separator: "|")
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading()
            case .failed(let message):
                CenteredError(message: message) { localRefresh += 1 }
            case .ready:
                TabView(selection: $page) {
                    column(
                        title: "To do",
                        tasks: todo,
                        emptyCopy: "Nothing to do here.",
                        hasMore: todoHasMore,
                        moveLabel: "Move to Done",
                        moveIcon: "arrow.right.circle",
                        onLoadMore: { loadMore(doneColumn: false) },
                        onMove: { onToggleDone($0, true) }
                    )
                    .tag(0)
                    column(
                        title: "Done",
                        tasks: done,
                        emptyCopy: "Nothing marked done yet.",
                        hasMore: doneHasMore,
                        moveLabel: "Move to To do",
                        moveIcon: "arrow.uturn.backward.circle",
                        onLoadMore: { loadMore(doneColumn: true) },
                        onMove: { onToggleDone($0, false) }
                    )
                    .tag(1)
                }
                .tabViewStyle(.page(indexDisplayMode: .always))
                .indexViewStyle(.page(backgroundDisplayMode: .always))
            }
        }
        .task(id: reloadToken) { await reload() }
    }

    private func column(
        title: String,
        tasks: [TaskItem],
        emptyCopy: String,
        hasMore: Bool,
        moveLabel: String,
        moveIcon: String,
        onLoadMore: @escaping @MainActor () -> Void,
        onMove: @escaping @MainActor (TaskItem) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(title) · \(tasks.count)")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            if tasks.isEmpty {
                Text(emptyCopy)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(tasks, id: \.id) { task in
                            BoardCard(
                                task: task,
                                moveLabel: moveLabel,
                                moveIcon: moveIcon,
                                onOpen: { onOpenTask(task.id) },
                                onMove: { onMove(task) }
                            )
                        }
                        if hasMore {
                            Button("Load more", action: onLoadMore)
                                .font(.subheadline)
                                .padding(.vertical, 4)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 32)
                }
            }
        }
    }

    /// Both columns rebuild on any filter change (a cursor never crosses
    /// filter sets/orderings); quiet refreshes preserve pagination depth.
    private func reload() async {
        if todo.isEmpty && done.isEmpty { state = .loading }
        let arms = taskListArms(
            tab: boardTab,
            assigneeUserId: assigneeChip,
            unassigned: unassignedChip,
            due: dueChip,
            q: q.isEmpty ? nil : q
        )
        // taskListArms for a statusless tab yields exactly the two column
        // arms: [open, done].
        guard arms.count == 2 else { return }
        let api = graph.tasksApi
        let company = companyId
        let fetch: TaskListLoader.Fetch = { filters, cursor, limit in
            try await api.list(companyId: company, filters: filters, cursor: cursor, limit: limit)
        }
        let openArm = TaskListLoader(arms: [arms[0]], fetch: fetch)
        let doneArm = TaskListLoader(arms: [arms[1]], fetch: fetch)
        do {
            let todoTarget = max(todo.count, 1)
            let doneTarget = max(done.count, 1)
            var todoAcc: [TaskItem] = []
            var doneAcc: [TaskItem] = []
            var pages = 0
            repeat {
                todoAcc += try await openArm.nextPage()
                pages += 1
            } while openArm.hasMore && todoAcc.count < todoTarget && pages < 40
            pages = 0
            repeat {
                doneAcc += try await doneArm.nextPage()
                pages += 1
            } while doneArm.hasMore && doneAcc.count < doneTarget && pages < 40
            todo = todoAcc
            done = doneAcc
            todoLoader = openArm
            doneLoader = doneArm
            todoHasMore = openArm.hasMore
            doneHasMore = doneArm.hasMore
            state = .ready(())
        } catch {
            if todo.isEmpty && done.isEmpty {
                state = .failed(error.userMessage)
            }
        }
    }

    private func loadMore(doneColumn: Bool) {
        guard let loader = doneColumn ? doneLoader : todoLoader else { return }
        Task {
            do {
                let next = try await loader.nextPage()
                if doneColumn {
                    done += next
                    doneHasMore = loader.hasMore
                } else {
                    todo += next
                    todoHasMore = loader.hasMore
                }
            } catch {
                // Leave the button; the user retries.
            }
        }
    }
}

private struct BoardCard: View {
    let task: TaskItem
    let moveLabel: String
    let moveIcon: String
    let onOpen: @MainActor () -> Void
    let onMove: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(task.title)
                .font(.subheadline)
                .lineLimit(3)
                .strikethrough(task.done)
                .foregroundStyle(task.done ? AnyShapeStyle(Color.secondary) : AnyShapeStyle(Color.primary))
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack {
                let overdue = isOverdue(task)
                Text(dueLine(overdue: overdue))
                    .font(.caption)
                    .foregroundStyle(
                        overdue
                            ? AnyShapeStyle(BrandColor.overdueAmber)
                            : AnyShapeStyle(Color.secondary)
                    )
                Spacer()
                Button {
                    onMove()
                } label: {
                    Image(systemName: moveIcon)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(moveLabel)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color(.separator).opacity(0.5), lineWidth: 0.5)
        )
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
    }

    private func dueLine(overdue: Bool) -> String {
        guard task.due_at != nil else { return "" }
        return overdue ? "Overdue" : "Due \(formatDue(task.due_at))"
    }
}
