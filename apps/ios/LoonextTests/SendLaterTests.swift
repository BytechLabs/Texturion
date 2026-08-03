import XCTest

@testable import Loonext

/// #233 — the send-later logic this phone owns, rather than the vocabulary.
///
/// `ScheduledSendTests` covers the shared spec (presets, reasons, recovery).
/// These are the decisions that only exist on the client: which zone the picker
/// speaks in, and how far the customer is from it.
///
/// The zone question is the one worth pinning. The picker is the SENDER's wall
/// clock and the presets are the CUSTOMER's morning, and a sentence that got
/// that backwards would send a text hours from where somebody put it — a silent
/// error, invisible in any test where the two zones happen to agree. Every case
/// below therefore uses two genuinely different zones.
///
/// Mirrors apps/android/…/features/compose/SendLaterTest.kt case for case.
final class SendLaterTests: XCTestCase {

    private let toronto = TimeZone(identifier: "America/Toronto")!
    private let vancouver = TimeZone(identifier: "America/Vancouver")!
    private let stJohns = TimeZone(identifier: "America/St_Johns")!
    /// Both zones on standard time, three apart.
    private let winter = Date(timeIntervalSince1970: 1_768_496_400)  // 2026-01-15T17:00Z

    // MARK: - hoursApart

    func testACustomerThreeHoursWestReadsAsBehindYou() {
        XCTAssertEqual(hoursApart(vancouver, from: toronto, at: winter), "3 hours behind you")
    }

    func testAndTheSamePairReadsAsAheadFromTheOtherSide() {
        XCTAssertEqual(hoursApart(toronto, from: vancouver, at: winter), "3 hours ahead of you")
    }

    func testOneHourIsWordsNotANumber() {
        // "1 hours behind you" is the kind of sentence that makes a product
        // look machine-written to the person reading it at 9:40pm.
        let halifax = TimeZone(identifier: "America/Halifax")!
        XCTAssertEqual(hoursApart(halifax, from: toronto, at: winter), "an hour ahead of you")
    }

    func testTheSameZoneSaysSoRatherThanSayingZero() {
        XCTAssertEqual(hoursApart(toronto, from: toronto, at: winter), "on the same clock")
    }

    func testAHalfHourOffsetRoundsTowardTheWholeHourItShares() {
        // Newfoundland is 90 minutes from Toronto. Integer division keeps this
        // at "an hour ahead", which is the honest short answer — the sentence
        // exists to stop somebody sending at 11pm their time, and 30 minutes
        // never changes that decision.
        XCTAssertEqual(hoursApart(stJohns, from: toronto, at: winter), "an hour ahead of you")
    }

    func testItIsMeasuredAcrossADstBoundaryNotFromATable() {
        // Between the US/Canada spring-forward and Europe's, London is 4 hours
        // from Toronto rather than the usual 5. A fixed offset table gets this
        // wrong for two weeks every year, in the direction that tells somebody
        // a message is landing at a civilised hour when it is not.
        let gap = Date(timeIntervalSince1970: 1_773_334_800)  // 2026-03-12T17:00Z
        let london = TimeZone(identifier: "Europe/London")!
        XCTAssertEqual(hoursApart(london, from: toronto, at: gap), "4 hours ahead of you")
    }

    // MARK: - senderClockNote

    func testThePickerSaysItIsYourOwnClock() {
        let note = senderClockNote(nil, device: toronto)
        XCTAssertTrue(note.hasPrefix("This is your own time."), note)
        XCTAssertTrue(note.hasSuffix(ScheduledSend.copyLine("picker_reassurance")), note)
    }

    func testAndNamesTheGapWhenWeActuallyKnowTheirZone() {
        let note = senderClockNote(
            DestinationClock(
                timezone: "America/Vancouver",
                source: "contact",
                local_hour: nil,
                quiet: nil
            ),
            device: toronto
        )
        XCTAssertTrue(note.contains("they are 3 hours behind you"), note)
    }

    func testTheWeakestRungClaimsNoGapAtAll() {
        // source='company' means we do NOT know their zone — it is the shop's
        // own clock wearing a label. Saying "they are 3 hours behind you" off
        // that rung would be inventing a fact, which is exactly what the
        // provenance ladder exists to prevent.
        let note = senderClockNote(
            DestinationClock(
                timezone: "America/Vancouver",
                source: "company",
                local_hour: nil,
                quiet: nil
            ),
            device: toronto
        )
        XCTAssertEqual(
            note,
            "This is your own time. " + ScheduledSend.copyLine("picker_reassurance")
        )
    }

