import XCTest
@testable import Loonext

/// #302 — the presence rule and the frames it is fed.
///
/// THE FIXTURES ARE REAL FRAMES, captured off the working web client's socket
/// with two signed-in browsers on one conversation. That matters more than
/// usual here: Swift does not compile on the machine this was written on, the
/// socket layer cannot be run at all, and so this file is the only thing
/// standing between a wrong assumption about the wire format and a feature that
/// silently does nothing.
///
/// Mirrors PresenceLogicTest.kt and packages/shared/src/presence.test.ts case
/// for case — three clients, one rule.
final class PresenceLogicTests: XCTestCase {
    private let now = 1_785_479_341_479
    private let conv = "b0000000-0000-4000-8000-000000000005"
    private let me = "me"

    private func json(_ text: String) -> [String: Any] {
        let data = Data(text.utf8)
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    // MARK: - The frames

    func testEmptyPresenceStateIsAnEmptyRoomNotAParseFailure() {
        // The server's FIRST frame on a fresh topic is literally `{}`.
        XCTAssertTrue(applyPresenceState(json("{}")).isEmpty)
    }

    func testPresenceStateParsesTheCapturedMetaShape() {
        let map = applyPresenceState(json("""
        {"f7ffafbb-f7e2-48df-9361-95f7672d2871":{"metas":[
          {"phx_ref":"GMdMAE99-QdZ7-mB","at":\(now),
           "conversation_id":"\(conv)","display_name":"Dana Brightside",
           "typing":false,"user_id":"f7ffafbb-f7e2-48df-9361-95f7672d2871"}]}}
        """))
        let entries = presenceEntries(map)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries.first?.displayName, "Dana Brightside")
        XCTAssertEqual(entries.first?.conversationId, conv)
        XCTAssertEqual(entries.first?.at, now)
    }

    func testADiffAddsAndRemoves() {
        var map = applyPresenceDiff([:], json("""
        {"joins":{"sam":{"metas":[{"phx_ref":"a","at":\(now),
          "conversation_id":"\(conv)","display_name":"Sam","typing":false,
          "user_id":"sam"}]}},"leaves":{}}
        """))
        XCTAssertEqual(presenceEntries(map).count, 1)
        map = applyPresenceDiff(map, json(#"{"joins":{},"leaves":{"sam":{"metas":[]}}}"#))
        XCTAssertTrue(presenceEntries(map).isEmpty)
    }

    func testARejoinInOneDiffDoesNotBlinkThePersonOut() {
        // A token refresh arrives as a leave of the old ref and a join of the
        // new one, in the same frame. Applying leaves last would delete the key
        // the joins half just re-established.
        let map = applyPresenceDiff([:], json("""
        {"joins":{"sam":{"metas":[{"phx_ref":"new","at":\(now),
           "conversation_id":"\(conv)","display_name":"Sam","typing":false,
           "user_id":"sam"}]}},
         "leaves":{"sam":{"metas":[{"phx_ref":"old","at":\(now - 1000),
           "conversation_id":"\(conv)","display_name":"Sam","typing":false,
           "user_id":"sam"}]}}}
        """))
        XCTAssertEqual(presenceEntries(map).count, 1)
    }

    func testAMalformedMetaNeverTakesTheWholeFrameDown() {
        // One bad frame must not kill presence for the session.
        let map = applyPresenceState(json(#"{"sam":{"metas":[{"phx_ref":"x"}]},"dale":{"nope":1}}"#))
        XCTAssertTrue(presenceEntries(map).isEmpty)
        // …and the keys survive, so a later `leaves` can still find them.
        XCTAssertEqual(Set(map.keys), Set(["sam", "dale"]))
    }

    // MARK: - The rule

    private func entry(
        user: String = "sam",
        name: String = "Sam",
        conversation: String? = nil,
        at: Int? = nil,
        typing: Bool = false
    ) -> PresenceEntry {
        PresenceEntry(
            userId: user,
            displayName: name,
            conversationId: conversation ?? conv,
            at: at ?? now,
            typing: typing
        )
    }

    private func viewers(_ entries: [PresenceEntry], healthy: Bool = true) -> [PresenceViewer] {
        viewersOf(
            entries: entries,
            conversationId: conv,
            selfUserId: me,
            now: now,
            healthy: healthy
        )
    }

    func testReportsATeammateAndNeverYourself() {
        XCTAssertEqual(viewers([entry()]).count, 1)
        XCTAssertTrue(viewers([entry(user: me)]).isEmpty)
    }

    func testIgnoresAnotherConversationAndAnythingPastTheTTL() {
        XCTAssertTrue(viewers([entry(conversation: "other")]).isEmpty)
        XCTAssertTrue(viewers([entry(at: now - PresenceTiming.ttlMs - 1)]).isEmpty)
    }

    func testRefusesAClockFromTheFutureRatherThanTrustingItForever() {
        // Otherwise a phone set wrong pins a ghost to the thread until a reload.
        XCTAssertTrue(viewers([entry(at: now + PresenceTiming.ttlMs * 4)]).isEmpty)
    }

    func testAnUnhealthyConnectionReportsNothingNotTheLastThingItHeard() {
        XCTAssertTrue(viewers([entry()], healthy: false).isEmpty)
    }

    func testOnePersonOnTwoDevicesCollapsesAndTypingOnEitherCounts() {
        let result = viewers([
            entry(at: now - 1000, typing: false),
            entry(at: now - 3000, typing: true),
        ])
        XCTAssertEqual(result.count, 1)
        XCTAssertTrue(result[0].typing)
    }

    func testTypingExpiresWithoutDroppingThePerson() {
        let result = viewers([entry(at: now - PresenceTiming.typingTtlMs - 1000, typing: true)])
        XCTAssertEqual(result.count, 1)
        XCTAssertFalse(result[0].typing)
    }

    func testFallsBackToANameRatherThanRenderingAnEmptyOne() {
        XCTAssertEqual(viewers([entry(name: "   ")]).first?.displayName, "A teammate")
    }

    func testTheLabelMatchesTheSharedWordingExactly() {
        // Three clients, one sentence. A divergence here is one the crew sees
        // when they switch devices.
        func v(_ name: String, _ typing: Bool = false) -> PresenceViewer {
            PresenceViewer(userId: name.lowercased(), displayName: name, typing: typing)
        }
        XCTAssertNil(presenceLabel([]))
        XCTAssertEqual(presenceLabel([v("Sam")]), "Sam is also here")
        XCTAssertEqual(presenceLabel([v("Sam"), v("Dale")]), "Sam and Dale are also here")
        XCTAssertEqual(
            presenceLabel([v("Sam"), v("Dale"), v("Ann")]),
            "3 teammates are also here"
        )
        XCTAssertEqual(presenceLabel([v("Sam", true), v("Dale")]), "Sam is replying…")
        XCTAssertEqual(
            presenceLabel([v("Sam", true), v("Dale", true)]),
            "Sam and Dale are replying…"
        )
        XCTAssertEqual(
            presenceLabel([v("Sam", true), v("Dale", true), v("Ann", true)]),
            "3 people are replying…"
        )
    }
}
