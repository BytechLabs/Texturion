import Foundation

/// #693: the repeat a person is building, before it becomes a request body.
///
/// Pure on purpose: what the sheet offers, what it refuses and what it sends are
/// all decided here, where a test can reach them without a screen.

enum TaskMonthMode: String, Sendable {
    /// "On day 15."
    case day
    /// "On the second Tuesday."
    case nth
}

/// Why a repeat cannot be saved yet. The sheet shows the sentence and keeps the
/// Save button off, instead of letting the server answer 422.
enum TaskRepeatProblem: Equatable, Sendable {
    /// A schedule is a run of due dates, so it has nothing to count from.
    case needsDue
    /// A weekly schedule needs at least one day.
    case needsWeekday

    var messageKey: String {
        switch self {
        case .needsDue: return "contactsTasks.repeatNeedsDue"
        case .needsWeekday: return "contactsTasks.repeatNeedsWeekday"
        }
    }
}

struct TaskRepeatDraft: Equatable, Sendable {
    var kind: String = TaskRepeatKind.schedule
    var unit: String = TaskRepeatUnit.week
    var every: Int = 1
    /// ISO weekdays, 1 = Monday. Used by a weekly schedule.
    var weekdays: [Int] = [1]
    var monthMode: TaskMonthMode = .day
    var monthDay: Int = 1
    /// 1...4, or -1 for the last. Used by a monthly schedule on a weekday.
    var nth: Int = 1
    var nthWeekday: Int = 1
    /// "never", "on" or "after".
    var endsKind: String = "never"
    var endsOn: Date = Date()
    var endsAfter: Int = 5
    var paused: Bool = false

    /// The units each kind offers. After-done never uses a year.
    static func units(for kind: String) -> [String] {
        kind == TaskRepeatKind.afterDone
            ? [TaskRepeatUnit.day, TaskRepeatUnit.week, TaskRepeatUnit.month]
            : [TaskRepeatUnit.day, TaskRepeatUnit.week, TaskRepeatUnit.month, TaskRepeatUnit.year]
    }

    /// A fresh draft. A job tied to a customer defaults to "after it's done"
    /// (the next one is due some time after this one is finished); a standalone
    /// one defaults to a schedule seeded from its due date.
    static func starting(
        due: Date?,
        afterDone: Bool,
        calendar: Calendar = .current
    ) -> TaskRepeatDraft {
        var draft = TaskRepeatDraft()
        if let due {
            let weekday = isoWeekday(due, calendar: calendar)
            draft.weekdays = [weekday]
            draft.nthWeekday = weekday
            draft.monthDay = calendar.component(.day, from: due)
            draft.nth = min((draft.monthDay - 1) / 7 + 1, 4)
        }
        if afterDone || due == nil {
            draft.kind = TaskRepeatKind.afterDone
            draft.unit = TaskRepeatUnit.month
        }
        return draft
    }

    /// Switch kind, moving a unit the new kind does not offer to the nearest one
    /// it does.
    mutating func setKind(_ next: String) {
        kind = next
        if !Self.units(for: next).contains(unit) { unit = TaskRepeatUnit.month }
    }

    func problem(hasDue: Bool) -> TaskRepeatProblem? {
        if kind == TaskRepeatKind.schedule && !hasDue { return .needsDue }
        if kind == TaskRepeatKind.schedule && unit == TaskRepeatUnit.week && weekdays.isEmpty {
            return .needsWeekday
        }
        return nil
    }

    /// The `repeat` object for POST /v1/tasks and PATCH /v1/tasks/:id.
    func wireBody(calendar: Calendar = .current) -> JSONValue {
        let sendUnit = Self.units(for: kind).contains(unit) ? unit : TaskRepeatUnit.month
        var object: [String: JSONValue] = [
            "kind": .string(kind),
            "unit": .string(sendUnit),
            "every": .number(Double(min(max(every, 1), 99))),
            "paused": .bool(paused),
        ]
        if kind == TaskRepeatKind.schedule {
            if sendUnit == TaskRepeatUnit.week {
                object["weekdays"] = .array(
                    Array(Set(weekdays)).sorted().map { .number(Double($0)) }
                )
            }
            if sendUnit == TaskRepeatUnit.month {
                switch monthMode {
                case .day:
                    object["month_day"] = .number(Double(min(max(monthDay, 1), 31)))
                case .nth:
                    object["nth"] = .number(Double(nth))
                    object["nth_weekday"] = .number(Double(nthWeekday))
                }
            }
        }
        switch endsKind {
        case "on":
            object["ends"] = .object([
                "kind": .string("on"),
                "on": .string(Self.dayString(endsOn, calendar: calendar)),
            ])
        case "after":
            object["ends"] = .object([
                "kind": .string("after"),
                "after": .number(Double(max(endsAfter, 1))),
            ])
        default:
            object["ends"] = .object(["kind": .string("never")])
        }
        return .object(object)
    }

