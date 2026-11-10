import Foundation

/// #693: what a task carries beyond its title: how much it matters, which
/// workspace labels it wears, and whether it comes back.
///
/// Every field is optional on the rows that carry it so a payload from before
/// #693 still decodes. The wire names are the stored names (no CodingKeys),
/// like every other model in this folder.

/// A label on a task is a workspace tag, so it is the same shape a contact's tag
/// has: id, name and a colour the server may leave null.
typealias TaskLabel = ContactTag

/// How much a task matters. `none` means nobody ranked it; `normal` is what a
/// task is until somebody says otherwise. An unknown word from a newer server
/// reads as normal rather than failing a whole list.
enum TaskPriority: String, CaseIterable, Identifiable, Sendable {
    case none
    case low
    case normal
    case high
    case urgent

    var id: String { rawValue }

    /// The words a person sees. Catalogue keys, never English.
    var labelKey: String {
        switch self {
        case .none: return "contactsTasks.priorityNone"
        case .low: return "contactsTasks.priorityLow"
        case .normal: return "contactsTasks.priorityNormal"
        case .high: return "contactsTasks.priorityHigh"
        case .urgent: return "contactsTasks.priorityUrgent"
        }
    }

    /// Only these two earn a mark on a row. A flag on every task would be a flag
    /// on none of them.
    var isFlagged: Bool { self == .high || self == .urgent }

    /// The four the filter and the bulk menu offer, busiest first. `none` is a
    /// value a task can have but not something anyone filters by.
    static let rankedForMenus: [TaskPriority] = [.urgent, .high, .normal, .low]

    static func from(_ raw: String?) -> TaskPriority {
        guard let raw, let value = TaskPriority(rawValue: raw) else { return .normal }
        return value
    }
}

/// When a repeat stops: never, on a date (`on` is YYYY-MM-DD), or after N times.
struct TaskRepeatEnds: Codable, Sendable, Equatable {
    let kind: String
    var on: String? = nil
    var after: Int? = nil
}

/// The repeat rule on a task row.
///
/// `kind` is "schedule" (fixed dates; needs a due date) or "after_done" (the
/// next one is made when this one is finished). `unit` is day, week, month or
/// year (after_done never uses year). `weekdays` are ISO numbers, 1 = Monday.
/// `nth` is 1..4 or -1 for the last, paired with `nth_weekday` (ISO).
struct TaskRepeatRule: Codable, Sendable, Equatable {
    let kind: String
    let unit: String
    var every: Int? = nil
    var weekdays: [Int]? = nil
    var month_day: Int? = nil
    var nth: Int? = nil
    var nth_weekday: Int? = nil
    var ends: TaskRepeatEnds? = nil
    var paused: Bool? = nil
    var stopped: Bool? = nil
    var id: String? = nil

    var isAfterDone: Bool { kind == TaskRepeatKind.afterDone }
    var isPaused: Bool { paused ?? false }
    var isStopped: Bool { stopped ?? false }
    var interval: Int { max(every ?? 1, 1) }
}

/// The slice of a repeat the contact timeline carries.
struct TimelineRepeat: Codable, Sendable, Equatable {
    let kind: String
    let unit: String
    var every: Int? = nil
    var paused: Bool? = nil
    var stopped: Bool? = nil
}

enum TaskRepeatKind {
    static let schedule = "schedule"
    static let afterDone = "after_done"
}

enum TaskRepeatUnit {
    static let day = "day"
    static let week = "week"
    static let month = "month"
    static let year = "year"
}

/// Which occurrences an edit or a delete reaches. A task that does not repeat
/// has only itself, so nothing is asked.
enum TaskScope {
    static let this = "this"
    static let future = "future"
}

/// Ask "this one or this and future" only when there is a repeat that still
/// runs. A stopped repeat leaves nothing to carry an edit to.
func taskNeedsScope(_ rule: TaskRepeatRule?) -> Bool {
    guard let rule else { return false }
    return !rule.isStopped
}

/// A repeat icon belongs on a row only while the repeat is alive. A paused one
/// still shows (it is still a repeating job), a stopped one does not.
func taskShowsRepeatIcon(_ rule: TaskRepeatRule?) -> Bool {
    guard let rule else { return false }
    return !rule.isStopped
}

func timelineShowsRepeatIcon(_ rule: TimelineRepeat?) -> Bool {
    guard let rule else { return false }
    return rule.stopped != true
}

// MARK: - Summary text

private let isoWeekdayKeys = [
    "contactsTasks.repeatDayMon", "contactsTasks.repeatDayTue", "contactsTasks.repeatDayWed",
    "contactsTasks.repeatDayThu", "contactsTasks.repeatDayFri", "contactsTasks.repeatDaySat",
    "contactsTasks.repeatDaySun",
]

/// The full weekday name for an ISO number (1 = Monday); nil when out of range.
func repeatWeekdayName(_ iso: Int, locale: String?) -> String? {
    guard iso >= 1, iso <= 7 else { return nil }
    return AppStrings.translate(locale, isoWeekdayKeys[iso - 1])
}