    func testATimezoneWeCannotParseFallsBackRatherThanCrashing() {
        // The server sends an IANA id; a client that trusted it blindly would
        // crash the composer on a value it had never seen.
        let clock = DestinationClock(
            timezone: "Mars/Olympus_Mons",
            source: "contact",
            local_hour: nil,
            quiet: nil
        )
        XCTAssertEqual(
            senderClockNote(clock, device: toronto),
            "This is your own time. " + ScheduledSend.copyLine("picker_reassurance")
        )
        XCTAssertEqual(destinationZone(clock), TimeZone.current)
    }

    // MARK: - the quiet-hours sentence

    func testTheQuietHoursWarningNamesTheHourAndOffersBothDoors() {
        let message = quietHoursScheduleMessage(localHour: 23)
        XCTAssertTrue(message.contains("11pm"), message)
        XCTAssertTrue(
            message.hasSuffix(ScheduledSend.copyLine("quiet_hours_choice")),
            message
        )
    }

    func testAndFallsBackToTheHourlessSentenceWhenTheClockIsUnknown() {
        // #225 ask 2 is warned, never blocked — so the version with no hour to
        // quote still has to offer the choice, not just state the problem.
        let message = quietHoursScheduleMessage(localHour: nil)
        XCTAssertTrue(
            message.hasPrefix(ScheduledSend.copyLine("quiet_hours_unknown")),
            message
        )
        XCTAssertTrue(
            message.hasSuffix(ScheduledSend.copyLine("quiet_hours_choice")),
            message
        )
    }

    func testMiddayAndMidnightBothReadAsClockTimes() {
        // 0 and 12 are where a naive `hour % 12` prints "0am" and "0pm".
        XCTAssertTrue(quietHoursScheduleMessage(localHour: 0).contains("12am"))
        XCTAssertTrue(quietHoursScheduleMessage(localHour: 12).contains("12pm"))
    }

    // MARK: - sendAtOf

    func testTheLabelIsRenderedInTheDestinationZoneNotTheDevices() {
        // 8am Vancouver is 11am Toronto. A dispatcher in Toronto looking at
        // this send must see the customer's 8, because that is the time the
        // sender chose — the whole point of storing the zone on the row.
        let row = ScheduledMessage(
            id: "s1",
            conversation_id: "c1",
            body: "Still thinking about that quote?",
            send_at: "2026-01-15T16:00:00Z",
            clock_timezone: "America/Vancouver",
            status: "pending"
        )
        XCTAssertTrue(sendAtOf(row).contains("8:00"), sendAtOf(row))

        // A second row rather than a mutation: `clock_timezone` is a `let`,
        // because the zone a send was scheduled against is not something a
        // client may quietly change afterwards.
        let here = ScheduledMessage(
            id: "s1b",
            conversation_id: "c1",
            body: row.body,
            send_at: row.send_at,
            clock_timezone: "America/Toronto",
            status: "pending"
        )
        XCTAssertTrue(sendAtOf(here).contains("11:00"), sendAtOf(here))
    }

    func testAnUnparseableInstantDegradesRatherThanCrashing() {
        let row = ScheduledMessage(
            id: "s2",
            conversation_id: "c1",
            body: "…",
            send_at: "not a time",
            clock_timezone: "America/Toronto",
            status: "pending"
        )
        XCTAssertEqual(sendAtOf(row), "Scheduled")
    }

    func testAFractionalSecondsInstantStillParses() {
        // PostgREST renders timestamptz with a fractional part only sometimes,
        // and a single ISO8601DateFormatter silently returns nil for the other
        // shape — which would show every such row as a bare "Scheduled".
        let row = ScheduledMessage(
            id: "s3",
            conversation_id: "c1",
            body: "…",
            send_at: "2026-01-15T16:00:00.123Z",
            clock_timezone: "America/Vancouver",
            status: "pending"
        )
        XCTAssertNotEqual(sendAtOf(row), "Scheduled")
    }
}
