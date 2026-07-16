import SwiftUI

/// Which cards a drop on a board column actually toggles — pure so the
/// decision is unit-testable (TasksBoardLogicTests) without a drag session:
///  - a dropped id moves only when it resolves to a card in the OPPOSITE
///    column (dropping a card back on its own column is a no-op),
///  - foreign payloads (arbitrary text dragged from another app on iPad)
///    resolve to no task and are ignored,
///  - duplicate ids in one drop toggle once, source order preserved.
/// The caller runs the SAME derived-done `PATCH /v1/messages/{message_id}`
/// the move arrow runs for every returned task — never a task write.
func boardDropToggles(
    droppedIds: [String],
    targetDone: Bool,
    todo: [TaskItem],
    done: [TaskItem]
) -> [TaskItem] {
    let source = targetDone ? todo : done
    let alreadyThere = Set((targetDone ? done : todo).map(\.id))
    var seen = Set<String>()
    var toggles: [TaskItem] = []
    for id in droppedIds {
        guard seen.insert(id).inserted, !alreadyThere.contains(id) else { continue }
        if let task = source.first(where: { $0.id == id }) {
            toggles.append(task)
        }
    }
    return toggles
}

/// Board view: two horizontally-paged columns, "To do" (status=open) and
/// "Done" (status=done), each with its own cursor pagination. Moving a card
/// between columns works two ways, both running the same derived-done
/// `PATCH /v1/messages/{message_id}` the list rows use:
///  - drag the card onto the other column (hold the card, swipe the page
///    with a second finger, drop), or
///  - tap the card's move arrow — kept because a drag is invisible to
///    VoiceOver and hard with limited dexterity.
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
                    BoardColumn(
                        title: "To do",
                        tasks: todo,
                        emptyCopy: "Nothing to do here.",
                        hasMore: todoHasMore,
                        moveLabel: "Move to Done",
                        moveIcon: "arrow.right.circle",
                        onOpenTask: onOpenTask,
                        onLoadMore: { loadMore(doneColumn: false) },
                        onMove: { onToggleDone($0, true) },
                        onDropIds: { performDrop($0, targetDone: false) }
                    )
                    .tag(0)
                    BoardColumn(
                        title: "Done",
                        tasks: done,
                        emptyCopy: "Nothing marked done yet.",
                        hasMore: doneHasMore,
                        moveLabel: "Move to To do",
                        moveIcon: "arrow.uturn.backward.circle",
                        onOpenTask: onOpenTask,
                        onLoadMore: { loadMore(doneColumn: true) },
                        onMove: { onToggleDone($0, false) },
                        onDropIds: { performDrop($0, targetDone: true) }
                    )
                    .tag(1)
                }
                .tabViewStyle(.page(indexDisplayMode: .always))
                .indexViewStyle(.page(backgroundDisplayMode: .always))
            }
        }
        .task(id: reloadToken) { await reload() }
    }

    /// Cards dropped on a column: resolve which tasks actually move (pure,
    /// tested), then run the SAME derived-done mutation the move arrow runs.
    private func performDrop(_ ids: [String], targetDone: Bool) -> Bool {
        let toggles = boardDropToggles(
            droppedIds: ids, targetDone: targetDone, todo: todo, done: done
        )
        for task in toggles {
            onToggleDone(task, targetDone)
        }
        return !toggles.isEmpty
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

/// One board column — also the drop destination for cards dragged from the
/// other column (a drop is the same derived-done PATCH as the move arrow).
private struct BoardColumn: View {
    let title: String
    let tasks: [TaskItem]
    let emptyCopy: String
    let hasMore: Bool
    let moveLabel: String
    let moveIcon: String
    let onOpenTask: @MainActor (String) -> Void
    let onLoadMore: @MainActor () -> Void
    let onMove: @MainActor (TaskItem) -> Void
    /// Card ids dropped on this column; returns whether any card moved.
    let onDropIds: @MainActor ([String]) -> Bool

    @State private var dropTargeted = false

    var body: some View {
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
        // The whole column (empty space included) accepts a dragged card, so
        // dropping into an empty column works.
        .contentShape(Rectangle())
        .background(dropTargeted ? Color(.secondarySystemFill).opacity(0.6) : Color.clear)
        .dropDestination(for: String.self) { ids, _ in
            onDropIds(ids)
        } isTargeted: { targeted in
            dropTargeted = targeted
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
        // The card IS the drag payload (its task id) — dropping it on the
        // other column runs the same derived-done PATCH as the arrow, which
        // stays for accessibility (a drag is invisible to VoiceOver).
        .draggable(task.id)
        .onTapGesture(perform: onOpen)
    }

    private func dueLine(overdue: Bool) -> String {
        guard task.due_at != nil else { return "" }
        return overdue ? "Overdue" : "Due \(formatDue(task.due_at))"
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
        assigned_user_id: nil,
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

#Preview("Board cards") {
    VStack(spacing: 8) {
        BoardCard(
            task: previewTask(
                id: "t1",
                title: "Send the quote for the deck repair",
                done: false,
                dueAt: "2099-07-20T15:00:00Z"
            ),
            moveLabel: "Move to Done",
            moveIcon: "arrow.right.circle",
            onOpen: {},
            onMove: {}
        )
        BoardCard(
            task: previewTask(
                id: "t2",
                title: "Order shingles for the Hendersons",
                done: false,
                dueAt: "2020-07-01T15:00:00Z" // past due → the amber Overdue line
            ),
            moveLabel: "Move to Done",
            moveIcon: "arrow.right.circle",
            onOpen: {},
            onMove: {}
        )
        BoardCard(
            task: previewTask(id: "t3", title: "Invoice the Hendersons", done: true),
            moveLabel: "Move to To do",
            moveIcon: "arrow.uturn.backward.circle",
            onOpen: {},
            onMove: {}
        )
    }
    .padding(16)
}

#Preview("Board") {
    TaskBoardView(
        graph: AppGraph(),
        companyId: "preview-co",
        tab: .mine,
        assigneeChip: nil,
        unassignedChip: false,
        dueChip: nil,
        q: "",
        refreshKey: 0,
        onOpenTask: { _ in },
        onToggleDone: { _, _ in }
    )
}
