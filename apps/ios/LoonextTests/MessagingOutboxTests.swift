import XCTest
@testable import Loonext

/// #234 — the outbox (the Android `OutboxTest` twin).
///
/// Everything this has to survive — app kill, a reboot, two connectivity
/// callbacks racing on an LTE/Wi-Fi handoff — is exactly what a device test
/// would never reproduce reliably. So the store takes an injectable
/// `UserDefaults` and the flush is pure logic over it.
/// A clock pinned one hour after the fixtures below (2026-07-28T11:00Z).
///
/// EVERY fixture here is dated 2026-07-28T10:00Z and the flusher ages a row out
/// after `outboxAgeOutHours` (24h). Tests that took the default `now` were
/// therefore reading the REAL clock against a fixed date: they passed until
/// 2026-07-29T10:00Z and then began failing forever, which is exactly what
/// happened. The staleness tests below already inject `now` because the age is
/// the thing they assert; the rest have to pin it for the same reason — a test
/// whose result depends on today's date is a test that will be red one morning
/// for no reason anyone can see in the diff.
private let outboxTestNow = Date(timeIntervalSince1970: 1_785_236_400)

@MainActor
final class MessagingOutboxTests: XCTestCase {
    private var suiteName = ""
    private var defaults = UserDefaults.standard
    private var mediaRoot = FileManager.default.temporaryDirectory

    override func setUp() {
        super.setUp()
        // A throwaway suite per test: the whole point is durable storage, so
        // sharing `.standard` would let one test's queue leak into the next.
        // The photo directory is per-test for the same reason, and under
        // tmp so a failing run never writes into the real container.
        suiteName = "outbox-tests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName) ?? .standard
        mediaRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent(suiteName, isDirectory: true)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        try? FileManager.default.removeItem(at: mediaRoot)
        super.tearDown()
    }

    private func makeOutbox() -> Outbox {
        Outbox(defaults: defaults, mediaRoot: mediaRoot)
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
        makeOutbox().put(queued("k1", "2026-07-28T10:00:00Z"))

        let reopened = makeOutbox()
        XCTAssertEqual(reopened.all().count, 1, "the queue outlives the object")

        var attempts: [String] = []
        let flusher = OutboxFlusher(outbox: reopened, now: { outboxTestNow }) { item in
            attempts.append(item.localId)
            return .sent
        }
        let result = await flusher.flush()

        XCTAssertEqual(result.sent, ["k1"])
        XCTAssertEqual(attempts, ["k1"])
        XCTAssertTrue(makeOutbox().all().isEmpty)
    }

