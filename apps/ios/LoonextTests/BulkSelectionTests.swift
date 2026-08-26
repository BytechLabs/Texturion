import XCTest

@testable import Loonext

/// #275 — the selection semantics, asserted against the same cases as the web and
/// Android twins (`bulk-selection.test.ts`, `BulkSelectionTest.kt`).
///
/// This file exists because the logic is HAND-PORTED to three languages. The rule
/// they all implement is: THE UI MUST NEVER CLAIM A NUMBER IT DOES NOT HAVE. A bar
/// reading "340 selected" that acts on the 25 paged rows is the failure #275 names,
/// and it is exactly the kind of thing a port loses silently.
///
/// Two of these assert the copy VERBATIM against the other clients, because the
/// drift a user actually notices is the same action reading differently depending
/// on which device they picked up.
final class BulkSelectionTests: XCTestCase {
    private let loaded = ["a", "b", "c"]

    func testEmptyHidesTheBar() {
        XCTAssertTrue(BulkSelection.empty.isEmpty)
        XCTAssertFalse(selectLoaded(loaded).isEmpty)
        XCTAssertFalse(BulkSelection.filter.isEmpty)
    }

    func testSendsIdsForAPointedAtSelectionAndNilForFilterMode() {
        // nil is the instruction "you resolve it" — the server then applies the #106
        // deny list to a set the client never enumerated.
        XCTAssertEqual(selectLoaded(["b", "a"]).idsOrNil?.sorted(), ["a", "b"])
        XCTAssertNil(BulkSelection.filter.idsOrNil)
    }

    func testFilterModeSelectsEveryRowIncludingOnesNotLoadedYet() {
        XCTAssertTrue(BulkSelection.filter.isRowSelected("a"))
        XCTAssertTrue(BulkSelection.filter.isRowSelected("not-paged-in-yet"))
    }

    func testIdModeSelectsOnlyTheNamedRows() {
        let some = selectLoaded(["a"])
        XCTAssertTrue(some.isRowSelected("a"))
        XCTAssertFalse(some.isRowSelected("b"))
    }

    func testTheLabelNeverInventsATotal() {
        XCTAssertEqual(selectLoaded(["a"]).label, "1 selected")
        XCTAssertEqual(selectLoaded(loaded).label, "3 selected")
        // The honest phrasing: no digits at all, because we do not know the number.
        let filterLabel = BulkSelection.filter.label
        XCTAssertEqual(filterLabel, "All matching this filter")
        XCTAssertFalse(filterLabel.contains { $0.isNumber })
    }

    func testUntickingInFilterModeCollapsesToTheLoadedRowsMinusThatOne() {
        let next = BulkSelection.filter.toggling("b", loadedIds: loaded)
        XCTAssertEqual(next.idsOrNil?.sorted(), ["a", "c"])
        XCTAssertFalse(next.isRowSelected("b"))
    }

    func testTogglingARowOnAndOffInIdMode() {
        var selection = BulkSelection.empty.toggling("a", loadedIds: loaded)
        XCTAssertEqual(selection.idsOrNil, ["a"])
        selection = selection.toggling("a", loadedIds: loaded)
        XCTAssertTrue(selection.isEmpty)
    }

    func testTheEscalationIsOfferedOnlyWhenItMeansSomething() {
        XCTAssertTrue(selectLoaded(loaded).canEscalate(loadedIds: loaded, hasMore: true))
        // Not before the page is fully selected.
        XCTAssertFalse(selectLoaded(["a"]).canEscalate(loadedIds: loaded, hasMore: true))
        // Not when everything is already loaded: escalating to the same set while
        // phrasing it as bigger teaches the user the options differ when they do not.
        XCTAssertFalse(selectLoaded(loaded).canEscalate(loadedIds: loaded, hasMore: false))
        XCTAssertFalse(BulkSelection.filter.canEscalate(loadedIds: loaded, hasMore: true))
        XCTAssertFalse(BulkSelection.empty.canEscalate(loadedIds: [], hasMore: true))
    }

    func testTheResultMessageCountsWhatTheServerApplied() {
        XCTAssertEqual(
            bulkResultMessage(verb: "Closed", applied: 2, failed: 0, matched: 2, capped: false),
            "Closed 2 conversations"
        )
        XCTAssertEqual(
            bulkResultMessage(verb: "Closed", applied: 1, failed: 0, matched: 1, capped: false),
            "Closed 1 conversation"
        )
    }

    func testTheResultMessageLocalizesFrenchGrammarAndPluralVerbs() {
        XCTAssertEqual(
            bulkResultMessage(
                verb: "Terminée",
                verbMany: "Terminées",
                applied: 1,
                failed: 0,
                matched: 1,
                capped: false,
                nounOne: "tâche",
                nounMany: "tâches",
                locale: "fr-CA"
            ),
            "Terminée 1 tâche"
        )
        XCTAssertEqual(
            bulkResultMessage(
                verb: "Terminée",
                verbMany: "Terminées",
                applied: 2,
                failed: 0,
                matched: 2,
                capped: false,
                nounOne: "tâche",
                nounMany: "tâches",
                locale: "fr-CA"
            ),
            "Terminées 2 tâches"
        )
    }

