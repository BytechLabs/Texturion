import Foundation

/// The /v1/tasks filter model, ported from apps/web/src/lib/api/task-params.ts
/// (via the Android TaskFilters.kt) so the clients never drift on the route's
/// frozen semantics:
///
///  - NO params at all silently means status=open + assignee=me ("what needs
///    me now"); ANY explicit filter param disables BOTH defaults.
///  - "all" is UI sugar: the assignee pin is dropped, and when no other
///    explicit param would survive, a `status=open` sentinel is injected so
///    the route's Open·Mine default is not re-applied.
///  - Cursors come in TWO incompatible orderings — due-sorted (when overdue /
///    due_before / due_after is present) vs created-sorted — and a cursor
///    minted for one ordering is a 422 on the other. `orderingKey` is the
///    client-side guard: a pager may only reuse a cursor while the key (and
///    the rest of the params) is unchanged.

/// Marker the server resolves to the caller (the route accepts the literal).
let assigneeMe = "me"

/// UI sugar for "every assignee" — normalized away by `taskQueryParams`.
let assigneeAll = "all"

/// Title-search cap mirrored from the Android TaskFormat.kt constants.
let taskSearchMax = 200

enum TaskStatusFilter {
    static let open = "open"
    static let done = "done"
}

/// The segmented tabs, mirroring the web /tasks page.
enum TasksTabKind: String, CaseIterable, Identifiable, Sendable {
    case open = "Open"
    case mine = "Mine"
    case all = "All"
    case done = "Done"

    var id: String { rawValue }
}

/// The due filter chip (single-select, mirrors DUE_LABELS on the web).
enum DueChip: String, CaseIterable, Identifiable, Sendable {
    case overdue = "Overdue"
    case today = "Due today"
    case week = "Due this week"

    var id: String { rawValue }
}

/// One GET /v1/tasks query, pre-serialization. All fields optional.
struct TaskListFilters: Equatable, Sendable {
    var status: String? = nil
    /// `assigneeMe`, a concrete user id, or `assigneeAll` (the sugar).
    var assignedUserId: String? = nil
    var unassigned: Bool = false
    var conversationId: String? = nil
    var dueBefore: String? = nil
    var dueAfter: String? = nil
    var overdue: Bool = false
    var q: String? = nil
}

/// Serialize filters to the GET /v1/tasks query params — the Swift port of
/// the web's `taskSearchParams`. Nil values are dropped by ApiClient;
/// booleans are sent only when true.
func taskQueryParams(
    _ filters: TaskListFilters,
    cursor: String? = nil,
    limit: Int = 25
) -> [String: String?] {
    let explicitAll = filters.assignedUserId == assigneeAll

    // "All" needs (1) no assignee pin and (2) at least one explicit param so
    // the frozen route's Open·Mine default is not re-applied. `status=open` is
    // the only opt-out that keeps the query semantically clean, injected only
    // when no other explicit filter is already the opt-out.
    let needsAllSentinel = explicitAll &&
        filters.status == nil &&
        !filters.overdue &&
        filters.conversationId == nil &&
        filters.dueBefore == nil &&
        filters.dueAfter == nil &&
        filters.q == nil &&
        !filters.unassigned
    let status = filters.status ?? (needsAllSentinel ? TaskStatusFilter.open : nil)

    return [
        "status": status,
        "assigned_user_id": explicitAll ? nil : filters.assignedUserId,
        "unassigned": filters.unassigned ? "true" : nil,
        "conversation_id": filters.conversationId,
        "due_before": filters.dueBefore,
        "due_after": filters.dueAfter,
        "overdue": filters.overdue ? "true" : nil,
        "q": filters.q,
        "cursor": cursor,
        "limit": String(limit),
    ]
}

/// Which cursor ordering a filter set produces. A cursor may ONLY be passed
/// back with params whose ordering key (and content) match the page that
/// minted it — the route 422s on a cursor from the other ordering.
func orderingKey(_ filters: TaskListFilters) -> String {
    (filters.overdue || filters.dueBefore != nil || filters.dueAfter != nil) ? "due" : "created"
}

/// Encode a boundary as ISO 8601 WITH the zone's UTC offset at that instant
/// (the API requires an offset-bearing string; "Z" only when the zone
/// genuinely is UTC).
func isoOffsetString(_ date: Date, timeZone: TimeZone) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = timeZone
    return formatter.string(from: date)
}

