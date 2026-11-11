import XCTest
@testable import Loonext

/// #714 / #725: the vectors of `apps/web/src/components/activity/activity-line.test.ts`
/// and `activity-timeline.test.tsx`, so the phone reads one event the way the
/// web does. Mirrors `ActivityLineTest.kt`.
final class ActivityLineTests: XCTestCase {
    private let fr = MessageLocale.frCA
    private let names: [String: String] = ["u1": "Sam Ortiz", "u2": "Ana Lee"]

    private func nameOf(_ id: String?) -> String? {
        guard let id else { return nil }
        return names[id]
    }

    private func item(
        _ kind: String,
        _ payload: [String: JSONValue] = [:],
        category: String = "change",
        source: ActivitySource? = nil,
        actor: ActivityActor = ActivityActor(type: "member", user_id: "u1", display_name: "Sam Ortiz")
    ) -> ActivityItem {
        ActivityItem(
            id: "id-\(kind)",
            kind: kind,
            category: category,
            occurred_at: "2026-11-10T15:00:00.000Z",
            actor: actor,
            payload: payload,
            source: source
        )
    }

    private func step(_ kind: String, _ payload: [String: JSONValue] = [:]) -> ActivityItem {
        item(kind, payload, category: "call", source: ActivitySource(type: "call", id: "call-1"))
    }

    private func say(
        _ item: ActivityItem,
        _ locale: String? = nil,
        type: ActivityRecordType = .contact,
        recordId: String = "c1"
    ) -> String {
        activityLine(
            item, recordType: type, recordId: recordId, nameOf: nameOf, locale: locale
        ).text
    }

    private let callSteps = [
        "call_arrived", "call_placed", "call_rang", "call_declined",
        "call_answered", "call_voicemail", "call_ended",
    ]

    func testEveryCallStepKindHasItsOwnSentenceInBothLanguages() {
        let unknownEn = AppStrings.translate(nil, "activity.unknownKind")
        let unknownFr = AppStrings.translate(fr, "activity.unknownKind")
        for kind in callSteps {
            XCTAssertNotEqual(say(step(kind)), unknownEn, kind)
            XCTAssertNotEqual(say(step(kind), fr), unknownFr, kind)
        }
    }

    func testNamesWhosePhonesRangAndWhoAskedToBeRung() {
        XCTAssertEqual(
            say(step("call_rang", ["user_ids": ["u1", "u2"]])),
            "Rang Sam Ortiz, Ana Lee"
        )
        XCTAssertEqual(
            say(step("call_rang", ["user_ids": ["u2"], "asked": true])),
            "Ana Lee asked to be rung"
        )
        XCTAssertEqual(say(step("call_rang", ["user_ids": ["nobody"]])), "Rang someone")
    }

    func testSaysWhyItCameInAndWhyItWentToVoicemail() {
        XCTAssertEqual(say(step("call_arrived", ["routing": "rang"])), "Call came in")
        XCTAssertEqual(
            say(step("call_arrived", ["routing": "after_hours"])),
            "Call came in · " + AppStrings.translate(nil, "shell.callRoutingAfterHours")
        )
        XCTAssertEqual(
            say(step("call_voicemail", ["cause": "no_answer_in_time"])),
            "Went to voicemail · " + AppStrings.translate(nil, "shell.callEndedNoAnswerInTime")
        )
        XCTAssertEqual(
            say(step("call_voicemail", ["cause": "after_hours"])),
            "Went to voicemail · " + AppStrings.translate(nil, "shell.callRoutingAfterHours")
        )
        XCTAssertEqual(say(step("call_voicemail", ["cause": .null])), "Went to voicemail")
    }

    func testSaysHowLongTheCallLastedAndWhyItEnded() {
        XCTAssertEqual(
            say(step("call_ended", ["reason": "caller_hung_up", "seconds": 12])),
            "Call ended · after 12s · " + AppStrings.translate(nil, "shell.callEndedCallerHungUp")
        )
        XCTAssertEqual(
            say(step("call_ended", ["reason": "answered", "seconds": 0])),
            "Call ended"
        )
    }

