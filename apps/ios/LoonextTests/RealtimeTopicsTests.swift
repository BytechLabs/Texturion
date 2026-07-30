import XCTest
@testable import Loonext

/// #480 / D88 — the client joins `company:{id}` AND one
/// `company:{id}:number:{n}` channel per number the SERVER says it may see.
///
/// None of this can be exercised through a socket in a unit test, so what is
/// pinned here is the arithmetic that decides the subscription set: the topic
/// names (a wire contract with the trigger functions), the company-vs-number
/// classification (which governs whether a frame may cancel the transport), and
/// the join/leave diff.
final class RealtimeTopicsTests: XCTestCase {
    private let company = "11111111-1111-1111-1111-111111111111"
    private let numberA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    private let numberB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

    /// The `phx_join` topics out of the frames a fresh socket would send.
    private func joinTopics(_ frames: [String]) -> [String] {
        frames.compactMap { text -> String? in
            guard let frame = try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)),
                  frame["event"]?.stringValue == "phx_join"
            else { return nil }
            return frame["topic"]?.stringValue
        }
    }

    /// A wire contract with `broadcast_number_scoped`
    /// (supabase/migrations/20260730040000_number_scoped_topics.sql): the server
    /// sends to `company:{id}` and `company:{id}:number:{n}`, and Phoenix
    /// prefixes the channel name with `realtime:`. A typo on either side is
    /// silence — no error anywhere, just events that never arrive.
    func testTopicNamesMatchTheChannelsTheServerSendsOn() {
        XCTAssertEqual(
            RealtimeClient.companyTopic(company),
            "realtime:company:\(company)"
        )
        XCTAssertEqual(
            RealtimeClient.numberTopic(company, numberA),
            "realtime:company:\(company):number:\(numberA)"
        )
    }

    /// A per-number topic STARTS WITH the company topic, and `handle` cancels the
    /// transport when the COMPANY channel is rejected or closed. Under the prefix
    /// test this replaced, a refused per-number join — the intended outcome once a
    /// member loses a number — read as a rejected company join and killed the
    /// socket, turning one closed channel into an endless reconnect.
    func testOnlyTheCompanyChannelCountsAsTheCompanyTopic() {
        XCTAssertTrue(RealtimeClient.isCompanyTopic(
            RealtimeClient.companyTopic(company),
            company: company
        ))
        XCTAssertFalse(RealtimeClient.isCompanyTopic(
            RealtimeClient.numberTopic(company, numberA),
            company: company
        ))
        // Heartbeat replies ride "phoenix"; another company's channel is not ours.
        XCTAssertFalse(RealtimeClient.isCompanyTopic("phoenix", company: company))
        XCTAssertFalse(RealtimeClient.isCompanyTopic(
            RealtimeClient.companyTopic("22222222-2222-2222-2222-222222222222"),
            company: company
        ))
        // A frame still in flight after disconnect has no company to match, which
        // is the `nil == nil` a bare comparison would have called a match.
        XCTAssertFalse(RealtimeClient.isCompanyTopic(nil, company: nil))
    }

    func testTopicDeltaJoinsWhatIsNewAndLeavesWhatIsGone() {
        let held = RealtimeClient.numberTopic(company, numberA)
        let granted = RealtimeClient.numberTopic(company, numberB)
        let delta = RealtimeClient.topicDelta(have: [held], want: [granted])
        XCTAssertEqual(delta.join, [granted])
        XCTAssertEqual(delta.leave, [held])
    }

    /// The property that keeps one access edit from becoming a storm: an edit
    /// rewrites several rules, so `access.changed` arrives once per row and the
    /// client re-derives once per event. Every re-derive after the first sees the
    /// same set and must emit nothing at all.
    func testAnUnchangedSetEmitsNothing() {
        let held = RealtimeClient.numberTopic(company, numberA)
        let delta = RealtimeClient.topicDelta(have: [held], want: [held])
        XCTAssertTrue(delta.join.isEmpty)
        XCTAssertTrue(delta.leave.isEmpty)
    }

    func testAFreshSocketJoinsTheCompanyChannelAndOnePerVisibleNumber() async {
        let client = RealtimeClient()
        // Reversed going in, sorted coming out — the frames are deterministic.
        await client.setNumbers([numberB, numberA])
        let topics = joinTopics(await client.joinFrames(company))
        XCTAssertEqual(topics, [
            RealtimeClient.companyTopic(company),
            RealtimeClient.numberTopic(company, numberA),
            RealtimeClient.numberTopic(company, numberB),
        ])
    }

    /// A member who may see nothing still gets the company channel — that is
    /// where `access.changed`, `registration.updated` and `read.notifications`
    /// live, so the app has to work with an empty number list.
    func testAMemberWithNoVisibleNumbersStillJoinsTheCompanyChannel() async {
        let client = RealtimeClient()
        let topics = joinTopics(await client.joinFrames(company))
        XCTAssertEqual(topics, [RealtimeClient.companyTopic(company)])
    }

    /// Re-deriving after a revocation has to drop the channel, not just stop
    /// asking about it: the next socket must not join it either.
    func testARevokedNumberIsGoneFromTheNextSocketsJoins() async {
        let client = RealtimeClient()
        await client.setNumbers([numberA, numberB])
        _ = await client.joinFrames(company)

        await client.setNumbers([numberA])
        let topics = joinTopics(await client.joinFrames(company))
        XCTAssertEqual(topics, [
            RealtimeClient.companyTopic(company),
            RealtimeClient.numberTopic(company, numberA),
        ])
    }
}