/// "Monday", "Monday and Thursday", "Monday, Wednesday and Friday".
func repeatWeekdayList(_ days: [Int], locale: String?) -> String {
    let names = Array(Set(days)).sorted().compactMap { repeatWeekdayName($0, locale: locale) }
    guard names.count > 1, let last = names.last else { return names.first ?? "" }
    let joiner = AppStrings.translate(locale, "contactsTasks.andJoiner")
    return names.dropLast().joined(separator: ", ") + joiner + last
}

private func repeatOrdinal(_ nth: Int, locale: String?) -> String {
    switch nth {
    case 1: return AppStrings.translate(locale, "contactsTasks.nthFirst")
    case 2: return AppStrings.translate(locale, "contactsTasks.nthSecond")
    case 3: return AppStrings.translate(locale, "contactsTasks.nthThird")
    case 4: return AppStrings.translate(locale, "contactsTasks.nthFourth")
    default: return AppStrings.translate(locale, "contactsTasks.nthLast")
    }
}

/// One sentence for a rule: "Repeats every Monday", "Repeats 6 months after
/// it is done". Ends and paused are `taskRepeatDetailLine`'s job.
func taskRepeatSummary(_ rule: TaskRepeatRule, locale: String?) -> String {
    let count = String(rule.interval)
    if rule.isAfterDone {
        let key: String
        switch rule.unit {
        case TaskRepeatUnit.week:
            key = rule.interval == 1 ? "repeatAfterWeekOne" : "repeatAfterWeekMany"
        case TaskRepeatUnit.month:
            key = rule.interval == 1 ? "repeatAfterMonthOne" : "repeatAfterMonthMany"
        default:
            key = rule.interval == 1 ? "repeatAfterDayOne" : "repeatAfterDayMany"
        }
        return AppStrings.translate(locale, "contactsTasks." + key, ["n": count])
    }
    switch rule.unit {
    case TaskRepeatUnit.week:
        let days = repeatWeekdayList(rule.weekdays ?? [], locale: locale)
        if days.isEmpty {
            return rule.interval == 1
                ? AppStrings.translate(locale, "contactsTasks.repeatEveryWeek")
                : AppStrings.translate(locale, "contactsTasks.repeatEveryNWeeks", ["n": count])
        }
        return rule.interval == 1
            ? AppStrings.translate(locale, "contactsTasks.repeatEveryDays", ["days": days])
            : AppStrings.translate(
                locale, "contactsTasks.repeatEveryNWeeksOn", ["n": count, "days": days]
            )
    case TaskRepeatUnit.month:
        if let nth = rule.nth, let weekday = rule.nth_weekday,
           let name = repeatWeekdayName(weekday, locale: locale) {
            let vars = ["nth": repeatOrdinal(nth, locale: locale), "weekday": name, "n": count]
            return rule.interval == 1
                ? AppStrings.translate(locale, "contactsTasks.repeatMonthlyNth", vars)
                : AppStrings.translate(locale, "contactsTasks.repeatEveryNMonthsNth", vars)
        }
        if let day = rule.month_day {
            let vars = ["day": String(day), "n": count]
            return rule.interval == 1
                ? AppStrings.translate(locale, "contactsTasks.repeatMonthlyDay", vars)
                : AppStrings.translate(locale, "contactsTasks.repeatEveryNMonthsDay", vars)
        }
        return rule.interval == 1
            ? AppStrings.translate(locale, "contactsTasks.repeatEveryMonth")
            : AppStrings.translate(locale, "contactsTasks.repeatEveryNMonths", ["n": count])
    case TaskRepeatUnit.year:
        return rule.interval == 1
            ? AppStrings.translate(locale, "contactsTasks.repeatEveryYear")
            : AppStrings.translate(locale, "contactsTasks.repeatEveryNYears", ["n": count])
    default:
        return rule.interval == 1
            ? AppStrings.translate(locale, "contactsTasks.repeatEveryDay")
            : AppStrings.translate(locale, "contactsTasks.repeatEveryNDays", ["n": count])
    }
}

/// The summary plus what ends it and whether it is paused, joined by a middle
/// dot: "Repeats every Monday · 5 times · Paused".
func taskRepeatDetailLine(_ rule: TaskRepeatRule, locale: String?) -> String {
    var parts = [taskRepeatSummary(rule, locale: locale)]
    if let ends = rule.ends {
        if ends.kind == "after", let after = ends.after {
            parts.append(
                AppStrings.translate(locale, "contactsTasks.repeatTimes", ["count": String(after)])
            )
        } else if ends.kind == "on", let on = ends.on {
            parts.append(AppStrings.translate(locale, "contactsTasks.repeatUntil", ["date": on]))
        }
    }
    if rule.isPaused {
        parts.append(AppStrings.translate(locale, "contactsTasks.repeatPausedTag"))
    }
    return parts.joined(separator: " \u{00B7} ")
}