    func testInboxFrenchVerbsAgreeWithOneOrManyConversations() {
        let one = AppStrings.translate("fr-CA", "inbox.bulkVerbClosedOne")
        let many = AppStrings.translate("fr-CA", "inbox.bulkVerbClosedMany")

        XCTAssertEqual(
            bulkResultMessage(
                verb: one,
                verbMany: many,
                applied: 1,
                failed: 0,
                matched: 1,
                capped: false,
                locale: "fr-CA"
            ),
            "Fermée 1 conversation"
        )
        XCTAssertEqual(
            bulkResultMessage(
                verb: one,
                verbMany: many,
                applied: 2,
                failed: 0,
                matched: 2,
                capped: false,
                locale: "fr-CA"
            ),
            "Fermées 2 conversations"
        )
    }

    func testZeroAppliedReadsHonestlyRatherThanAsAWin() {
        let message =
            bulkResultMessage(verb: "Closed", applied: 0, failed: 1, matched: 1, capped: false)
        XCTAssertTrue(message.contains("Closed 0 conversations"))
        XCTAssertTrue(message.contains("couldn't be reached"))
    }

    func testTheCopyMatchesTheOtherClientsVerbatim() {
        // Three implementations of one rule. If the wording drifts, the same action
        // reads differently depending on which device the crew member picked up.
        XCTAssertEqual(
            bulkResultMessage(verb: "Closed", applied: 500, failed: 0, matched: 640, capped: true),
            "Closed 500 conversations. 140 more matched than one go can handle, so run it again"
        )
        XCTAssertEqual(
            bulkResultMessage(
                verb: "Marked read", applied: 3, failed: 1, matched: 4, capped: false
            ),
            "Marked read 3 conversations. 1 couldn't be reached and was left alone"
        )
        XCTAssertTrue(
            bulkResultMessage(verb: "Closed", applied: 1, failed: 2, matched: 3, capped: false)
                .contains("were left alone")
        )
    }

    // MARK: - bulkUndoPlan

    private func result(
        action: String = "set_status",
        _ rows: [(String, [String: JSONValue])]
    ) -> BulkConversationsResult {
        BulkConversationsResult(
            action: action,
            matched: rows.count,
            applied: rows.map { BulkAppliedRow(id: $0.0, previous: $0.1) }
        )
    }

    func testAMixedStatusCloseUndoesAsOneCallPerPriorStatus() {
        // Not three hundred calls, and not a uniform "open" — a thread that was `new`
        // or `waiting` must come back as that, or the undo quietly loses the fact
        // that nobody had replied to it yet.
        let plan = bulkUndoPlan(
            result([
                ("a", ["status": .string("open")]),
                ("b", ["status": .string("new")]),
                ("c", ["status": .string("open")]),
                ("d", ["status": .string("waiting")]),
            ])
        )
        XCTAssertEqual(plan?.count, 3)
        XCTAssertEqual(plan?.first { $0.targetStatus == "open" }?.ids, ["a", "c"])
        XCTAssertEqual(plan?.first { $0.targetStatus == "new" }?.ids, ["b"])
        XCTAssertEqual(plan?.first { $0.targetStatus == "waiting" }?.ids, ["d"])
    }

    func testANilPriorAssigneeUndoesAsAnExplicitUnassign() {
        // The server needs the null said out loud, not inferred from an absent field.
        let plan = bulkUndoPlan(
            result(
                action: "assign",
                [
                    ("a", ["assigned_user_id": .null]),
                    ("b", ["assigned_user_id": .string("u1")]),
                ]
            )
        )
        XCTAssertEqual(plan?.count, 2)
        let unassigned = plan?.first { $0.unassign }
        XCTAssertEqual(unassigned?.ids, ["a"])
        XCTAssertNil(unassigned?.targetUserId)
        XCTAssertEqual(plan?.first { $0.targetUserId == "u1" }?.ids, ["b"])
    }

    func testUndoingAddTagTouchesOnlyTheRowsThatDidNotAlreadyHaveIt() {
        // Otherwise the undo strips a tag somebody applied by hand months ago — a
        // bulk action destroying data it never created.
        let plan = bulkUndoPlan(
            result(
                action: "add_tag",
                [
                    ("already", ["had_tag": .bool(true)]),
                    ("fresh", ["had_tag": .bool(false)]),
                ]
            )
        )
        XCTAssertEqual(plan?.count, 1)
        XCTAssertEqual(plan?.first?.action, "remove_tag")
        XCTAssertEqual(plan?.first?.ids, ["fresh"])
    }

    func testUndoingRemoveTagRestoresOnlyTheRowsThatHadIt() {
        let plan = bulkUndoPlan(
            result(
                action: "remove_tag",
                [
                    ("had", ["had_tag": .bool(true)]),
                    ("never", ["had_tag": .bool(false)]),
                ]
            )
        )
        XCTAssertEqual(plan?.count, 1)
        XCTAssertEqual(plan?.first?.action, "add_tag")
        XCTAssertEqual(plan?.first?.ids, ["had"])
    }

    func testMarkReadOffersNoUndoAtAll() {
        // "Unread" is the absence of a read receipt, so there is no prior state to
        // restore and nobody asks to un-read three hundred threads.
        let plan = bulkUndoPlan(result(action: "mark_read", [("a", [:]), ("b", [:])]))
        XCTAssertNil(plan)
    }

    func testAnUnexpectedPreviousShapeIsSkippedRatherThanTrapping() {
        // Server JSON. A client that trapped here would take the inbox down over an
        // undo button.
        XCTAssertNil(bulkUndoPlan(result([("a", ["status": .null])])))
    }
}
