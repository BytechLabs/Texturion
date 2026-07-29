import XCTest
@testable import Loonext

/// #234 — the outbox (the Android `OutboxTest` twin).
///
/// Everything this has to survive — app kill, a reboot, two connectivity
/// callbacks racing on an LTE/Wi-Fi handoff — is exactly what a device test
/// would never reproduce reliably. So the store takes an injectable
/// `UserDefaults` and the flush is pure logic over it.
@MainActor
final class MessagingOutboxTests: XCTestCase {
    private var suiteName = ""
    private var defaults = UserDefaults.standard

    override func setUp() {
        super.setUp()
        // A throwaway suite per test: the whole point is durable storage, so
        // sharing `.standard` would let one test's queue leak into the next.
        suiteName = "outbox-tests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName) ?? .standard
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    private func queued(
        _ id: String,
        _ at: String,
        body: String = "hi",
        conversationId: String = "conv"
    ) -> QueuedSend {
        QueuedSend(
            localId: id,
            companyId: "co",
            conversationId: conversationId,
            body: body,
            createdAt: at
        )
    }

    func testQueuedMessageSurvivesTheProcessAndSendsExactlyOnce() async {
        // The acceptance case: airplane mode, compose, send, kill, reboot,
        // connectivity back. A FRESH Outbox over the same UserDefaults is what
        // "after a reboot" means here — nothing is held in memory.
        Outbox(defaults: defaults).put(queued("k1", "2026-07-28T10:00:00Z"))

        let reopened = Outbox(defaults: defaults)
        XCTAssertEqual(reopened.all().count, 1, "the queue outlives the object")

        var attempts: [String] = []
        let flusher = OutboxFlusher(outbox: reopened) { item in
            attempts.append(item.localId)
            return .sent
        }
        let result = await flusher.flush()

        XCTAssertEqual(result.sent, ["k1"])
        XCTAssertEqual(attempts, ["k1"])
        XCTAssertTrue(Outbox(defaults: defaults).all().isEmpty)
    }

    func testEveryFlushReusesTheKeyMintedWhenThePersonPressedSend() async {
        // The row's localId IS its idempotency key, so a message that fails
        // offline and flushes an hour later is the SAME message to the server.
        // Minting a fresh key per attempt is how a retry becomes a duplicate.
        let outbox = Outbox(defaults: defaults)
        outbox.put(queued("k1", "2026-07-28T10:00:00Z"))

        var keys: [String] = []
        var failFirst = true
        let flusher = OutboxFlusher(outbox: outbox) { item in
            keys.append(item.localId)
            if failFirst {
                failFirst = false
                return .unreachable("no signal")
            }
            return .sent
        }
        _ = await flusher.flush()
        _ = await flusher.flush()

        XCTAssertEqual(keys, ["k1", "k1"])
        XCTAssertTrue(outbox.all().isEmpty)
    }

    func testARefusalStopsTheRowRatherThanRetryingItForever() async {
        // A STOP arriving while the message sat queued. The server answering
        // "no" is an ANSWER — retrying would either spam the gate or, worse,
        // eventually get a yes to a question the customer already answered.
        let outbox = Outbox(defaults: defaults)
        outbox.put(queued("k1", "2026-07-28T10:00:00Z"))

        var calls = 0
        let flusher = OutboxFlusher(outbox: outbox) { _ in
            calls += 1
            return .refused("This customer opted out.")
        }

        var result = await flusher.flush()
        XCTAssertEqual(result.blocked, ["k1"])
        let row = outbox.all()[0]
        XCTAssertTrue(row.blocked, "the row stays, so the person can see why")
        XCTAssertEqual(row.lastError, "This customer opted out.")

        result = await flusher.flush()
        XCTAssertEqual(result.blocked, ["k1"])
        XCTAssertEqual(calls, 1, "a blocked row is never re-sent")
    }

    func testUnreachableLeavesTheRowQueuedAndStopsThePass() async {
        // Down for one is down for the rest, and hammering it burns battery in
        // the exact place battery matters.
        let outbox = Outbox(defaults: defaults)
        outbox.put(queued("k1", "2026-07-28T10:00:00Z"))
        outbox.put(queued("k2", "2026-07-28T10:01:00Z"))

        var calls = 0
        let result = await OutboxFlusher(outbox: outbox) { _ in
            calls += 1
            return .unreachable("no signal")
        }.flush()

        XCTAssertEqual(result.stillQueued, ["k1"])
        XCTAssertEqual(calls, 1, "stops after the first unreachable")
        XCTAssertEqual(outbox.all().count, 2, "nothing is lost")
        XCTAssertEqual(outbox.all().first { $0.localId == "k1" }?.attempts, 1)
        XCTAssertEqual(outbox.all().first { $0.localId == "k1" }?.blocked, false)
    }

    func testMessagesFlushInTheOrderTheyWereWritten() async {
        // These are messages to one customer. Delivering "on my way" before
        // "running 20 late" would be worse than delivering both slowly.
        let outbox = Outbox(defaults: defaults)
        outbox.put(queued("later", "2026-07-28T10:05:00Z", body: "on my way"))
        outbox.put(queued("earlier", "2026-07-28T10:00:00Z", body: "running 20 late"))

        var order: [String] = []
        _ = await OutboxFlusher(outbox: outbox) { item in
            order.append(item.body)
            return .sent
        }.flush()

        XCTAssertEqual(order, ["running 20 late", "on my way"])
    }

    func testABlockedRowDoesNotHoldUpTheOnesBehindIt() async {
        // The blocked row waits for a person, which could be hours. Holding
        // the ones after it hostage would turn one refusal into a dead thread.
        let outbox = Outbox(defaults: defaults)
        var blockedRow = queued("blocked", "2026-07-28T10:00:00Z")
        blockedRow.blocked = true
        outbox.put(blockedRow)
        outbox.put(queued("fine", "2026-07-28T10:01:00Z"))

        let result = await OutboxFlusher(outbox: outbox) { _ in .sent }.flush()

        XCTAssertEqual(result.blocked, ["blocked"])
        XCTAssertEqual(result.sent, ["fine"])
        XCTAssertEqual(outbox.all().map(\.localId), ["blocked"])
    }

    func testTheQueueIsPerConversationForTheTimelineOldestFirst() {
        let outbox = Outbox(defaults: defaults)
        outbox.put(queued("b", "2026-07-28T10:05:00Z"))
        outbox.put(queued("a", "2026-07-28T10:00:00Z"))
        outbox.put(queued("other", "2026-07-28T10:01:00Z", conversationId: "elsewhere"))

        XCTAssertEqual(outbox.forConversation("conv").map(\.localId), ["a", "b"])
    }

    func testTheBubbleTellsTheThreeStatesApart() {
        // A queued message presented as on-its-way is the failure the whole
        // outbox exists to prevent, so the sentence has to differ.
        let sending = PendingSend(
            localId: "1", body: "hi", mediaCount: 0,
            createdAt: "2026-07-28T10:00:00Z", idempotencyKey: "1"
        )
        XCTAssertFalse(sending.queued)
        XCTAssertNil(sending.blockedReason)

        var waiting = sending
        waiting.queued = true
        XCTAssertTrue(waiting.queued)

        var refused = sending
        refused.blockedReason = "This customer opted out."
        XCTAssertNotNil(refused.blockedReason)
    }
}