    func testAnAutomatedTextSaysWhichAutomationSentIt() {
        func text(_ payload: [String: JSONValue]) -> ActivityItem {
            item("text_out", payload, category: "message")
        }
        XCTAssertEqual(
            say(text(["automated": true, "automation": "missed_call_text"])),
            "Text sent automatically · Missed-call text"
        )
        XCTAssertEqual(
            say(text(["automated": true, "automation": .null])),
            "Text sent automatically"
        )
        XCTAssertEqual(say(text(["automated": false])), "Text sent")
        XCTAssertEqual(
            say(text(["automated": true, "automation": "missed_call_text"]), fr),
            "Texto envoyé automatiquement · Texto d’appel manqué"
        )
    }

    func testSaysACallWithItsDirectionOutcomeTalkTimeAndWhyItEnded() {
        let line = say(
            item(
                "call",
                [
                    "direction": "inbound", "outcome": "missed", "talk_seconds": 0,
                    "ended_reason": "no_answer_in_time",
                ],
                category: "call"
            )
        )
        XCTAssertTrue(line.contains("Incoming call, not answered"), line)
        XCTAssertEqual(line.components(separatedBy: " · ").count, 2)
    }

    func testSaysAnEditWithTheFieldBeforeAndAfter() {
        XCTAssertEqual(
            say(item("edited", ["field": "name", "from": "Jane", "to": "Jane Doe"])),
            "Changed name from Jane to Jane Doe"
        )
    }

    func testSaysAClearedFieldAndABoolean() {
        XCTAssertEqual(
            say(item("edited", ["field": "email", "from": "a@b.co", "to": .null])),
            "Cleared email (was a@b.co)"
        )
        XCTAssertEqual(
            say(item("edited", ["field": "spam", "to": true])),
            "Set spam flag to yes"
        )
    }

    func testNamesTheTeammateInAnAssignmentAndAMentionAndFallsBackForOneWhoLeft() {
        XCTAssertEqual(say(item("assigned", ["to_user_id": "u1"])), "Assigned to Sam Ortiz")
        XCTAssertEqual(say(item("mentioned", ["user_id": "gone"])), "Mentioned someone")
        XCTAssertEqual(say(item("unassigned")), "Unassigned")
    }

    func testSaysHowAnOptOutHappened() {
        XCTAssertEqual(
            say(item("opted_out", ["source": "stop_keyword"])), "Opted out by texting STOP"
        )
        XCTAssertEqual(
            say(item("opted_out", ["source": "manual"])), "Opted out by a teammate"
        )
        XCTAssertEqual(say(item("opted_out")), "Opted out")
    }

    func testLinksATextToItsMessageInItsThreadAndAJobToTheJob() {
        let text = activityLine(
            item(
                "text_in", category: "message",
                source: ActivitySource(type: "message", id: "m1", conversation_id: "conv-1")
            ),
            recordType: .contact, recordId: "c1", nameOf: nameOf
        )
        XCTAssertEqual(text.open, .thread(conversationId: "conv-1", messageId: "m1"))
        let task = activityLine(
            item(
                "task_created", ["title": "Fix tap"],
                source: ActivitySource(type: "task", id: "t1")
            ),
            recordType: .contact, recordId: "c1", nameOf: nameOf
        )
        XCTAssertEqual(task.open, .task(taskId: "t1"))
        XCTAssertEqual(task.text, "Job created: Fix tap")
    }

    func testDoesNotLinkAJobsOwnEventsBackToTheJob() {
        let line = activityLine(
            item("created", source: ActivitySource(type: "task", id: "t1")),
            recordType: .task, recordId: "t1", nameOf: nameOf
        )
        XCTAssertNil(line.open)
    }

    func testSpeaksFrenchForEveryKindItKnows() {
        let kinds = [
            "text_in", "text_out", "scheduled_queued", "scheduled_sent", "scheduled_cancelled",
            "call", "voicemail", "created", "edited", "tagged", "untagged", "merged", "unmerged",
            "deleted", "restored", "assigned", "unassigned", "mentioned", "referenced",
            "opted_out", "opted_in", "blocked", "unblocked", "task_created", "task_completed",
            "completed", "reopened",
        ] + callSteps
        let unknown = AppStrings.translate(nil, "activity.unknownKind")
        for kind in kinds {
            XCTAssertNotEqual(say(item(kind), fr), "", kind)
            XCTAssertNotEqual(say(item(kind)), unknown, kind)
        }
    }