    func testEveryFlushReusesTheKeyMintedWhenThePersonPressedSend() async {
        // The row's localId IS its idempotency key, so a message that fails
        // offline and flushes an hour later is the SAME message to the server.
        // Minting a fresh key per attempt is how a retry becomes a duplicate.
        let outbox = makeOutbox()
        outbox.put(queued("k1", "2026-07-28T10:00:00Z"))

        var keys: [String] = []
        var failFirst = true
        let flusher = OutboxFlusher(outbox: outbox, now: { outboxTestNow }) { item in
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
        let outbox = makeOutbox()
        outbox.put(queued("k1", "2026-07-28T10:00:00Z"))

        var calls = 0
        let flusher = OutboxFlusher(outbox: outbox, now: { outboxTestNow }) { _ in
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
        let outbox = makeOutbox()
        outbox.put(queued("k1", "2026-07-28T10:00:00Z"))
        outbox.put(queued("k2", "2026-07-28T10:01:00Z"))

        var calls = 0
        let result = await OutboxFlusher(outbox: outbox, now: { outboxTestNow }) { _ in
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
        let outbox = makeOutbox()
        outbox.put(queued("later", "2026-07-28T10:05:00Z", body: "on my way"))
        outbox.put(queued("earlier", "2026-07-28T10:00:00Z", body: "running 20 late"))

        var order: [String] = []
        _ = await OutboxFlusher(outbox: outbox, now: { outboxTestNow }) { item in
            order.append(item.body)
            return .sent
        }.flush()

        XCTAssertEqual(order, ["running 20 late", "on my way"])
    }

    func testABlockedRowDoesNotHoldUpTheOnesBehindIt() async {
        // The blocked row waits for a person, which could be hours. Holding
        // the ones after it hostage would turn one refusal into a dead thread.
        let outbox = makeOutbox()
        var blockedRow = queued("blocked", "2026-07-28T10:00:00Z")
        blockedRow.blocked = true
        outbox.put(blockedRow)
        outbox.put(queued("fine", "2026-07-28T10:01:00Z"))

        let result = await OutboxFlusher(outbox: outbox, now: { outboxTestNow }) { _ in .sent }.flush()

        XCTAssertEqual(result.blocked, ["blocked"])
        XCTAssertEqual(result.sent, ["fine"])
        XCTAssertEqual(outbox.all().map(\.localId), ["blocked"])
    }

    func testTheQueueIsPerConversationForTheTimelineOldestFirst() {
        let outbox = makeOutbox()
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

    // MARK: - Photos

    func testAQueuedPhotosBytesSurviveTheProcessAndRideTheFlush() async {
        // The acceptance case "a queued message with a photo delivers the
        // photo". The picker's grant would be dead by now — the bytes are
        // ours, in our own container, which is why this can pass.
        let stored = makeOutbox().saveMedia(
            "k1",
            [OutboxMediaBytes(contentType: "image/jpeg", bytes: Data([1, 2, 3]))]
        )
        var row = queued("k1", "2026-07-28T10:00:00Z")
        row.media = stored
        makeOutbox().put(row)

        // A FRESH Outbox, as after a relaunch.
        let reopened = makeOutbox()
        var delivered: [Data] = []
        let flusher = OutboxFlusher(outbox: reopened, now: { outboxTestNow }) { item in
            for queued in item.media {
                if let bytes = reopened.readMedia(item.localId, queued) { delivered.append(bytes) }
            }
            return .sent
        }
        let result = await flusher.flush()

        XCTAssertEqual(result.sent, ["k1"])
        XCTAssertEqual(delivered, [Data([1, 2, 3])])
    }

    func testASentRowTakesItsPhotosWithIt() async {
        // Otherwise a phone that is always short of space accumulates every
        // photo ever texted from it.
        let outbox = makeOutbox()
        var row = queued("k1", "2026-07-28T10:00:00Z")
        row.media = outbox.saveMedia(
            "k1",
            [OutboxMediaBytes(contentType: "image/jpeg", bytes: Data([9]))]
        )
        outbox.put(row)

        _ = await OutboxFlusher(outbox: outbox, now: { outboxTestNow }) { _ in .sent }.flush()

        XCTAssertNil(outbox.readMedia("k1", row.media[0]), "no orphaned photo files")
    }

    func testPruningDropsPhotosWhoseMessageIsGoneAndKeepsTheRest() {
        // The crash window: files are written before the row, so a crash in
        // between leaves photos belonging to no message.
        let outbox = makeOutbox()
        let orphan = outbox.saveMedia(
            "orphan",
            [OutboxMediaBytes(contentType: "image/jpeg", bytes: Data([1]))]
        )
        var row = queued("k1", "2026-07-28T10:00:00Z")
        row.media = outbox.saveMedia(
            "k1",
            [OutboxMediaBytes(contentType: "image/jpeg", bytes: Data([2]))]
        )
        outbox.put(row)

        outbox.pruneMedia()

        XCTAssertNil(outbox.readMedia("orphan", orphan[0]))
        XCTAssertEqual(outbox.readMedia("k1", row.media[0]), Data([2]))
    }

    // MARK: - Age-out

    func testAMessageQueuedForMoreThanADayStopsAndAsks() async {
        // The phone that was in a drawer all weekend. "On my way" delivered
        // Monday morning is worse than not delivered — the customer reads it
        // as current.
        let outbox = makeOutbox()
        outbox.put(queued("k1", "2026-07-28T10:00:00Z"))
        var calls = 0
        let result = await OutboxFlusher(
            outbox: outbox,
            now: { Date(timeIntervalSince1970: 1_785_322_800) } // 2026-07-29T11:00Z
        ) { _ in
            calls += 1
            return .sent
        }.flush()

        XCTAssertEqual(result.blocked, ["k1"])
        XCTAssertEqual(calls, 0, "a stale row is never sent behind the person's back")
        XCTAssertEqual(outbox.all().first?.lastError, outboxStaleMessage)
    }

    func testAMessageJustUnderTheAgeOutStillSendsItself() async {
        // The boundary matters: a tech underground for a shift must not come
        // up to a message asking permission to do what it was already doing.
        let outbox = makeOutbox()
        outbox.put(queued("k1", "2026-07-28T10:00:00Z"))
        let result = await OutboxFlusher(
            outbox: outbox,
            now: { Date(timeIntervalSince1970: 1_785_319_140) } // 2026-07-29T09:59Z
        ) { _ in .sent }.flush()

        XCTAssertEqual(result.sent, ["k1"])
    }

    func testSendItAnywayActuallySendsRatherThanBeingReBlocked() async {
        // Without the acknowledgement the age check would fire again on the
        // very next flush, so the button would be one that does nothing.
        let outbox = makeOutbox()
        var row = queued("k1", "2026-07-28T10:00:00Z")
        row.staleAcknowledged = true
        outbox.put(row)

        let result = await OutboxFlusher(
            outbox: outbox,
            now: { Date(timeIntervalSince1970: 1_786_000_000) }
        ) { _ in .sent }.flush()

        XCTAssertEqual(result.sent, ["k1"])
    }

    func testAnUnreadableTimestampIsNeverTreatedAsStale() async {
        // Of the two ways to be wrong, guessing "old" from a timestamp we
        // cannot parse is the one that loses a delivery.
        let outbox = makeOutbox()
        outbox.put(queued("k1", "not a date"))
        let result = await OutboxFlusher(
            outbox: outbox,
            now: { Date(timeIntervalSince1970: 1_900_000_000) }
        ) { _ in .sent }.flush()

        XCTAssertEqual(result.sent, ["k1"])
    }
}
