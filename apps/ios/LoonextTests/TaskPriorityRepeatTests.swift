import XCTest
@testable import Loonext

/// #693: task priority, labels and repeating jobs on iOS. Decoding with and
/// without the new fields, the exact request bodies, the filter query, the
/// sentence a repeat reads as, which edits ask "this one or this and future",
/// and the draft the New task sheet builds. The vectors mirror the API contract
/// and the Android twin.
final class TaskPriorityRepeatTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private let en = MessageLocale.en

    private let baseTask = #"""
    "id":"t1","company_id":"c1","message_id":"m1","conversation_id":"conv1",
    "title":"Service the furnace","assigned_user_id":null,
    "due_at":"2026-07-20T15:00:00-04:00","created_by_user_id":"u1",
    "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
    "done":false,"status":"open"
    """#

    // MARK: decoding

    func testARowFromBeforeTheFeatureStillDecodesAndReadsAsNormal() throws {
        let task: TaskItem = try decode("{\(baseTask)}")
        XCTAssertNil(task.priority)
        XCTAssertEqual(task.priorityValue, .normal)
        XCTAssertEqual(task.labelList.count, 0)
        XCTAssertNil(task.repeatRule)
        XCTAssertFalse(taskShowsRepeatIcon(task.repeatRule))
        XCTAssertNil(task.series_id)
    }

    func testARowWithPriorityLabelsAndARepeatDecodes() throws {
        let task: TaskItem = try decode(#"""
        {\#(baseTask),"priority":"urgent",
         "labels":[{"id":"l1","name":"Warranty","color":null},{"id":"l2","name":"Roof","color":"#336699"}],
         "series_id":"s1","occurrence_no":3,
         "repeat":{"id":"r1","kind":"schedule","unit":"week","every":1,"weekdays":[1,4],
                   "month_day":null,"nth":null,"nth_weekday":null,
                   "ends":{"kind":"after","on":null,"after":5},"paused":false,"stopped":false}}
        """#)
        XCTAssertEqual(task.priorityValue, .urgent)
        XCTAssertEqual(task.labelList.map(\.name), ["Warranty", "Roof"])
        XCTAssertNil(task.labelList.first?.color)
        XCTAssertEqual(task.occurrence_no, 3)
        let rule = try XCTUnwrap(task.repeatRule)
        XCTAssertEqual(rule.kind, "schedule")
        XCTAssertEqual(rule.weekdays, [1, 4])
        XCTAssertEqual(rule.ends?.kind, "after")
        XCTAssertEqual(rule.ends?.after, 5)
        XCTAssertTrue(taskShowsRepeatIcon(rule))
    }

    func testAnUnknownPriorityWordReadsAsNormalRatherThanFailing() throws {
        let task: TaskItem = try decode(#"""
        {\#(baseTask),"priority":"critical"}
        """#)
        XCTAssertEqual(task.priorityValue, .normal)
    }

    func testTheDetailAndThePatchRowCarryTheSameFields() throws {
        let detail: TaskDetail = try decode(#"""
        {\#(baseTask),"description":"","assignee":null,"created_by":null,"source_message":null,
         "priority":"low","labels":[],"repeat":{"kind":"after_done","unit":"month","every":6}}
        """#)
        XCTAssertEqual(detail.priorityValue, .low)
        XCTAssertEqual(detail.repeatRule?.isAfterDone, true)
        XCTAssertEqual(detail.repeatRule?.interval, 6)

        let row: TaskRowPatch = try decode(#"""
        {"id":"t1","title":"x","assigned_user_id":null,"due_at":null,
         "updated_at":"2026-07-01T00:00:00Z","priority":"high","repeat":null}
        """#)
        XCTAssertEqual(row.priority, "high")
        XCTAssertNil(row.`repeat`)
    }

    func testAStoppedRepeatShowsNoIconButANeedsNoScopeEither() {
        let stopped = TaskRepeatRule(kind: "schedule", unit: "day", stopped: true)
        XCTAssertFalse(taskShowsRepeatIcon(stopped))
        XCTAssertFalse(taskNeedsScope(stopped))
        let live = TaskRepeatRule(kind: "schedule", unit: "day", paused: true)
        XCTAssertTrue(taskShowsRepeatIcon(live))
        XCTAssertTrue(taskNeedsScope(live))
        XCTAssertFalse(taskNeedsScope(nil))
    }

    func testTheTimelineEntryCarriesTheRepeatWhenThereIsOne() throws {
        let plain: TimelineEntry = try decode(#"""
        {"kind":"task","id":"a","occurred_at":"2026-07-01T00:00:00Z","conversation_id":null,
         "status":null,"detail":"Job","talk_seconds":null,"due_at":null,"done":false,
         "answered_by_user_id":null}
        """#)
        XCTAssertNil(plain.repeatRule)
        XCTAssertFalse(timelineShowsRepeatIcon(plain.repeatRule))

        let repeating: TimelineEntry = try decode(#"""
        {"kind":"task","id":"b","occurred_at":"2026-07-01T00:00:00Z","conversation_id":null,
         "status":null,"detail":"Job","talk_seconds":null,"due_at":null,"done":false,
         "answered_by_user_id":null,"series_id":"s1",
         "repeat":{"kind":"schedule","unit":"month","every":1,"paused":false,"stopped":false}}
        """#)
        XCTAssertEqual(repeating.series_id, "s1")
        XCTAssertTrue(timelineShowsRepeatIcon(repeating.repeatRule))

        let ended: TimelineEntry = try decode(#"""
        {"kind":"task","id":"c","occurred_at":"2026-07-01T00:00:00Z","conversation_id":null,
         "status":null,"detail":"Job","talk_seconds":null,"due_at":null,"done":true,
         "answered_by_user_id":null,
         "repeat":{"kind":"schedule","unit":"month","every":1,"paused":false,"stopped":true}}
        """#)
        XCTAssertFalse(timelineShowsRepeatIcon(ended.repeatRule))
    }

    // MARK: request bodies

    func testCreateBodyOmitsTheDefaultsAndCarriesTheNewFields() {
        let plain = taskCreateBody(
            messageId: nil, title: "T", assignedUserId: nil, dueAt: nil
        )
        XCTAssertEqual(plain, .object(["title": .string("T")]))

        let rich = taskCreateBody(
            messageId: nil,
            title: "T",
            assignedUserId: nil,
            dueAt: "2026-07-20T15:00:00-04:00",
            priority: "high",
            labelIds: ["l1", "l2"],
            repeatRule: .object(["kind": .string("schedule"), "unit": .string("day")])
        )
        XCTAssertEqual(
            rich,
            .object([
                "title": .string("T"),
                "due_at": .string("2026-07-20T15:00:00-04:00"),
                "priority": .string("high"),
                "label_ids": .array([.string("l1"), .string("l2")]),
                "repeat": .object(["kind": .string("schedule"), "unit": .string("day")]),
            ])
        )
    }

    func testScopeRidesAPatchOnlyWhenOneIsGiven() {
        XCTAssertEqual(
            taskScoped(taskRenameBody("x"), scope: nil),
            .object(["title": .string("x")])
        )
        XCTAssertEqual(
            taskScoped(taskRenameBody("x"), scope: TaskScope.future),
            .object(["title": .string("x"), "scope": .string("future")])
        )
        XCTAssertEqual(
            taskScoped(taskDueBody(nil), scope: TaskScope.this),
            .object(["due_at": .null, "scope": .string("this")])
        )
    }

    func testPriorityAndRepeatPatchBodies() {
        XCTAssertEqual(taskPriorityBody(.urgent), .object(["priority": .string("urgent")]))
        XCTAssertEqual(taskPriorityBody(TaskPriority.none), .object(["priority": .string("none")]))
        // Stopping a repeat is an explicit null, not a missing key.
        XCTAssertEqual(taskRepeatPatchBody(nil), .object(["repeat": .null]))
        XCTAssertEqual(
            taskRepeatPatchBody(.object(["kind": .string("after_done")])),
            .object(["repeat": .object(["kind": .string("after_done")])])
        )
    }

    func testTagBodiesSendAnIdOrANameNeverBoth() {
        XCTAssertEqual(
            taskTagAddBody(tagId: "t9", name: "ignored", scope: nil),
            .object(["tag_id": .string("t9")])
        )
        XCTAssertEqual(
            taskTagAddBody(tagId: nil, name: "Warranty", scope: TaskScope.future),
            .object(["name": .string("Warranty"), "scope": .string("future")])
        )
    }

    func testBulkBodiesForPriorityAndLabels() {
        XCTAssertEqual(
            taskBulkBody(
                action: "set_priority", ids: ["a", "b"], filters: nil,
                targetUserId: nil, unassign: false, priority: "high"
            ),
            .object([
                "action": .string("set_priority"),
                "ids": .array([.string("a"), .string("b")]),
                "priority": .string("high"),
            ])
        )
        XCTAssertEqual(
            taskBulkBody(
                action: "add_label", ids: ["a"], filters: nil,
                targetUserId: nil, unassign: false, tagId: "t1"
            ),
            .object([
                "action": .string("add_label"),
                "ids": .array([.string("a")]),
                "tag_id": .string("t1"),
            ])
        )
    }

    func testABulkFilterCarriesThePriorityAndLabelFilters() {
        let filters = TaskListFilters(
            status: "open", assignedUserId: "me", priority: ["urgent", "high"], tagId: "t1"
        )
        XCTAssertEqual(
            taskBulkBody(
                action: "remove_label", ids: nil, filters: filters,
                targetUserId: nil, unassign: false, tagId: "t2"
            ),
            .object([
                "action": .string("remove_label"),
                "filter": .object([
                    "status": .string("open"),
                    "assigned_user_id": .string("me"),
                    "priority": .array([.string("urgent"), .string("high")]),
                    "tag_id": .string("t1"),
                ]),
                "tag_id": .string("t2"),
            ])
        )
    }

    func testTheOldBulkShapesAreUnchanged() {
        XCTAssertEqual(
            taskBulkBody(
                action: "assign", ids: ["a"], filters: nil, targetUserId: nil, unassign: true
            ),
            .object([
                "action": .string("assign"),
                "ids": .array([.string("a")]),
                "target_user_id": .null,
            ])
        )
    }

    // MARK: filters

    private func sent(_ filters: TaskListFilters) -> [String: String] {
        taskQueryParams(filters).compactMapValues { $0 }
    }

    func testPriorityLabelAndSortReachTheQuery() {
        let params = sent(
            TaskListFilters(
                status: "open", assignedUserId: "me",
                priority: ["urgent", "high"], tagId: "t1", sort: "priority"
            )
        )
        XCTAssertEqual(params["priority"], "urgent,high")
        XCTAssertEqual(params["tag_id"], "t1")
        XCTAssertEqual(params["sort"], "priority")
    }

    func testTheDefaultSortAndNoFilterSendNothingExtra() {
        XCTAssertEqual(sent(TaskListFilters()), ["limit": "25"])
        XCTAssertNil(sent(TaskListFilters(sort: "created"))["sort"])
        XCTAssertEqual(sent(TaskListFilters(sort: "due"))["sort"], "due")
    }

    func testAPriorityFilterIsAnExplicitParamSoAllNeedsNoSentinel() {
        // "All" with a priority filter already opts out of the Open-Mine default.
        let params = sent(TaskListFilters(assignedUserId: assigneeAll, priority: ["high"]))
        XCTAssertNil(params["status"])
        XCTAssertNil(params["assigned_user_id"])
        XCTAssertEqual(params["priority"], "high")
        let byLabel = sent(TaskListFilters(assignedUserId: assigneeAll, tagId: "t1"))
        XCTAssertNil(byLabel["status"])
    }

    func testAPrioritySortMintsItsOwnCursorOrdering() {
        XCTAssertEqual(orderingKey(TaskListFilters(sort: "priority")), "priority")
        XCTAssertEqual(orderingKey(TaskListFilters(sort: "due")), "due")
        XCTAssertEqual(orderingKey(TaskListFilters()), "created")
    }

    func testTheMetaFiltersRideEveryArm() {
        let meta = TaskMetaFilters(priority: ["urgent"], tagId: "t1", sort: "priority")
        XCTAssertTrue(meta.hasFilter)
        XCTAssertFalse(TaskMetaFilters(sort: "due").hasFilter)
        let arms = taskListArms(
            tab: .mine, assigneeUserId: nil, unassigned: false, due: nil, q: nil, meta: meta
        )
        XCTAssertEqual(arms.count, 2)
        for arm in arms {
            XCTAssertEqual(arm.priority, ["urgent"])
            XCTAssertEqual(arm.tagId, "t1")
            XCTAssertEqual(arm.sort, "priority")
        }
        // Without meta the arms are what they always were.
        XCTAssertEqual(
            taskListArms(tab: .open, assigneeUserId: nil, unassigned: false, due: nil, q: nil),
            [TaskListFilters(status: "open", assignedUserId: assigneeMe)]
        )
    }

    func testTheMetaTokenChangesWhenAnyPartDoes() {
        let base = TaskMetaFilters()
        XCTAssertNotEqual(base.token, TaskMetaFilters(priority: ["high"]).token)
        XCTAssertNotEqual(base.token, TaskMetaFilters(tagId: "t1").token)
        XCTAssertNotEqual(base.token, TaskMetaFilters(sort: "due").token)
        XCTAssertEqual(
            TaskMetaFilters(priority: ["a", "b"]).token,
            TaskMetaFilters(priority: ["b", "a"]).token
        )
    }

    // MARK: priority

    func testOnlyHighAndUrgentEarnAMark() {
        XCTAssertEqual(TaskPriority.allCases.filter(\.isFlagged), [.high, .urgent])
        XCTAssertEqual(TaskPriority.rankedForMenus, [.urgent, .high, .normal, .low])
        XCTAssertEqual(TaskPriority.from(nil), .normal)
        XCTAssertEqual(TaskPriority.from("none"), TaskPriority.none)
    }

    func testPriorityWordsAreInBothLanguages() {
        XCTAssertEqual(AppStrings.translate(en, TaskPriority.urgent.labelKey), "Urgent")
        XCTAssertEqual(AppStrings.translate(MessageLocale.frCA, TaskPriority.urgent.labelKey), "Urgente")
    }

    // MARK: summary text

    private func rule(
        _ kind: String,
        _ unit: String,
        every: Int? = nil,
        weekdays: [Int]? = nil,
        monthDay: Int? = nil,
        nth: Int? = nil,
        nthWeekday: Int? = nil
    ) -> TaskRepeatRule {
        TaskRepeatRule(
            kind: kind, unit: unit, every: every, weekdays: weekdays,
            month_day: monthDay, nth: nth, nth_weekday: nthWeekday
        )
    }

    func testScheduleSummaries() {
        XCTAssertEqual(taskRepeatSummary(rule("schedule", "day"), locale: en), "Repeats every day")
        XCTAssertEqual(
            taskRepeatSummary(rule("schedule", "day", every: 3), locale: en),
            "Repeats every 3 days"
        )
        XCTAssertEqual(
            taskRepeatSummary(rule("schedule", "week", every: 1, weekdays: [1]), locale: en),
            "Repeats every Monday"
        )
        XCTAssertEqual(
            taskRepeatSummary(rule("schedule", "week", every: 1, weekdays: [5, 1, 3]), locale: en),
            "Repeats every Monday, Wednesday and Friday"
        )
        XCTAssertEqual(
            taskRepeatSummary(rule("schedule", "week", every: 2, weekdays: [2, 4]), locale: en),
            "Repeats every 2 weeks on Tuesday and Thursday"
        )
        XCTAssertEqual(
            taskRepeatSummary(rule("schedule", "month", every: 1, monthDay: 15), locale: en),
            "Repeats on day 15 of every month"
        )
        XCTAssertEqual(
            taskRepeatSummary(
                rule("schedule", "month", every: 3, nth: -1, nthWeekday: 5), locale: en
            ),
            "Repeats on the last Friday every 3 months"
        )
        XCTAssertEqual(
            taskRepeatSummary(rule("schedule", "year"), locale: en),
            "Repeats every year"
        )
    }

    func testAfterDoneSummaries() {
        XCTAssertEqual(
            taskRepeatSummary(rule("after_done", "month", every: 6), locale: en),
            "Repeats 6 months after it's done"
        )
        XCTAssertEqual(
            taskRepeatSummary(rule("after_done", "week", every: 1), locale: en),
            "Repeats 1 week after it's done"
        )
        XCTAssertEqual(
            taskRepeatSummary(rule("after_done", "day", every: 10), locale: en),
            "Repeats 10 days after it's done"
        )
    }

    func testTheDetailLineAddsTheEndAndThePause() {
        var withEnd = rule("schedule", "week", every: 1, weekdays: [1])
        withEnd.ends = TaskRepeatEnds(kind: "after", on: nil, after: 5)
        withEnd.paused = true
        XCTAssertEqual(
            taskRepeatDetailLine(withEnd, locale: en),
            "Repeats every Monday \u{00B7} 5 times \u{00B7} Paused"
        )
        var untilDate = rule("schedule", "day")
        untilDate.ends = TaskRepeatEnds(kind: "on", on: "2026-12-01", after: nil)
        XCTAssertEqual(
            taskRepeatDetailLine(untilDate, locale: en),
            "Repeats every day \u{00B7} until 2026-12-01"
        )
        var never = rule("schedule", "day")
        never.ends = TaskRepeatEnds(kind: "never", on: nil, after: nil)
        XCTAssertEqual(taskRepeatDetailLine(never, locale: en), "Repeats every day")
    }

    func testTheFrenchSummaryIsFrench() {
        XCTAssertEqual(
            taskRepeatSummary(
                rule("after_done", "month", every: 6), locale: MessageLocale.frCA
            ),
            "Se répète 6 mois après avoir été terminée"
        )
    }

    // MARK: the repeat draft

    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        return calendar
    }

    private func date(_ iso: String) throws -> Date {
        try XCTUnwrap(ISO8601DateFormatter().date(from: iso))
    }

    func testIsoWeekdayRunsMondayToSunday() throws {
        // 2026-07-20 is a Monday; 2026-07-26 is a Sunday.
        XCTAssertEqual(isoWeekday(try date("2026-07-20T12:00:00Z"), calendar: utc), 1)
        XCTAssertEqual(isoWeekday(try date("2026-07-23T12:00:00Z"), calendar: utc), 4)
        XCTAssertEqual(isoWeekday(try date("2026-07-26T12:00:00Z"), calendar: utc), 7)
    }

    func testAWeeklyScheduleBody() {
        var draft = TaskRepeatDraft()
        draft.kind = TaskRepeatKind.schedule
        draft.unit = TaskRepeatUnit.week
        draft.every = 2
        draft.weekdays = [4, 1, 1]
        XCTAssertEqual(
            draft.wireBody(calendar: utc),
            .object([
                "kind": .string("schedule"),
                "unit": .string("week"),
                "every": .number(2),
                "paused": .bool(false),
                "weekdays": .array([.number(1), .number(4)]),
                "ends": .object(["kind": .string("never")]),
            ])
        )
    }

    func testAMonthlyScheduleOnADayAndOnANthWeekday() {
        var byDay = TaskRepeatDraft()
        byDay.unit = TaskRepeatUnit.month
        byDay.monthMode = .day
        byDay.monthDay = 15
        let dayBody = byDay.wireBody(calendar: utc)
        XCTAssertEqual(dayBody["month_day"], .number(15))
        XCTAssertNil(dayBody["nth"])
        XCTAssertNil(dayBody["weekdays"])

        var byNth = TaskRepeatDraft()
        byNth.unit = TaskRepeatUnit.month
        byNth.monthMode = .nth
        byNth.nth = -1
        byNth.nthWeekday = 5
        let nthBody = byNth.wireBody(calendar: utc)
        XCTAssertEqual(nthBody["nth"], .number(-1))
        XCTAssertEqual(nthBody["nth_weekday"], .number(5))
        XCTAssertNil(nthBody["month_day"])
    }

    func testAfterDoneSendsNoScheduleDetailAndNeverAYear() {
        var draft = TaskRepeatDraft()
        draft.unit = TaskRepeatUnit.year
        draft.weekdays = [1, 2]
        draft.setKind(TaskRepeatKind.afterDone)
        // A year is not offered after it's done, so it moves to months.
        XCTAssertEqual(draft.unit, TaskRepeatUnit.month)
        draft.every = 6
        XCTAssertEqual(
            draft.wireBody(calendar: utc),
            .object([
                "kind": .string("after_done"),
                "unit": .string("month"),
                "every": .number(6),
                "paused": .bool(false),
                "ends": .object(["kind": .string("never")]),
            ])
        )
    }

    func testEndsOnADateAndAfterNTimes() throws {
        var onDate = TaskRepeatDraft()
        onDate.endsKind = "on"
        onDate.endsOn = try date("2026-12-01T12:00:00Z")
        XCTAssertEqual(
            onDate.wireBody(calendar: utc)["ends"],
            .object(["kind": .string("on"), "on": .string("2026-12-01")])
        )
        var afterN = TaskRepeatDraft()
        afterN.endsKind = "after"
        afterN.endsAfter = 4
        XCTAssertEqual(
            afterN.wireBody(calendar: utc)["ends"],
            .object(["kind": .string("after"), "after": .number(4)])
        )
    }

    func testAScheduleNeedsADueDateAndAWeeklyOneNeedsADay() {
        var draft = TaskRepeatDraft()
        XCTAssertEqual(draft.problem(hasDue: false), .needsDue)
        XCTAssertNil(draft.problem(hasDue: true))
        draft.weekdays = []
        XCTAssertEqual(draft.problem(hasDue: true), .needsWeekday)
        draft.setKind(TaskRepeatKind.afterDone)
        XCTAssertNil(draft.problem(hasDue: false))
    }

    func testAFreshDraftSeedsFromTheDueDateAndDefaultsByLink() throws {
        // Monday 20 July 2026: the 20th is the third Monday.
        let due = try date("2026-07-20T12:00:00Z")
        let standalone = TaskRepeatDraft.starting(due: due, afterDone: false, calendar: utc)
        XCTAssertEqual(standalone.kind, TaskRepeatKind.schedule)
        XCTAssertEqual(standalone.weekdays, [1])
        XCTAssertEqual(standalone.monthDay, 20)
        XCTAssertEqual(standalone.nth, 3)
        XCTAssertEqual(standalone.nthWeekday, 1)

        let linked = TaskRepeatDraft.starting(due: due, afterDone: true, calendar: utc)
        XCTAssertEqual(linked.kind, TaskRepeatKind.afterDone)

        // No date: a schedule is impossible, so it starts after-done.
        let undated = TaskRepeatDraft.starting(due: nil, afterDone: false, calendar: utc)
        XCTAssertEqual(undated.kind, TaskRepeatKind.afterDone)
    }

    func testEditingAnExistingRuleRoundTripsThroughTheDraft() {
        var existing = rule("schedule", "month", every: 2, nth: 2, nthWeekday: 3)
        existing.ends = TaskRepeatEnds(kind: "after", on: nil, after: 7)
        existing.paused = true
        let draft = TaskRepeatDraft(rule: existing, calendar: utc)
        XCTAssertEqual(draft.monthMode, .nth)
        XCTAssertEqual(draft.nth, 2)
        XCTAssertEqual(draft.nthWeekday, 3)
        XCTAssertEqual(draft.every, 2)
        XCTAssertEqual(draft.endsKind, "after")
        XCTAssertEqual(draft.endsAfter, 7)
        XCTAssertTrue(draft.paused)
        // The rule the draft describes reads the same as the one it came from.
        XCTAssertEqual(
            taskRepeatSummary(draft.asRule(), locale: en),
            taskRepeatSummary(existing, locale: en)
        )
    }

    // MARK: the New task draft

    private func tag(_ id: String, _ name: String) -> Tag {
        Tag(id: id, name: name, color: nil, created_at: nil, updated_at: nil)
    }

    func testNormalPriorityIsNotSent() {
        var meta = TaskDraftMeta()
        XCTAssertNil(meta.priorityWire)
        meta.priority = .high
        XCTAssertEqual(meta.priorityWire, "high")
        meta.priority = TaskPriority.none
        XCTAssertEqual(meta.priorityWire, "none")
    }

    func testLabelsByIdAndByNameAreKeptApart() {
        let available = [tag("t1", "Warranty"), tag("t2", "Roof")]
        var meta = TaskDraftMeta()
        meta.addLabel(tagId: "t1", name: nil, available: available)
        meta.addLabel(tagId: "t1", name: nil, available: available)
        meta.addLabel(tagId: nil, name: "  Urgent callback ", available: available)
        // A typed name that matches an existing tag uses it instead of a twin.
        meta.addLabel(tagId: nil, name: "roof", available: available)
        XCTAssertEqual(meta.labelIds, ["t1", "t2"])
        XCTAssertEqual(meta.newLabelNames, ["Urgent callback"])
        XCTAssertEqual(
            meta.displayLabels(available: available).map(\.name),
            ["Warranty", "Roof", "Urgent callback"]
        )
        meta.removeLabel(id: "t1")
        meta.removeLabel(id: TaskDraftMeta.pendingPrefix + "Urgent callback")
        XCTAssertEqual(meta.labelIds, ["t2"])
        XCTAssertEqual(meta.newLabelNames, [])
    }

    func testTheDraftIsInvalidOnlyWhenItsRepeatIs() {
        var meta = TaskDraftMeta()
        XCTAssertTrue(meta.isValid(hasDue: false))
        meta.repeatDraft = TaskRepeatDraft()
        XCTAssertFalse(meta.isValid(hasDue: false))
        XCTAssertTrue(meta.isValid(hasDue: true))
        XCTAssertNotNil(meta.repeatBody(calendar: utc))
        meta.repeatDraft = nil
        XCTAssertNil(meta.repeatBody(calendar: utc))
    }

    // MARK: activity lines

    private func event(_ kind: String, from: JSONValue? = nil, to: JSONValue? = nil) -> TaskFeedItem {
        TaskFeedItem(
            kind: "event", id: "e1", created_at: "2026-11-10T12:00:00Z", event: kind,
            from: from, to: to, from_user: nil, to_user: nil, actor: nil,
            body: nil, author: nil, edited_at: nil, attachments: nil
        )
    }

    func testPriorityLabelAndRepeatEventsReadAsSentences() {
        XCTAssertEqual(
            taskHistorySentence(event("priority", to: "urgent"), by: "Sam", locale: en),
            "Sam set the priority to Urgent"
        )
        XCTAssertEqual(
            taskHistorySentence(
                event("label_added", to: ["tag_id": "t1", "name": "Warranty"]),
                by: "Sam", locale: en
            ),
            "Sam added the label Warranty"
        )
        XCTAssertEqual(
            taskHistorySentence(
                event("label_removed", from: ["tag_id": "t1", "name": "Warranty"]),
                by: "Sam", locale: en
            ),
            "Sam removed the label Warranty"
        )
        XCTAssertEqual(
            taskHistorySentence(
                event("repeat", to: ["kind": "after_done", "unit": "month", "every": 6]),
                by: "Sam", locale: en
            ),
            "Sam set this to repeat: Repeats 6 months after it's done"
        )
        XCTAssertEqual(
            taskHistorySentence(event("repeat", from: ["kind": "schedule"], to: nil), by: "Sam", locale: en),
            "Sam stopped this repeating"
        )
    }

    func testAnEventWithNothingUsableFallsBackToUpdated() {
        XCTAssertEqual(
            taskHistorySentence(event("label_added", to: ["tag_id": "t1"]), by: "Sam", locale: en),
            "Sam updated this task"
        )
        XCTAssertEqual(
            taskHistorySentence(event("repeat", to: ["note": "x"]), by: "Sam", locale: en),
            "Sam updated this task"
        )
    }
}
