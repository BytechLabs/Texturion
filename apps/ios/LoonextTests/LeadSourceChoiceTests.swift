import XCTest
@testable import Loonext

/// #726: an unanswered source reads as unanswered, a chosen one as chosen, and
/// one thread's answer never shows up on another. Mirrors the Android
/// LeadSourceChoiceTest.
final class LeadSourceChoiceTests: XCTestCase {
    private func detail(id: String, sourceId: String?, origin: String? = nil) throws -> ConversationDetail {
        func quoted(_ value: String?) -> String { value.map { "\"\($0)\"" } ?? "null" }
        let json = """
        {"id":"\(id)","company_id":"c1","contact_id":"ct1","phone_number_id":"pn1",
         "status":"open","is_spam":false,
         "last_message_at":"2026-11-10T10:00:00Z",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
         "lead_source_id":\(quoted(sourceId)),"lead_source_origin":\(quoted(origin)),
         "contact":{"id":"ct1","name":"Ray","phone_e164":"+14155550134",
           "address":null,"notes":null,"consent_source":null,
           "consent_at":null,"deleted_at":null},
         "messages":{"data":[],"next_cursor":null}}
        """
        return try JSONDecoder().decode(ConversationDetail.self, from: Data(json.utf8))
    }

    /// What the chip row draws: which of the offered sources reads as chosen.
    private func chosenChips(_ offered: [String], _ choice: LeadSourceChoice) -> [String] {
        offered.filter { $0 == choice.sourceId }
    }

    func testAnUnaskedSourceSaysItWasNotAskedAndNoChipReadsAsChosen() throws {
        let choice = LeadSourceChoice.of(try detail(id: "c1", sourceId: nil))
        XCTAssertEqual(leadSourceView(name: nil, origin: choice.origin), .unasked)
        // The lone source is a choice on offer, not the answer.
        XCTAssertEqual(chosenChips(["truck"], choice), [])
    }

    func testTheCopyOfTheEmptyStateIsTheOneTheWebSays() {
        XCTAssertEqual(
            AppStrings.translate(nil, "thread.leadAsk"),
            "Not asked yet. Ask them how they heard about you."
        )
        XCTAssertEqual(
            AppStrings.translate("fr-CA", "thread.leadAsk"),
            "Pas encore demandé. Demandez-lui comment il vous a connu."
        )
        XCTAssertEqual(AppStrings.translate(nil, "thread.addLeadSource"), "Add a source")
        XCTAssertEqual(AppStrings.translate("fr-CA", "thread.addLeadSource"), "Ajouter une source")
    }

    func testAChosenSourceIsNamedAndItsChipIsTheChosenOne() throws {
        let choice = LeadSourceChoice.of(try detail(id: "c1", sourceId: "truck", origin: "manual"))
        XCTAssertEqual(
            leadSourceView(name: "Truck", origin: choice.origin),
            .chosen(name: "Truck", fromNumber: false)
        )
        XCTAssertEqual(chosenChips(["truck", "sign"], choice), ["truck"])
    }

    func testASourceTheLineNamedSaysSo() throws {
        let choice = LeadSourceChoice.of(try detail(id: "c1", sourceId: "truck", origin: "number"))
        XCTAssertEqual(
            leadSourceView(name: "Truck", origin: choice.origin),
            .chosen(name: "Truck", fromNumber: true)
        )
    }

    func testSwitchingFromAThreadWithASourceToOneWithoutSelectsNothing() throws {
        var first = LeadSourceChoice.of(try detail(id: "c1", sourceId: "truck", origin: "manual"))
        XCTAssertEqual(chosenChips(["truck"], first), ["truck"])

        // The picker holds one choice per conversation id: a different thread is
        // built from its own server value, never from the one just left.
        let second = LeadSourceChoice.of(try detail(id: "c2", sourceId: nil))
        XCTAssertNil(second.sourceId)
        XCTAssertEqual(chosenChips(["truck"], second), [])
        XCTAssertEqual(leadSourceView(name: nil, origin: second.origin), .unasked)

        // And what was picked on the first thread stays on the first.
        first.sourceId = nil
        XCTAssertNil(second.sourceId)
        XCTAssertNotEqual(first.conversationId, second.conversationId)
    }

    func testOnlySomeoneWhoCanManageSettingsIsOfferedAddASource() {
        XCTAssertTrue(canAddLeadSource(role: "owner"))
        XCTAssertFalse(canAddLeadSource(role: "member"))
        XCTAssertFalse(canAddLeadSource(role: nil))
    }
}
