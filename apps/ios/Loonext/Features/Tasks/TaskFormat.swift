import Foundation

/// Pure task display/encoding helpers — the Swift siblings of the web's
/// task-format.ts / task-activity.ts and the Android TaskFormat.kt, kept
/// dependency-free for unit tests. Due dates go amber ONLY when overdue
/// (never a red scare), and only for a not-done task.
///
/// `parseWireTimestamp`, `isOverdue`, and `formatDue` live in
/// Support/Format.swift (shared with the other tabs) — this file adds the
/// tasks-only pieces on top.

let taskTitleMax = 500
let taskDescriptionMax = 5000
let noteBodyMax = 4096
let noteFileMaxBytes = 25 * 1024 * 1024
let noteFilesMax = 10

/// Encode a picked due date as ISO 8601 WITH the zone's UTC offset at that
/// instant (the API requires an offset-bearing string; "Z" only when the zone
/// genuinely is UTC). Example: 2026-07-15 15:00 in America/Toronto →
/// "2026-07-15T15:00:00-04:00". Delegates to the same formatter the due-chip
/// windows use so the two encoders can never drift.
func encodeDueAt(_ date: Date, timeZone: TimeZone = .current) -> String {
    isoOffsetString(date, timeZone: timeZone)
}

/// "3:00 PM" / "Jul 8, 9:00 AM" for a due-set activity line, from the shared timestamp rule.
func dueSentenceTime(_ iso: String, now: Date = Date(), calendar: Calendar = .current) -> String {
    TimestampFormat.label(iso, style: .long, now: now, timeZone: calendar.timeZone)
}

/// One quiet line for a change to a task (#689), the same words as the web.
/// `by` is the resolved actor name. A kind this build does not know says the
/// task was updated.
func taskHistorySentence(
    _ item: TaskFeedItem,
    by: String,
    locale: String? = nil,
    timeZone: TimeZone = .current,
    now: Date = Date()
) -> String {
    func say(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(locale, key, vars.merging(["by": by]) { mine, _ in mine })
    }
    func text(_ value: JSONValue?) -> String? {
        guard let string = value?.stringValue, !string.isEmpty else { return nil }
        return string
    }
    let nothing: Bool = {
        guard let to = item.to else { return true }
        if case .null = to { return true }
        return false
    }()

    switch item.event {
    case "created":
        return say("contactsTasks.histCreated")
    case "title":
        guard let title = text(item.to) else { return say("contactsTasks.histUpdated") }
        return say("contactsTasks.histTitle", ["title": title])
    case "description":
        return say("contactsTasks.histDescription")
    case "address":
        return say(nothing ? "contactsTasks.histAddressCleared" : "contactsTasks.histAddress")
    case "assignee":
        guard text(item.to) != nil else { return say("contactsTasks.histUnassigned") }
        if let name = item.to_user?.display_name, !name.isEmpty {
            return say("contactsTasks.histAssigned", ["name": name])
        }
        return say("contactsTasks.histReassigned")
    case "assignee_added":
        // #689 C: one line per person added to the crew. A person the roster
        // cannot name reads as a plain update rather than a guess.
        guard let name = item.to_user?.display_name, !name.isEmpty else {
            return say("contactsTasks.histUpdated")
        }
        return say("contactsTasks.histAssigneeAdded", ["name": name])
    case "assignee_removed":
        guard let name = item.from_user?.display_name, !name.isEmpty else {
            return say("contactsTasks.histUpdated")
        }
        return say("contactsTasks.histAssigneeRemoved", ["name": name])
    case "due":
        guard let due = text(item.to), parseWireTimestamp(due) != nil else {
            return say("contactsTasks.histDueCleared")
        }
        let label = TimestampFormat.label(
            due, style: .long, locale: locale, now: now, timeZone: timeZone)
        return say("contactsTasks.histDue", ["due": label])
    case "reminders":
        return say(
            item.to?.boolValue == true
                ? "contactsTasks.histRemindersOff"
                : "contactsTasks.histRemindersOn"
        )
    case "confirmation":
        return say(
            nothing ? "contactsTasks.histConfirmationCleared" : "contactsTasks.histConfirmed"
        )
    case "priority":
        guard let raw = text(item.to) else { return say("contactsTasks.histUpdated") }
        return say(
            "contactsTasks.histPriority",
            ["priority": AppStrings.translate(locale, TaskPriority.from(raw).labelKey)]
        )
    case "label_added":
        guard let name = text(item.to?["name"]) else { return say("contactsTasks.histUpdated") }
        return say("contactsTasks.histLabelAdded", ["name": name])
    case "label_removed":
        guard let name = text(item.from?["name"]) else { return say("contactsTasks.histUpdated") }
        return say("contactsTasks.histLabelRemoved", ["name": name])
    case "repeat":
        if nothing { return say("contactsTasks.histRepeatCleared") }
        guard let rule = taskRepeatRule(from: item.to) else {
            return say("contactsTasks.histUpdated")
        }
        return say(
            "contactsTasks.histRepeat",
            ["rule": taskRepeatSummary(rule, locale: locale)]
        )
    case "done":
        return say("contactsTasks.histDone")
    case "reopened":
        return say("contactsTasks.histReopened")
    case "deleted":
        return say("contactsTasks.histDeleted")
    default:
        return say("contactsTasks.histUpdated")
    }
}