/// The due chip → ISO window mapping (web's dueRange). Today = [start of
/// today, +1 day); This week = [start of today, +7 days); Overdue = the
/// dedicated flag (past-due AND not done, server-side).
func dueChipFilters(
    _ chip: DueChip,
    now: Date = Date(),
    calendar: Calendar = .current
) -> TaskListFilters {
    if chip == .overdue { return TaskListFilters(overdue: true) }
    let start = calendar.startOfDay(for: now)
    let days = chip == .today ? 1 : 7
    let end = calendar.date(byAdding: .day, value: days, to: start)
        ?? start.addingTimeInterval(Double(days) * 86_400)
    return TaskListFilters(
        dueBefore: isoOffsetString(end, timeZone: calendar.timeZone),
        dueAfter: isoOffsetString(start, timeZone: calendar.timeZone)
    )
}

/// The whole tab + chips + search state of the tasks screen, resolved to the
/// one-or-two status-scoped queries ("arms") the list runs.
///
/// Tab → baseline (web's toTaskFilters): Open = open+me, Mine = me (both
/// statuses), Done = done+me, All = every assignee. A specific-member
/// assignee chip overrides the tab's `me` pin; the unassigned chip is its own
/// dimension (the two are mutually exclusive in the UI). Chips for due/q
/// refine every arm.
///
/// There is NO all-statuses mode on the route, so statusless tabs (Mine /
/// All) become TWO arms — status=open then status=done — paginated
/// sequentially (open rows always list before done rows).
func taskListArms(
    tab: TasksTabKind,
    assigneeUserId: String?,
    unassigned: Bool,
    due: DueChip?,
    q: String?,
    now: Date = Date(),
    calendar: Calendar = .current
) -> [TaskListFilters] {
    let dueFilters = due.map { dueChipFilters($0, now: now, calendar: calendar) }
        ?? TaskListFilters()
    let query: String? = {
        let trimmed = (q ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }()

    let baseAssignee: String?
    if let assigneeUserId {
        baseAssignee = assigneeUserId
    } else if unassigned {
        baseAssignee = nil
    } else if tab == .all {
        baseAssignee = assigneeAll
    } else {
        baseAssignee = assigneeMe
    }

    func arm(_ status: String) -> TaskListFilters {
        TaskListFilters(
            status: status,
            assignedUserId: baseAssignee,
            unassigned: unassigned && assigneeUserId == nil,
            dueBefore: dueFilters.dueBefore,
            dueAfter: dueFilters.dueAfter,
            overdue: dueFilters.overdue,
            q: query
        )
    }

    switch tab {
    case .open:
        return [arm(TaskStatusFilter.open)]
    case .done:
        return [arm(TaskStatusFilter.done)]
    case .mine, .all:
        // Statusless tabs: union open + done, open first.
        return [arm(TaskStatusFilter.open), arm(TaskStatusFilter.done)]
    }
}

/// Sequential multi-arm cursor pagination over GET /v1/tasks.
///
/// Statusless tabs (Mine / All) have no all-statuses mode on the route, so
/// they run TWO status-scoped queries — the loader drains arm 0 (open) before
/// starting arm 1 (done), which keeps open rows listed before done rows.
///
/// The dual-cursor invariant is structural here: each arm's cursor is only
/// ever passed back with that arm's own (immutable) filter set, and any
/// filter change builds a NEW loader — a cursor can never cross orderings.
@MainActor
final class TaskListLoader {
    typealias Fetch = @Sendable (TaskListFilters, String?, Int) async throws -> Page<TaskItem>

    private let fetch: Fetch
    private let arms: [TaskListFilters]
    private let limit: Int
    private var armIndex = 0
    private var cursor: String?
    private var exhausted: Bool

    init(arms: [TaskListFilters], limit: Int = 25, fetch: @escaping Fetch) {
        self.arms = arms
        self.limit = limit
        self.fetch = fetch
        self.exhausted = arms.isEmpty
    }

    var hasMore: Bool { !exhausted }

    /// Load the next page (empty when everything is drained).
    func nextPage() async throws -> [TaskItem] {
        while !exhausted {
            let page = try await fetch(arms[armIndex], cursor, limit)
            if let next = page.next_cursor {
                cursor = next
            } else if armIndex + 1 < arms.count {
                armIndex += 1
                cursor = nil
            } else {
                exhausted = true
            }
            if !page.data.isEmpty { return page.data }
            // An empty page with a follow-up arm: keep going so "Load more"
            // never returns nothing while rows still exist in the next arm.
        }
        return []
    }
}
