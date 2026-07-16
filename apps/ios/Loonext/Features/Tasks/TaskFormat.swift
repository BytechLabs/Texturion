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

private let posixLocale = Locale(identifier: "en_US_POSIX")

/// Encode a picked due date as ISO 8601 WITH the zone's UTC offset at that
/// instant (the API requires an offset-bearing string; "Z" only when the zone
/// genuinely is UTC). Example: 2026-07-15 15:00 in America/Toronto →
/// "2026-07-15T15:00:00-04:00". Delegates to the same formatter the due-chip
/// windows use so the two encoders can never drift.
func encodeDueAt(_ date: Date, timeZone: TimeZone = .current) -> String {
    isoOffsetString(date, timeZone: timeZone)
}

/// "today 3:00 PM" / "Jul 8 9:00 AM" for a due-set activity line.
func dueSentenceTime(_ iso: String, now: Date = Date(), calendar: Calendar = .current) -> String {
    guard let date = parseWireTimestamp(iso) else { return "" }
    let formatter = DateFormatter()
    formatter.locale = posixLocale
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "h:mm a"
    let time = formatter.string(from: date)
    if calendar.isDate(date, inSameDayAs: now) { return "today \(time)" }
    formatter.dateFormat = "MMM d"
    return "\(formatter.string(from: date)) \(time)"
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
