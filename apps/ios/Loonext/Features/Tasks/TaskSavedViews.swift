import Foundation

/// #280 / #689 G: saved views on the Tasks screen.
///
/// A view stores the QUERY, never the result. The allow-list below mirrors the
/// `tasks` half of `packages/shared/src/saved-views.ts` key for key, and an
/// unknown or stale key is DROPPED rather than refused, so a view written
/// before a filter was renamed still opens. The plumbing (`SavedViewsApi`,
/// `SavedView`) is the inbox's, asked for `surface: "tasks"`.
///
/// What a view cannot hold, and so is left out when one is saved:
///  - the Today and This week chips. They are relative to the day, and a stored
///    range would open as last Tuesday. Overdue is a flag and is kept; a range
///    picked by date is kept as picked.
///  - the search text. A question asked once is not a standing view.
///
/// `group` is a view-only key: how the list is laid out. It is never sent to the
/// list request.

enum TaskGroup {
    static let status = "status"
    static let assignee = "assignee"
    static let priority = "priority"
    static let all = [status, assignee, priority]

    static func labelKey(_ group: String) -> String {
        switch group {
        case assignee: return "taskRefs.groupAssignee"
        case priority: return "taskRefs.groupPriority"
        default: return "taskRefs.groupStatus"
        }
    }
}

/// The Tasks screen's controls, as one value a view can describe.
struct TaskViewState: Equatable, Sendable {
    var tab: TasksTabKind = .open
    var assigneeUserId: String? = nil
    var unassigned: Bool = false
    var due: DueChip? = nil
    var meta: TaskMetaFilters = TaskMetaFilters()
    var group: String = TaskGroup.status
}

private let priorityNames: Set<String> = ["none", "low", "normal", "high", "urgent"]
private let taskStatuses: Set<String> = ["open", "done"]
private let taskSorts: Set<String> = ["created", "due", "priority", "updated"]

private func isDigit(_ c: Character) -> Bool {
    guard let v = c.asciiValue else { return false }
    return v >= 48 && v <= 57
}

/// `YYYY-MM-DD`, optionally followed by `T`, digits, colons and dots, then `Z`
/// or an offset like `-05:00`. A character walk, like the UUID check.
func isSavedViewIso(_ value: String) -> Bool {
    let chars = Array(value)
    guard chars.count >= 10 else { return false }
    for (index, c) in chars[0 ..< 10].enumerated() {
        if index == 4 || index == 7 {
            if c != "-" { return false }
        } else if !isDigit(c) {
            return false
        }
    }
    if chars.count == 10 { return true }
    guard chars[10] == "T" else { return false }
    var i = 11
    while i < chars.count, isDigit(chars[i]) || chars[i] == ":" || chars[i] == "." { i += 1 }
    if i == 11 { return false }
    let tail = Array(chars[i...])
    if tail == ["Z"] { return true }
    guard tail.count == 6, tail[0] == "+" || tail[0] == "-", tail[3] == ":" else { return false }
    for k in [1, 2, 4, 5] where !isDigit(tail[k]) { return false }
    return true
}

/// Keep only the task filters the list endpoint understands.
func sanitizeTaskFilters(_ raw: [String: JSONValue]) -> [String: JSONValue] {
    var out: [String: JSONValue] = [:]
    for (key, value) in raw {
        var text: String?
        var flag: Bool?
        if case let .string(s) = value { text = s }
        if case let .bool(b) = value { flag = b }

        let keep: Bool
        switch key {
        case "status": keep = text.map { taskStatuses.contains($0) } ?? false
        case "assigned_user_id", "tag_id", "contact_id", "conversation_id":
            keep = text.map(isSavedViewUUID) ?? false
        case "unassigned", "overdue", "has_location", "has_attachments", "has_references":
            keep = flag != nil
        case "due_before", "due_after": keep = text.map(isSavedViewIso) ?? false
        case "priority":
            if let text, !text.isEmpty {
                keep = text.split(separator: ",", omittingEmptySubsequences: false)
                    .allSatisfy { priorityNames.contains(String($0)) }
            } else {
                keep = false
            }
        case "sort": keep = text.map { taskSorts.contains($0) } ?? false
        case "created_by": keep = text.map { $0 == "me" || isSavedViewUUID($0) } ?? false
        case "source": keep = text.map { TaskSourceChoice.all.contains($0) } ?? false
        case "group": keep = text.map { TaskGroup.all.contains($0) } ?? false
        default: keep = false
        }
        if keep { out[key] = value }
    }
    return out
}

