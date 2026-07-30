import XCTest
@testable import Loonext

/// #480 / D88 — the client joins `company:{id}` AND one
/// `company:{id}:number:{n}` channel per number the SERVER says it may see.
///
/// None of this can be exercised through a socket in a unit test, so what is
/// pinned here is the arithmetic that decides the subscription set: the topic
/// names (a wire contract with the trigger functions), the company-vs-number
/// classification (which governs whether a frame may cancel the transport), the
/// join/leave diff, what a frame's SEND RESULT does to the set of topics this
/// client believes it holds (#483 — a leave that never went out), and what the
/// SERVER's answer does to it (#483 — a channel refused or closed on a socket
/// that stays up).
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

    /// A revocation is only real once the `phx_leave` is on the wire. The client
    /// used to record the whole desired set as joined BEFORE sending anything and
    /// discard every send error, so a leave that never left the device counted as
    /// a completed revocation — and since the held set is also what
    /// `pushAccessToken` re-authorizes, the topic fell out of the hourly token
    /// push too. With authorization a join-time handshake (D88), nothing was left
    /// to close the channel: the server kept publishing that number's events to a
    /// member who may no longer see it until the socket happened to drop.
    ///
    /// Holding it instead is what makes the next reconcile ask again.
    func testAFailedLeaveStaysHeldAndIsStillPendingOnTheNextReconcile() {
        let topic = RealtimeClient.numberTopic(company, numberA)
        let held = RealtimeClient.topicsAfterSend([topic], topic: topic, leaving: true, sent: false)
        XCTAssertEqual(held, [topic])
        let delta = RealtimeClient.topicDelta(have: held, want: [])
        XCTAssertEqual(delta.leave, [topic])
        XCTAssertTrue(delta.join.isEmpty)
    }

    func testALeaveThatWentOutReleasesTheTopic() {
        let topic = RealtimeClient.numberTopic(company, numberA)
        let held = RealtimeClient.topicsAfterSend([topic], topic: topic, leaving: true, sent: true)
        XCTAssertTrue(held.isEmpty)
        // And is not asked for again — the channel is gone, not pending.
        let delta = RealtimeClient.topicDelta(have: held, want: [])
        XCTAssertTrue(delta.leave.isEmpty)
    }

    /// The other direction of the same rule. A join whose frame never reached the
    /// socket joined nothing, so recording it would claim a channel that does not
    /// exist — putting a dead topic in every token push and stopping the next
    /// reconcile from ever retrying the join.
    func testAJoinIsHeldOnlyIfItsFrameWentOut() {
        let topic = RealtimeClient.numberTopic(company, numberA)
        XCTAssertEqual(
            RealtimeClient.topicsAfterSend([], topic: topic, leaving: false, sent: true),
            [topic]
        )
        let unsent = RealtimeClient.topicsAfterSend([], topic: topic, leaving: false, sent: false)
        XCTAssertTrue(unsent.isEmpty)
        XCTAssertEqual(RealtimeClient.topicDelta(have: unsent, want: [topic]).join, [topic])
    }

    /// Bookkeeping for one topic must not disturb the others: a company with two
    /// numbers loses one, that leave fails, and the number still granted has to
    /// stay exactly as it was.
    func testRecordingOneTopicLeavesTheOthersAlone() {
        let kept = RealtimeClient.numberTopic(company, numberA)
        let revoked = RealtimeClient.numberTopic(company, numberB)
        let held = RealtimeClient.topicsAfterSend(
            [kept, revoked],
            topic: revoked,
            leaving: true,
            sent: false
        )
        XCTAssertEqual(held, [kept, revoked])
        XCTAssertEqual(
            RealtimeClient.topicsAfterSend([kept, revoked], topic: revoked, leaving: true, sent: true),
            [kept]
        )
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

    // MARK: - #483: a channel lost on a live socket has to come back

    /// The re-join gap. The held set claimed a topic for the life of the socket
    /// whatever the server said about it, and `setNumbers` returns early when the
    /// wanted set is unchanged — which it is when a channel is lost without access
    /// changing. So a per-number join refused inside a token-refresh window was
    /// never asked for again: after the contract step that number's
    /// `message.created`, `conversation.updated`, `message.status`, `task.changed`,
    /// `read.conversation` and `call.updated` stop until the app restarts, with the
    /// socket reporting perfect health throughout.
    ///
    /// The confirmed number in the same company is the control: a channel the
    /// server accepted must never be re-joined, or the sweep becomes a `phx_join`
    /// per number per minute for a company where nothing is wrong.
    func testARefusedNumberChannelIsAskedForAgainAndAConfirmedOneIsNot() async {
        let client = RealtimeClient()
        let confirmed = RealtimeClient.numberTopic(company, numberA)
        let refused = RealtimeClient.numberTopic(company, numberB)
        await client.setNumbers([numberA, numberB])
        _ = await client.joinFrames(company)

        await client.noteNumberTopicReply(confirmed, ok: true)
        await client.noteNumberTopicReply(refused, ok: false)

        let pending = await client.numberTopicsToRejoin(company)
        XCTAssertEqual(pending, [refused])
    }

    /// A close is not only a revocation — a realtime node closes channels while it
    /// rebalances, and a token it will not take closes them too — so the channel it
    /// took has to be asked for again rather than written off.
    func testAServerClosedNumberChannelIsAskedForAgain() async {
        let client = RealtimeClient()
        let topic = RealtimeClient.numberTopic(company, numberA)
        await client.setNumbers([numberA])
        _ = await client.joinFrames(company)
        await client.noteNumberTopicReply(topic, ok: true)

        let afterConfirmation = await client.numberTopicsToRejoin(company)
        XCTAssertTrue(afterConfirmation.isEmpty, "a confirmed channel must not be re-joined")

        await client.noteNumberTopicLost(topic)
        let pending = await client.numberTopicsToRejoin(company)
        XCTAssertEqual(pending, [topic])
    }

    /// The interaction with the leave retry, and the one thing the sweep must never
    /// do. A `phx_leave` whose send failed leaves its topic HELD on purpose (see
    /// `topicsAfterSend`) while the wanted set no longer has it, so that every JWT
    /// push keeps re-running the topic policy against that channel. Re-joining it
    /// would undo the revocation that retry is still trying to land — which is why
    /// the sweep diffs the WANTED set, where a revoked number is simply absent.
    func testATopicHeldOnlyForAFailedLeaveIsNeverReJoined() async {
        let client = RealtimeClient()
        let kept = RealtimeClient.numberTopic(company, numberA)
        let revoked = RealtimeClient.numberTopic(company, numberB)
        await client.setNumbers([numberA, numberB])
        _ = await client.joinFrames(company)
        await client.noteNumberTopicReply(kept, ok: true)
        await client.noteNumberTopicReply(revoked, ok: true)

        // Access is taken away with no socket to send the leave on, which leaves
        // exactly the bookkeeping a failed leave does: still held, still confirmed,
        // no longer wanted.
        await client.setNumbers([numberA])

        let pending = await client.numberTopicsToRejoin(company)
        XCTAssertTrue(pending.isEmpty)
    }

    /// Confirmation belongs to the socket that earned it. A new socket re-joins
    /// everything and does not know whether it is on those channels until the
    /// server replies, so a confirmation carried across would hide a join on the
    /// NEW socket that is refused, or never answered, from the sweep.
    func testConfirmationDoesNotSurviveANewSocket() async {
        let client = RealtimeClient()
        let topic = RealtimeClient.numberTopic(company, numberA)
        await client.setNumbers([numberA])
        _ = await client.joinFrames(company)
        await client.noteNumberTopicReply(topic, ok: true)

        // The socket dropped and `runLoop` opened a fresh one.
        _ = await client.joinFrames(company)

        let pending = await client.numberTopicsToRejoin(company)
        XCTAssertEqual(pending, [topic])
    }

    /// The `phx_reply` to a `phx_leave` is an `ok` on that same per-number topic,
    /// and one can also arrive after the server has already refused or closed the
    /// channel. Only a topic this client still HOLDS may be confirmed — otherwise
    /// that stale ok records a channel nobody is on and the sweep stops asking for
    /// it, which is the original bug with an extra step. It is the same rule that
    /// keeps the company channel and the heartbeat's "phoenix" replies out of this
    /// bookkeeping entirely.
    func testAnOkReplyForATopicWeNoLongerHoldConfirmsNothing() async {
        let client = RealtimeClient()
        let topic = RealtimeClient.numberTopic(company, numberA)
        await client.setNumbers([numberA])
        _ = await client.joinFrames(company)
        await client.noteNumberTopicReply(topic, ok: false) // refused: nothing held
        await client.noteNumberTopicReply(topic, ok: true) // a stale ok lands after

        let pending = await client.numberTopicsToRejoin(company)
        XCTAssertEqual(pending, [topic])
    }

    /// A cost boundary rather than a tuning knob. Every `phx_join` runs
    /// `is_company_topic_member` → `member_number_level` against Postgres, and a
    /// member whose access really went away is refused on every sweep for as long
    /// as their number list still lists that number — the transport's own ~10s
    /// ladder would be six of those a minute, per number, forever. The web provider
    /// settled on the same minute for the same reason.
    func testTheRejoinSweepAsksOnceAMinute() {
        XCTAssertEqual(RealtimeClient.numberTopicRepairInterval, Duration.seconds(60))
    }
}