    /// This draft as the rule the server would send back, so the one summary
    /// function words both.
    func asRule() -> TaskRepeatRule {
        let sendUnit = Self.units(for: kind).contains(unit) ? unit : TaskRepeatUnit.month
        let isSchedule = kind == TaskRepeatKind.schedule
        let ends: TaskRepeatEnds
        switch endsKind {
        case "on":
            ends = TaskRepeatEnds(kind: "on", on: Self.dayString(endsOn), after: nil)
        case "after":
            ends = TaskRepeatEnds(kind: "after", on: nil, after: max(endsAfter, 1))
        default:
            ends = TaskRepeatEnds(kind: "never", on: nil, after: nil)
        }
        return TaskRepeatRule(
            kind: kind,
            unit: sendUnit,
            every: min(max(every, 1), 99),
            weekdays: isSchedule && sendUnit == TaskRepeatUnit.week
                ? Array(Set(weekdays)).sorted() : nil,
            month_day: isSchedule && sendUnit == TaskRepeatUnit.month && monthMode == .day
                ? monthDay : nil,
            nth: isSchedule && sendUnit == TaskRepeatUnit.month && monthMode == .nth
                ? nth : nil,
            nth_weekday: isSchedule && sendUnit == TaskRepeatUnit.month && monthMode == .nth
                ? nthWeekday : nil,
            ends: ends,
            paused: paused,
            stopped: false,
            id: nil
        )
    }

    // MARK: Dates

    /// "YYYY-MM-DD" in the Gregorian calendar and the caller's time zone, so the
    /// day a person picked is the day that is sent.
    static func dayString(_ date: Date, calendar: Calendar = .current) -> String {
        dayFormatter(calendar).string(from: date)
    }

    static func parseDay(_ text: String, calendar: Calendar = .current) -> Date? {
        dayFormatter(calendar).date(from: text)
    }

    private static func dayFormatter(_ calendar: Calendar) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = calendar.timeZone
        formatter.calendar = gregorian
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }
}

extension TaskRepeatDraft {
    /// Edit what is already there.
    init(rule: TaskRepeatRule, calendar: Calendar = .current) {
        self.init()
        kind = rule.kind
        unit = rule.unit
        every = rule.interval
        if let days = rule.weekdays, !days.isEmpty {
            weekdays = Array(Set(days)).sorted()
        }
        if let day = rule.month_day { monthDay = day }
        if let ruleNth = rule.nth, let ruleWeekday = rule.nth_weekday {
            monthMode = .nth
            nth = ruleNth
            nthWeekday = ruleWeekday
        }
        if let ends = rule.ends {
            endsKind = ends.kind
            if let on = ends.on, let date = Self.parseDay(on, calendar: calendar) {
                endsOn = date
            }
            if let after = ends.after { endsAfter = after }
        }
        paused = rule.isPaused
    }
}

/// ISO weekday (1 = Monday ... 7 = Sunday) of a date. Calendar weekdays run
/// Sunday = 1, so the shift is the same one the calendar grid uses.
func isoWeekday(_ date: Date, calendar: Calendar = .current) -> Int {
    (calendar.component(.weekday, from: date) + 5) % 7 + 1
}

// MARK: - The new-task draft

/// What the New task sheet adds beyond a title: priority, labels and a repeat.
struct TaskDraftMeta: Equatable, Sendable {
    var priority: TaskPriority = .normal
    /// Existing workspace tags, by id.
    var labelIds: [String] = []
    /// Names typed for tags that do not exist yet; created once the task is.
    var newLabelNames: [String] = []
    var repeatDraft: TaskRepeatDraft? = nil

    /// Prefix on the id of a not-yet-created label in the editor's list.
    static let pendingPrefix = "new:"

    /// Normal is what the server gives a task that says nothing, so it is not
    /// sent.
    var priorityWire: String? { priority == .normal ? nil : priority.rawValue }

    func repeatBody(calendar: Calendar = .current) -> JSONValue? {
        repeatDraft.map { $0.wireBody(calendar: calendar) }
    }

    func isValid(hasDue: Bool) -> Bool {
        repeatDraft.map { $0.problem(hasDue: hasDue) == nil } ?? true
    }

    /// Put a label on the draft: an existing tag by id, or a typed name. A name
    /// that matches an existing tag uses that tag instead of making a twin.
    mutating func addLabel(tagId: String?, name: String?, available: [Tag]) {
        if let tagId {
            if !labelIds.contains(tagId) { labelIds.append(tagId) }
            return
        }
        guard let name = name?.trimmingCharacters(in: .whitespacesAndNewlines),
              !name.isEmpty else { return }
        if let match = available.first(where: { $0.name.lowercased() == name.lowercased() }) {
            if !labelIds.contains(match.id) { labelIds.append(match.id) }
        } else if !newLabelNames.contains(where: { $0.lowercased() == name.lowercased() }) {
            newLabelNames.append(name)
        }
    }

    mutating func removeLabel(id: String) {
        if id.hasPrefix(Self.pendingPrefix) {
            let name = String(id.dropFirst(Self.pendingPrefix.count))
            newLabelNames.removeAll { $0 == name }
        } else {
            labelIds.removeAll { $0 == id }
        }
    }

    /// The labels as the editor lists them: chosen tags first, then pending names.
    func displayLabels(available: [Tag]) -> [TaskLabel] {
        let chosen = labelIds.compactMap { id -> TaskLabel? in
            guard let tag = available.first(where: { $0.id == id }) else { return nil }
            return TaskLabel(id: tag.id, name: tag.name, color: tag.color)
        }
        let pending = newLabelNames.map {
            TaskLabel(id: Self.pendingPrefix + $0, name: $0, color: nil)
        }
        return chosen + pending
    }
}