/// The controls as a view stores them.
func taskViewFilters(_ state: TaskViewState, meUserId: String) -> [String: JSONValue] {
    var raw: [String: JSONValue] = [:]
    switch state.tab {
    case .open: raw["status"] = .string("open")
    case .done: raw["status"] = .string("done")
    case .mine, .all: break
    }
    if let only = state.meta.statusOnly, state.tab == .all { raw["status"] = .string(only) }

    if state.unassigned {
        raw["unassigned"] = .bool(true)
    } else if let chip = state.assigneeUserId {
        raw["assigned_user_id"] = .string(chip)
    } else if state.tab != .all {
        raw["assigned_user_id"] = .string(meUserId)
    }

    if state.due == .overdue { raw["overdue"] = .bool(true) }
    let meta = state.meta
    if let after = meta.dueAfter { raw["due_after"] = .string(after) }
    if let before = meta.dueBefore { raw["due_before"] = .string(before) }
    if !meta.priority.isEmpty { raw["priority"] = .string(meta.priority.joined(separator: ",")) }
    if let tag = meta.tagId { raw["tag_id"] = .string(tag) }
    if let sort = meta.sort, sort != TaskSortChoice.created { raw["sort"] = .string(sort) }
    if let contact = meta.contactId { raw["contact_id"] = .string(contact) }
    if let by = meta.createdBy { raw["created_by"] = .string(by) }
    if let source = meta.source { raw["source"] = .string(source) }
    if meta.hasAttachments { raw["has_attachments"] = .bool(true) }
    if meta.hasReferences { raw["has_references"] = .bool(true) }
    if state.group != TaskGroup.status { raw["group"] = .string(state.group) }
    return sanitizeTaskFilters(raw)
}

private func filterText(_ filters: [String: JSONValue], _ key: String) -> String? {
    if case let .string(value) = filters[key] ?? .null { return value }
    return nil
}

private func filterFlag(_ filters: [String: JSONValue], _ key: String) -> Bool {
    if case let .bool(value) = filters[key] ?? .null { return value }
    return false
}

private func tabFor(status: String?, otherwise: TasksTabKind) -> TasksTabKind {
    if status == "open" { return TasksTabKind.open }
    if status == "done" { return TasksTabKind.done }
    return otherwise
}

/// A stored view as the Tasks screen's controls.
///
/// "Mine" is not a stored thing: a view holds an assignee id, and the member's
/// own id is what the Mine and Open tabs mean. A view for somebody else's
/// tasks selects the All tab with that person's chip. A status with no
/// assignee at all (open for everyone) is the All tab narrowed to that status.
func taskViewState(_ filters: [String: JSONValue], meUserId: String) -> TaskViewState {
    let clean = sanitizeTaskFilters(filters)
    let status = filterText(clean, "status")
    var state = TaskViewState()
    var meta = TaskMetaFilters()

    if filterFlag(clean, "unassigned") {
        state.unassigned = true
        state.tab = tabFor(status: status, otherwise: .all)
    } else if let assigned = filterText(clean, "assigned_user_id") {
        if assigned == meUserId {
            state.tab = tabFor(status: status, otherwise: .mine)
        } else {
            state.assigneeUserId = assigned
            state.tab = tabFor(status: status, otherwise: .all)
        }
    } else {
        state.tab = .all
        meta.statusOnly = status
    }

    if filterFlag(clean, "overdue") { state.due = .overdue }
    meta.dueAfter = filterText(clean, "due_after")
    meta.dueBefore = filterText(clean, "due_before")
    if let priority = filterText(clean, "priority") {
        meta.priority = priority.split(separator: ",").map(String.init)
    }
    meta.tagId = filterText(clean, "tag_id")
    meta.sort = filterText(clean, "sort")
    meta.contactId = filterText(clean, "contact_id")
    meta.createdBy = filterText(clean, "created_by")
    meta.source = filterText(clean, "source")
    meta.hasAttachments = filterFlag(clean, "has_attachments")
    meta.hasReferences = filterFlag(clean, "has_references")
    state.meta = meta
    state.group = filterText(clean, "group") ?? TaskGroup.status
    return state
}