/// #693: read a repeat rule out of the summary object an activity event carries.
/// Nil when the object has no kind and unit, so the line says "updated" rather
/// than guessing at a rule.
func taskRepeatRule(from value: JSONValue?) -> TaskRepeatRule? {
    guard let object = value?.objectValue,
          let kind = object["kind"]?.stringValue,
          let unit = object["unit"]?.stringValue else { return nil }
    return TaskRepeatRule(
        kind: kind,
        unit: unit,
        every: object["every"]?.intValue,
        weekdays: object["weekdays"]?.arrayValue?.compactMap { $0.intValue },
        month_day: object["month_day"]?.intValue,
        nth: object["nth"]?.intValue,
        nth_weekday: object["nth_weekday"]?.intValue,
        ends: nil,
        paused: object["paused"]?.boolValue,
        stopped: object["stopped"]?.boolValue,
        id: nil
    )
}

/// A quiet human sentence for one task_* activity event, ported from the
/// web's taskEventSentence so the clients read identically. `by` is the
/// resolved actor name (fall back to "Loonext" for system); `memberName`
/// resolves the assigned-to user id. Unknown types return nil — skip the row.
func taskEventSentence(
    _ item: TaskActivityItem,
    by: String,
    memberName: (String?) -> String?,
    now: Date = Date(),
    calendar: Calendar = .current
) -> String? {
    func payloadString(_ key: String) -> String? {
        item.payload?[key]?.stringValue
    }
    switch item.type {
    case "task_created":
        return "\(by) turned this into a task"
    case "task_assigned":
        guard let to = payloadString("to_user_id") else {
            return "\(by) unassigned this task"
        }
        if let name = memberName(to) {
            return "\(by) assigned this to \(name)"
        }
        return "\(by) reassigned this task"
    case "task_due_set":
        guard let due = payloadString("due_at") else {
            return "\(by) cleared the due date"
        }
        return "\(by) set the due date to \(dueSentenceTime(due, now: now, calendar: calendar))"
    case "task_deleted":
        return "\(by) removed this task"
    case "task_attachment_added":
        return "\(by) attached a file"
    case "task_attachment_removed":
        return "\(by) removed a file"
    default:
        return nil
    }
}

/// "512 B" / "12 KB" / "3.5 MB" for a file cell; nil size renders nothing.
func formatBytes(_ bytes: Int?) -> String {
    guard let bytes else { return "" }
    if bytes >= 1024 * 1024 {
        return String(format: "%.1f MB", Double(bytes) / 1024.0 / 1024.0)
    }
    if bytes >= 1024 { return "\(bytes / 1024) KB" }
    return "\(bytes) B"
}
