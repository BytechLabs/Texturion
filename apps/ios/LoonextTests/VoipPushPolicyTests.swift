import XCTest
@testable import Loonext

@MainActor
final class VoipPushPolicyTests: XCTestCase {
    func testDictionaryKeepsTheCallUUIDAndMetadata() throws {
        let uuid = try XCTUnwrap(UUID(uuidString: "423F41A5-2575-4F8C-8992-509AA6DAE291"))
        let push = VoipPushPolicy().incoming([
            "metadata": [
                "call_id": uuid.uuidString,
                "caller_name": "Dana",
                "caller_number": "+16045550109",
                "sdk_extension": "preserved",
            ],
        ], workspaceNumbers: ["+16045550100"], locale: "en")
        XCTAssertEqual(push.uuid, uuid)
        XCTAssertEqual(push.id, uuid.uuidString.lowercased())
        XCTAssertEqual(push.displayName, "Dana")
        XCTAssertEqual(push.number, "+16045550109")
        XCTAssertEqual(push.metadata["sdk_extension"] as? String, "preserved")
    }

    func testJSONMetadataFormatsTheNumberWhenTheNameIsBlank() throws {
        let fallback = try XCTUnwrap(UUID(uuidString: "DB271428-08FE-4528-B5E1-880BCD52971A"))
        let push = VoipPushPolicy().incoming([
            "metadata": #"{"call_id":"invalid","caller_id_name":"  ","caller_id_number":"+16045550109"}"#,
        ], workspaceNumbers: ["+16045550100"], locale: "en", makeUUID: { fallback })
        XCTAssertEqual(push.uuid, fallback)
        XCTAssertEqual(push.number, "+16045550109")
        XCTAssertEqual(push.displayName, "(604) 555-0109")
    }

    func testMalformedMetadataStillProducesACallToReport() throws {
        let fallback = try XCTUnwrap(UUID(uuidString: "DB271428-08FE-4528-B5E1-880BCD52971A"))
        let push = VoipPushPolicy().incoming(
            ["metadata": "{"], workspaceNumbers: nil, locale: "fr-CA", makeUUID: { fallback }
        )
        XCTAssertEqual(push.uuid, fallback)
        XCTAssertEqual(push.displayName, AppStrings.translate("fr-CA", "shell.pushCallTitle"))
        XCTAssertTrue(push.metadata.isEmpty)
    }

    func testWorkspaceNumberStaysOutOfTheCallKitIdentity() {
        let push = VoipPushPolicy().incoming([
            "metadata": [
                "caller_number": "(604) 555-0100",
                "caller_name": "Workspace name",
            ],
        ], workspaceNumbers: ["+16045550100"], locale: "en")
        XCTAssertEqual(push.displayName, "Incoming call")
        XCTAssertEqual(push.number, "")
    }

    func testWakeUsesTheActiveWorkspaceBeforeTheLastWorkspace() {
        let policy = VoipPushPolicy()
        XCTAssertEqual(policy.wake(activeCompanyId: nil, lastCompanyId: nil), .failed)
        XCTAssertEqual(policy.wake(activeCompanyId: nil, lastCompanyId: "previous"), .connect(companyId: "previous"))
        XCTAssertEqual(policy.wake(activeCompanyId: "active", lastCompanyId: "previous"), .connect(companyId: "active"))
    }

    func testWatchdogWaitsForTheInviteBeforeEndingTheRing() async {
        var waited: [Duration] = []
        let policy = VoipPushPolicy(sleep: { waited.append($0) })
        let missing = await policy.afterWatchdog { false }
        let arrived = await policy.afterWatchdog { true }
        XCTAssertEqual(waited, [.seconds(20), .seconds(20)])
        XCTAssertEqual(missing, .answeredElsewhere)
        XCTAssertEqual(arrived, .inviteArrived)
    }
}