/// Is this view the arrangement currently on screen?
func taskViewMatches(
    _ filters: [String: JSONValue],
    _ state: TaskViewState,
    meUserId: String
) -> Bool {
    sanitizeTaskFilters(filters) == taskViewFilters(state, meUserId: meUserId)
}

/// True when the screen holds something a view would leave out (a relative due
/// chip), so the save sheet can say so.
func taskViewDropsDueChip(_ state: TaskViewState) -> Bool {
    state.due == .today || state.due == .week
}

/// A name for the view about to be saved, from what is filtered. Never empty
/// for a filtered screen, so saving takes one tap.
func suggestTaskViewName(
    _ state: TaskViewState,
    locale: String?,
    tagName: String?
) -> String {
    func say(_ key: String) -> String { AppStrings.translate(locale, key) }
    var parts: [String] = []
    parts.append(say(state.tab.labelKey))
    if state.unassigned { parts.append(say("contactsTasks.unassigned")) }
    if state.due == .overdue { parts.append(say("contactsTasks.dueOverdue")) }
    if state.meta.priority.count == 1 {
        parts.append(say(TaskPriority.from(state.meta.priority[0]).labelKey))
    }
    if let tagName, !tagName.isEmpty, state.meta.tagId != nil { parts.append(tagName) }
    if state.meta.hasReferences { parts.append(say("taskRefs.filterHasReferences")) }
    if state.meta.hasAttachments { parts.append(say("taskRefs.filterHasAttachments")) }
    // A middot, not a dash: dashes are banned in rendered copy.
    return parts.joined(separator: " \u{00B7} ")
}

// MARK: - Grouping the list

struct TaskSection: Identifiable, Equatable {
    /// The assignee id, the priority name, or "unassigned".
    let id: String
    /// Catalogue key for a fixed heading, or nil when `title` is a name.
    let titleKey: String?
    let title: String
    let tasks: [TaskItem]

    static func == (lhs: TaskSection, rhs: TaskSection) -> Bool {
        lhs.id == rhs.id && lhs.tasks.map(\.id) == rhs.tasks.map(\.id)
    }
}

/// The loaded rows laid out in sections. `status` is the flat list (the list
/// already puts open before done). Assignee groups by a task's FIRST assignee;
/// priority groups busiest first. Order inside a section is the list's own, and
/// sections appear in the order their first task does, except priority, which
/// is fixed.
func groupTasks(
    _ tasks: [TaskItem],
    by group: String,
    nameOf: (String) -> String?
) -> [TaskSection] {
    switch group {
    case TaskGroup.assignee:
        var order: [String] = []
        var buckets: [String: [TaskItem]] = [:]
        for task in tasks {
            let key = task.assigneeIds.first ?? "unassigned"
            if buckets[key] == nil { order.append(key) }
            buckets[key, default: []].append(task)
        }
        return order.map { (key: String) -> TaskSection in
            var titleKey: String? = nil
            var title = ""
            if key == "unassigned" {
                titleKey = "contactsTasks.unassigned"
            } else if let name = nameOf(key), !name.isEmpty {
                title = name
            } else {
                titleKey = "contactsTasks.teammate"
            }
            return TaskSection(id: key, titleKey: titleKey, title: title, tasks: buckets[key] ?? [])
        }
    case TaskGroup.priority:
        let ranked: [TaskPriority] = TaskPriority.rankedForMenus + [TaskPriority.none]
        return ranked.compactMap { (priority: TaskPriority) -> TaskSection? in
            let rows = tasks.filter { $0.priorityValue == priority }
            if rows.isEmpty { return nil }
            return TaskSection(
                id: priority.rawValue,
                titleKey: priority.labelKey,
                title: "",
                tasks: rows
            )
        }
    default:
        return [TaskSection(id: "all", titleKey: nil, title: "", tasks: tasks)]
    }
}