    func testTheCatalogueHasTheSameActivityKeysInBothLanguages() {
        let english = Set(AppStrings.en.keys.filter { $0.hasPrefix("activity.") })
        let french = Set(AppStrings.frCA.keys.filter { $0.hasPrefix("activity.") })
        XCTAssertEqual(english, french)
        XCTAssertGreaterThan(english.count, 100)
    }

    func testWhoDidIt() {
        XCTAssertEqual(activityActor(item("created"), nameOf: nameOf), "Sam Ortiz")
        XCTAssertEqual(
            activityActor(
                item("created", actor: ActivityActor(type: "member", user_id: "u2")),
                nameOf: nameOf
            ),
            "Ana Lee"
        )
        XCTAssertEqual(
            activityActor(
                item("created", actor: ActivityActor(type: "member", user_id: "gone")),
                nameOf: nameOf
            ),
            "A teammate"
        )
        XCTAssertEqual(
            activityActor(item("text_in", actor: ActivityActor(type: "customer")), nameOf: nameOf),
            "The customer"
        )
        XCTAssertEqual(
            activityActor(item("text_out", actor: ActivityActor(type: "automation")), nameOf: nameOf),
            "Automation"
        )
        XCTAssertEqual(
            activityActor(item("call_arrived", actor: ActivityActor(type: "system")), nameOf: nameOf),
            "Loonext"
        )
    }

    func testTheFourPathsAndTheFourFilters() {
        XCTAssertEqual(ActivityRecordType.contact.path("x"), "/v1/contacts/x/activity")
        XCTAssertEqual(ActivityRecordType.conversation.path("x"), "/v1/conversations/x/activity")
        XCTAssertEqual(ActivityRecordType.call.path("x"), "/v1/calls/x/activity")
        XCTAssertEqual(ActivityRecordType.task.path("x"), "/v1/tasks/x/record-activity")
        XCTAssertEqual(
            activityFilterOptions.map { AppStrings.translate(nil, $0.labelKey) },
            ["All", "Messages", "Calls", "Changes"]
        )
        XCTAssertEqual(
            activityFilterOptions.map { $0.category?.rawValue },
            [nil, "message", "call", "change"]
        )
    }

    func testKeepsTheOrderGivenAndGroupsByLocalCalendarDay() {
        func at(_ iso: String) -> ActivityItem {
            ActivityItem(
                id: iso, kind: "created", category: "change", occurred_at: iso,
                actor: ActivityActor(type: "system"), payload: [:]
            )
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
        let groups = groupActivityByDay(
            [at("2026-11-10T20:00:00Z"), at("2026-11-10T08:00:00Z"), at("2026-11-09T08:00:00Z")],
            calendar: calendar
        )
        XCTAssertEqual(groups.map(\.id), ["2026-11-10", "2026-11-09"])
        XCTAssertEqual(groups[0].items.count, 2)
        var west = Calendar(identifier: .gregorian)
        west.timeZone = TimeZone(secondsFromGMT: -8 * 3600) ?? .current
        let evening = groupActivityByDay([at("2026-11-10T03:00:00Z")], calendar: west)
        XCTAssertEqual(evening.map(\.id), ["2026-11-09"])
    }

    func testAnActivityPageDecodesFromTheWire() throws {
        let json = #"""
        {"data":[{"id":"a1","kind":"call_rang","category":"call","occurred_at":"2026-11-10T15:00:00.000Z",
        "actor":{"type":"system","user_id":null,"display_name":null},
        "payload":{"user_ids":["u1"],"asked":false},
        "source":{"type":"call","id":"call-1","conversation_id":null}}],"next_cursor":null}
        """#
        let page = try JSONDecoder().decode(Page<ActivityItem>.self, from: Data(json.utf8))
        XCTAssertEqual(page.data.count, 1)
        XCTAssertEqual(page.data[0].source?.type, "call")
        XCTAssertEqual(say(page.data[0], type: .call, recordId: "call-1"), "Rang Sam Ortiz")
    }
}
