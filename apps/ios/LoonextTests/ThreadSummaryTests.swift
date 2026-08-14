import Foundation
import XCTest
@testable import Loonext

/// #247 — the catch-up.
///
/// This app compiles only in CI, so the parts assertable without a device are
/// asserted here: the offer rule against the SHIPPED constants, the wire shape,
/// the section taxonomy, the per-reason copy, the carrier standing surviving a
/// re-ask that is pending and one that came back rejected, and the properties no
/// unit test can see and that a source scan therefore holds — that carrier truth
/// renders above Lou's reading and outside every phase the card can be in, that
/// no hop of a re-ask can drop it, that a rejected ask says what happened
/// without wearing the mark that says Lou answered, that nothing asks for a
/// catch-up except a person tapping for one, that every settings save carries
/// the toggle, and that the card never trims what the server sent. Deliberately
/// uncounted: a number in this sentence is one more thing to go stale the next
/// time a scan is added.
///
/// The card itself is not rendered. A SwiftUI view needs a host, and a test that
/// stood one up would be asserting the host.
final class ThreadSummaryTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    /// A customer-visible message, only the fields the offer rule reads.
    private func message(
        _ id: String,
        direction: String = MessageDirection.inbound,
        at: String = "2026-08-05T12:00:00Z"
    ) -> Message {
        Message(
            id: id,
            conversation_id: "c1",
            direction: direction,
            body: "hello",
            status: nil,
            segments: nil,
            encoding: nil,
            sent_by_user_id: nil,
            error_code: nil,
            error_detail: nil,
            telnyx_message_id: nil,
            done_at: nil,
            done_by_user_id: nil,
            pinned_at: nil,
            pinned_by_user_id: nil,
            created_at: at,
            attachments: [],
            has_task: false,
            promoted_task: nil,
            task_id: nil,
            task: nil
        )
    }

    // MARK: - The offer rule, at the shipped boundaries

    func testALongThreadEarnsACatchUp() {
        // Asserted AT the constant rather than at a number typed here: a test
        // that said `12` would become a ceiling the day somebody tuned the rule,
        // and would fail for the change rather than catch a regression.
        XCTAssertEqual(
            threadCatchUpOffer(messageCount: threadSummaryMinMessages, idleMs: 0),
            .long(messages: threadSummaryMinMessages)
        )
        XCTAssertEqual(
            threadCatchUpOffer(messageCount: threadSummaryMinMessages - 1, idleMs: 0),
            .notOffered
        )
    }

    func testAForgottenThreadEarnsOneWithoutBeingLong() {
        // The second arm: the cost this attacks is not only length, it is
        // having forgotten.
        XCTAssertEqual(
            threadCatchUpOffer(
                messageCount: threadSummaryIdleMinMessages,
                idleMs: threadSummaryIdleMs
            ),
            .idle(days: threadSummaryIdleDays)
        )
        // A day short of the idle window is not forgotten yet.
        XCTAssertEqual(
            threadCatchUpOffer(
                messageCount: threadSummaryIdleMinMessages,
                idleMs: threadSummaryIdleMs - 1
            ),
            .notOffered
        )
        // Two messages from a month ago are read in four seconds, and a summary
        // of them can only be longer than they are.
        XCTAssertEqual(
            threadCatchUpOffer(
                messageCount: threadSummaryIdleMinMessages - 1,
                idleMs: threadSummaryIdleMs * 4
            ),
            .notOffered
        )
    }

    func testLengthWinsOverIdleSoTheReasonIsTheMoreUsefulOne() {
        // Both arms true. "34 messages" tells somebody more about why they are
        // being offered this than "quiet for 30 days" does.
        let offer = threadCatchUpOffer(
            messageCount: threadSummaryMinMessages + 22,
            idleMs: threadSummaryIdleMs * 4
        )
        XCTAssertEqual(offer, .long(messages: threadSummaryMinMessages + 22))
    }

    func testNotesAreNotCountedTowardBeingWorthACatchUp() {
        // Load-bearing twice over: a note never enters the prompt, and counting
        // one toward "long enough to summarise" would offer a catch-up for a
        // conversation that has barely happened. Enough notes to clear the bar
        // on their own, and one customer message.
        var messages = [message("m0")]
        for index in 0..<(threadSummaryMinMessages + 5) {
            messages.append(message("n\(index)", direction: MessageDirection.note))
        }
        XCTAssertEqual(threadCatchUpOffer(for: messages), .notOffered)
    }

    func testTheOfferReadsTheNewestCustomerVisibleMessageForIdle() {
        // The timeline is newest-first and notes are interleaved through it, so
        // a note at the top must not be mistaken for recent activity. Four
        // customer messages, all three weeks old, newest first.
        let formatter = ISO8601DateFormatter()
        let now = Date()
        let threeWeeks = Double(threadSummaryIdleMs) / 1000 * 3
        let old = formatter.string(from: now.addingTimeInterval(-threeWeeks))
        var messages = [
            message("note", direction: MessageDirection.note, at: formatter.string(from: now)),
        ]
        for index in 0..<threadSummaryIdleMinMessages {
            messages.append(message("m\(index)", at: old))
        }
        XCTAssertEqual(
            threadCatchUpOffer(for: messages, now: now),
            .idle(days: threadSummaryIdleDays * 3)
        )
    }

    func testAClockRunningBackwardsIsNotAForgottenThread() {
        // A device an hour ahead of the server would otherwise compute a
        // negative idle, and a negative reads as "not idle" only by luck.
        let now = Date()
        let future = ISO8601DateFormatter().string(from: now.addingTimeInterval(3600))
        let messages = (0..<threadSummaryIdleMinMessages).map { message("m\($0)", at: future) }
        XCTAssertEqual(threadCatchUpOffer(for: messages, now: now), .notOffered)
    }

    func testAnEmptyOrUnparseableThreadIsNeverOffered() {
        XCTAssertEqual(threadCatchUpOffer(for: []), .notOffered)
        let broken = (0..<threadSummaryMinMessages).map { message("m\($0)", at: "not a date") }
        XCTAssertEqual(threadCatchUpOffer(for: broken), .notOffered)
    }

    func testTheOfferLabelNamesTheSignalAndNothingElse() {
        // PORTAL-UX §3.1: the card names the concrete signal that placed it,
        // never a black-box score.
        XCTAssertEqual(threadCatchUpOfferLabel(.long(messages: 34)), "34 messages")
        XCTAssertEqual(threadCatchUpOfferLabel(.idle(days: 23)), "quiet for 23 days")
        XCTAssertEqual(threadCatchUpOfferLabel(.idle(days: 1)), "quiet for a day")
        // Nothing offered renders no chip rather than a blank one.
        XCTAssertNil(threadCatchUpOfferLabel(.notOffered))
    }

    // MARK: - The wire

    func testDecodesACatchUpWithItsCitations() throws {
        let body: ThreadCatchUp = try decode(
            """
            {"lines":[{"section":"asked","text":"No hot water since Sunday.",
            "message_id":"m1","at":"2026-08-01T14:02:00Z"}],"truncated":true,
            "opt_out":null,"opt_out_hint_at":null}
            """
        )
        XCTAssertEqual(body.lines.count, 1)
        XCTAssertEqual(body.lines.first?.message_id, "m1")
        XCTAssertEqual(body.lines.first?.at, "2026-08-01T14:02:00Z")
        XCTAssertTrue(body.truncated)
        XCTAssertNil(body.reason)
    }

    func testDecodesARefusalWithItsReasonAndItsCarrierTruth() throws {
        // The opt-out fields ride back on EVERY response shape, refusals
        // included — a card that dropped them on the failure path would hide a
        // STOP at the moment it had nothing else to show.
        let body: ThreadCatchUp = try decode(
            """
            {"lines":[],"reason":"over_cap","opt_out":{"source":"stop",
            "at":"2026-07-12T08:00:00Z"},"opt_out_hint_at":null}
            """
        )
        XCTAssertTrue(body.lines.isEmpty)
        XCTAssertEqual(body.reason, "over_cap")
        XCTAssertEqual(body.opt_out?.source, "stop")
    }

    func testDecodesABodyCarryingNothingAtAll() throws {
        // A lagging or leaner body decodes to "no catch-up", never throws and
        // takes the thread down with it.
        let body: ThreadCatchUp = try decode("{}")
        XCTAssertTrue(body.lines.isEmpty)
        XCTAssertNil(body.reason)
        XCTAssertFalse(body.truncated)
        XCTAssertFalse(body.cached)
        XCTAssertNil(body.opt_out)
    }

    func testTheCacheHitIsDistinguishableFromAFreshAnswer() throws {
        // Not shown to anybody. It exists so re-opening an unchanged thread can
        // be proven to have spent nothing.
        let body: ThreadCatchUp = try decode(#"{"lines":[],"cached":true}"#)
        XCTAssertTrue(body.cached)
    }

    func testTheCatchUpToggleDefaultsOnWhenTheServerOmitsIt() {
        // True by default here and on the server. A lagging field decoding to
        // OFF would silently retire the feature for everybody on an older build.
        let settings = try? JSONDecoder().decode(
            CompanyAiSettings.self,
            from: Data(#"{"enrich_task_address":true,"enrich_task_due":true}"#.utf8)
        )
        XCTAssertEqual(settings?.summarize_threads, true)
    }

    func testTheCatchUpToggleDecodesOffWhenTheWorkspaceTurnedItOff() throws {
        let settings: CompanyAiSettings = try decode(#"{"summarize_threads":false}"#)
        XCTAssertFalse(settings.summarize_threads)
    }

    // MARK: - The three sections

    func testGroupingKeepsTheShippedOrder() {
        // What THEY wanted, what WE said, what is still owed — the order the
        // question is asked in when somebody opens a thread cold. Fed in
        // reverse, so a grouping that merely preserved input order would pass
        // for the wrong reason.
        let lines = [
            line(ThreadSummarySectionId.open, "nobody gave them a time"),
            line(ThreadSummarySectionId.weSaid, "quoted the tank"),
            line(ThreadSummarySectionId.asked, "no hot water"),
        ]
        XCTAssertEqual(
            groupThreadSummary(lines).map(\.id),
            threadSummarySections.map(\.id)
        )
    }

    func testAnUnknownSectionIsDroppedRatherThanGivenAHeadingOfItsOwn() {
        // Three fixed headings, written once for all three clients. A client
        // inventing a fourth is exactly what the shared file exists to prevent.
        let lines = [
            line(ThreadSummarySectionId.asked, "no hot water"),
            line("urgency", "this one is urgent"),
        ]
        let groups = groupThreadSummary(lines)
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups.first?.lines.count, 1)
    }

    func testTwoLinesMayCiteTheSameMessage() {
        // A message can legitimately ground both an ask and a still-open loop.
        // Keying a ForEach on message_id would silently drop one of them, which
        // is a client deleting part of a catch-up somebody paid for.
        let lines = [
            line(ThreadSummarySectionId.asked, "no hot water", messageId: "m1"),
            line(ThreadSummarySectionId.open, "still no time given", messageId: "m1"),
        ]
        XCTAssertEqual(groupThreadSummary(lines).flatMap(\.lines).count, 2)
    }

    func testNothingIsDroppedForLength() {
        // The server owns the per-section and overall ceilings. A second ceiling
        // here would be a client silently hiding lines, and the two would drift
        // the first time either moved.
        let many = (0..<40).map { line(ThreadSummarySectionId.open, "loop \($0)") }
        XCTAssertEqual(groupThreadSummary(many).flatMap(\.lines).count, many.count)
    }

    func testEmptySectionsRenderNoHeading() {
        // A labelled blank reads as "we looked and found none", which is a claim
        // this card cannot make.
        let groups = groupThreadSummary([line(ThreadSummarySectionId.weSaid, "quoted")])
        XCTAssertEqual(groups.map(\.id), [ThreadSummarySectionId.weSaid])
    }

    // MARK: - Failure copy

    func testEveryReasonGetsItsOwnSentence() {
        // One blanket "nothing to show" hid real breakage behind what looked
        // like a shrug — the lesson `replyDraftMessage` already carries.
        let reasons = [
            "disabled", "spam", "too_short", "over_cap", "rate_limited",
            "model_error", "unavailable", "unusable_output",
            // #581: the AI gate refuses a workspace that has stopped paying.
            "subscription_inactive",
        ]
        let messages = reasons.map { threadCatchUpMessage($0) }
        // `model_error` and `unavailable` deliberately share one sentence: both
        // mean "Lou is not reachable right now", and splitting them would say
        // nothing anybody could act on differently.
        XCTAssertEqual(Set(messages).count, reasons.count - 1)
        XCTAssertTrue(messages.allSatisfy { !$0.isBlank })
    }

    func testTheDisabledSentenceNamesWhereTheSwitchIs() {
        XCTAssertTrue(threadCatchUpMessage("disabled").contains("Settings"))
    }

    func testEveryFailureLeavesTheReaderSomewhereTheyCanStillAct() {
        // The whole failure posture: a catch-up is a shortcut, never a
        // precondition. Every dead end has to end at the thread, which is
        // directly underneath the card.
        let reasons: [String?] = [
            "disabled", "spam", "too_short", "over_cap", "rate_limited",
            "model_error", "unavailable", "unusable_output", nil,
            // The second vocabulary: a request that never got a body. Held to
            // the identical standard, because a refusal the SERVER never saw is
            // still a dead end somebody is standing in.
            ApiErrorCode.forbidden, ApiErrorCode.notFound, ApiErrorCode.network,
            ApiErrorCode.serviceUnavailable,
        ]
        for reason in reasons {
            let message = threadCatchUpMessage(reason).lowercased()
            XCTAssertTrue(
                message.contains("thread") || message.contains("try again")
                    || message.contains("settings"),
                "\(reason ?? "nil") leaves nowhere to go: \(message)"
            )
        }
    }

    // MARK: - When the request itself failed

    func testARefusedRoleIsNotToldThatLouIsUnreachable() {
        // H4. `read_only` is refused at the capability gate on
        // `conversations.note`, because a catch-up spends from one monthly AI
        // budget the whole workspace shares. Every throw used to become
        // `model_error`, so the one person who can never use this feature was
        // told to try again — twice wrong: it blames a model that was never
        // asked, and it invites a press that cannot succeed.
        let refused = ApiError(
            code: ApiErrorCode.forbidden,
            message: "Insufficient role for this action.",
            httpStatus: 403
        )
        XCTAssertEqual(threadCatchUpFailureReason(refused) ?? "", ApiErrorCode.forbidden)
        // Held against the SHIPPED sentence rather than a phrase typed here, so
        // it stays true when either one is reworded.
        XCTAssertNotEqual(
            threadCatchUpMessage(threadCatchUpFailureReason(refused)),
            threadCatchUpMessage("model_error")
        )
    }

    func testEveryFailureThatCanReachTheCardHasItsOwnSentence() {
        // The four codes this route can actually fail with. Each one is a
        // different thing to do next — ask an owner, reopen the thread, check
        // your signal, wait — and a shared sentence would hide the difference.
        let codes = [
            ApiErrorCode.forbidden,
            ApiErrorCode.notFound,
            ApiErrorCode.network,
            ApiErrorCode.serviceUnavailable,
        ]
        let sentences = codes.map { threadCatchUpMessage($0) }
        XCTAssertEqual(
            Set(sentences).count,
            codes.count,
            "two of \(codes) are shown the same sentence"
        )
        for (code, sentence) in zip(codes, sentences) {
            XCTAssertNotEqual(
                sentence,
                threadCatchUpMessage(nil),
                "\(code) fell through to the shrug instead of saying what happened"
            )
            XCTAssertNotEqual(
                sentence,
                threadCatchUpMessage("model_error"),
                "\(code) blames Lou for something Lou was never asked"
            )
        }
    }

    func testTheLimiterAndTheAiGateAgreeOnOneSentence() {
        // The single deliberate overlap between the two vocabularies: the
        // limiter's 429 and the AI gate's `rate_limited` are the same news to a
        // reader. If the shipped code ever stops sharing that spelling, a 429
        // silently becomes the shrug — which is what this catches.
        XCTAssertEqual(
            threadCatchUpMessage(ApiErrorCode.rateLimited),
            threadCatchUpMessage("rate_limited")
        )
    }

    func testAFailureWithNoStructuralCodeBorrowsNobodyElsesReason() {
        // A decode failure or a cancelled task knows nothing about WHY, so it
        // must not claim a reason it cannot support. Vague and true beats
        // specific and false.
        XCTAssertNil(threadCatchUpFailureReason(CancellationError()))
        XCTAssertEqual(
            threadCatchUpMessage(threadCatchUpFailureReason(CancellationError())),
            threadCatchUpMessage(nil)
        )
    }

    func testAnUnknownReasonStillLandsSomewhereUseful() {
        // A reason the server adds later must degrade to a sentence that still
        // points at the thread, never to a blank card.
        let unknown = threadCatchUpMessage("something_new_from_the_server")
        XCTAssertEqual(unknown, threadCatchUpMessage(nil))
        XCTAssertTrue(unknown.contains("thread"))
    }

    // MARK: - Carrier truth

    func testACustomerStopIsNamedAsOneAndSaysNothingCanBeSent() {
        // BINDING: a STOP can only be lifted by the customer. The summary is
        // what a hurried person reads INSTEAD of the thread, so it must not be
        // the only thing between them and texting somebody who said stop.
        let result = ThreadCatchUp(
            lines: [line(ThreadSummarySectionId.open, "they never got the invoice")],
            opt_out: ThreadSummaryOptOut(source: optOutSourceStop, at: "2026-07-12T08:00:00Z")
        )
        let notice = threadCatchUpOptOutNotice(result.carrier)
        XCTAssertNotNil(notice)
        XCTAssertTrue(notice?.contains("STOP") == true)
    }

    func testARecordedOptOutIsNotDressedUpAsACarrierStop() {
        // Only one of the two can be undone here, and naming which is what
        // stops somebody trying to "fix" a carrier block they cannot fix.
        let recorded = ThreadCatchUp(
            opt_out: ThreadSummaryOptOut(source: "manual", at: "2026-07-12T08:00:00Z")
        )
        let notice = threadCatchUpOptOutNotice(recorded.carrier)
        XCTAssertNotNil(notice)
        XCTAssertFalse(notice?.contains("STOP") == true)
        XCTAssertNotEqual(
            notice,
            threadCatchUpOptOutNotice(
                ThreadCatchUp(
                    opt_out: ThreadSummaryOptOut(source: optOutSourceStop, at: "2026-07-12T08:00:00Z")
                ).carrier
            )
        )
    }

    func testTheOptOutNoticeOutranksEveryLineOnTheCard() {
        // The notice is a FACT read from `opt_outs`, and the lines are one
        // machine's reading. A card carrying both has to be able to say the
        // first even when the second is what somebody asked for.
        let full = ThreadCatchUp(
            lines: (0..<5).map { line(ThreadSummarySectionId.asked, "line \($0)") },
            opt_out: ThreadSummaryOptOut(source: optOutSourceStop, at: "2026-07-12T08:00:00Z")
        )
        XCTAssertNotNil(threadCatchUpOptOutNotice(full.carrier))
    }

    func testAnOptOutHintIsSurfacedWithoutClaimingItBlocksAnything() {
        // #396: somebody wrote something that reads like a STOP without being
        // one. It does not block a send, and saying it did would be false.
        let hinted = ThreadCatchUp(opt_out_hint_at: "2026-07-12T08:00:00Z")
        let notice = threadCatchUpOptOutNotice(hinted.carrier)
        XCTAssertNotNil(notice)
        XCTAssertFalse(notice?.lowercased().contains("nothing can be sent") == true)
    }

    func testNoStandingMeansNoClaimEitherWay() {
        // The `unavailable` refusal the server returns when it could not
        // establish the standing carries null opt-out fields. Inventing a
        // reassuring "they haven't opted out" from that would be the worst
        // possible guess.
        XCTAssertNil(threadCatchUpOptOutNotice(ThreadCatchUp(reason: "unavailable").carrier))
        // The same claim one level down, where the carry-over reads it: an
        // unknown standing is not an empty one it can print.
        XCTAssertNil(threadCatchUpOptOutNotice(.unknown))
    }

    // MARK: - The fact has to outlive the request

    func testAPendingReAskStillSaysTheContactTextedSTOP() {
        // The defect: asking again cleared the answer that carried the STOP,
        // so the card said nothing about it for the length of the request —
        // the exact moment somebody is looking at it, and the exact thing they
        // must not act without. Driven through the shipped transition rather
        // than a state assembled here, because the transition IS the fix.
        let answered = ThreadCatchUpState.shown(
            ThreadCatchUp(
                lines: [line(ThreadSummarySectionId.open, "they never got the invoice")],
                opt_out: ThreadSummaryOptOut(source: optOutSourceStop, at: "2026-07-12T08:00:00Z")
            )
        )
        let pending = answered.asking()
        XCTAssertTrue(pending.isLoading)
        XCTAssertEqual(
            threadCatchUpOptOutNotice(pending.visibleCarrier),
            threadCatchUpOptOutNotice(answered.visibleCarrier),
            "a pending re-ask says less about the carrier than the answer before it"
        )
        XCTAssertTrue(
            threadCatchUpOptOutNotice(pending.visibleCarrier)?.contains("STOP") == true
        )
    }

    func testTheFactSurvivesTheHideThatIsTheOnlyWayToReAskOnThisClient() {
        // A shown card has a Hide and no ask control, so every second request
        // on iOS goes `.shown` -> `.idle` -> `.loading`. A carry-over that only
        // covered the last hop would be dead code here: the fact would already
        // have been dropped at the first one.
        let answered = ThreadCatchUpState.shown(
            ThreadCatchUp(
                opt_out: ThreadSummaryOptOut(source: "manual", at: "2026-07-12T08:00:00Z")
            )
        )
        let reAsked = answered.putAway().asking()
        XCTAssertNotNil(
            threadCatchUpOptOutNotice(reAsked.visibleCarrier),
            "the standing was lost at the Hide, before the re-ask could carry it"
        )
        XCTAssertEqual(reAsked.carrier, answered.carrier)
    }

    func testAPutAwayCardRemembersTheStandingWithoutPrintingIt() {
        // Two different questions, and the card answers them differently on
        // purpose: `carrier` is what it has been TOLD, `visibleCarrier` what it
        // may PRINT. Hiding is somebody putting Lou's reading away, and the
        // standing still governs the composer underneath — but forgetting it
        // here would take the re-ask down with it.
        let hidden = ThreadCatchUpState.shown(
            ThreadCatchUp(
                opt_out: ThreadSummaryOptOut(source: optOutSourceStop, at: "2026-07-12T08:00:00Z")
            )
        ).putAway()
        XCTAssertNotNil(threadCatchUpOptOutNotice(hidden.carrier))
        XCTAssertNil(threadCatchUpOptOutNotice(hidden.visibleCarrier))
    }

    func testARejectedReAskStillSaysTheContactTextedSTOP() {
        // The other end of the same request, and the half that shipped wrong.
        // The pending phase held the standing correctly; then the ask came back
        // REJECTED — the capability gate, a dead connection, a thread that is
        // gone — and the card drew a refusal this client had written itself,
        // whose empty carrier fields read as "nobody has opted out". So the STOP
        // came off the screen when the request ENDED rather than when it
        // started, and nothing was going to put it back.
        //
        // Driven through the whole shipped round trip on this client, because
        // that is what has to hold: a shown card has a Hide and no ask control.
        let stated = ThreadCatchUpState.shown(
            ThreadCatchUp(
                lines: [line(ThreadSummarySectionId.open, "they never got the invoice")],
                opt_out: ThreadSummaryOptOut(source: optOutSourceStop, at: "2026-07-12T08:00:00Z")
            )
        )
        let turnedAway = stated.putAway().asking().answered(
            .rejected(reason: ApiErrorCode.network)
        )
        XCTAssertFalse(turnedAway.isLoading, "a rejected ask is not still in flight")
        XCTAssertEqual(
            threadCatchUpOptOutNotice(turnedAway.visibleCarrier),
            threadCatchUpOptOutNotice(stated.visibleCarrier),
            "a rejected re-ask says less about the carrier than the answer before it"
        )
        XCTAssertTrue(
            threadCatchUpOptOutNotice(turnedAway.visibleCarrier)?.contains("STOP") == true
        )
    }

    func testARejectedAskSaysWhatHappenedWithItsOwnReason() {
        // A refusal is silence with a reason; a rejected request is not silence
        // at all — it is a control that was pressed and produced nothing, and
        // resting the card would make it a button that appears to do nothing.
        // The reason it carries is the failure's own structural code, so the
        // phase can be spoken from without borrowing a story about a model that
        // was never reached.
        let refused = ApiError(
            code: ApiErrorCode.forbidden,
            message: "Insufficient role for this action.",
            httpStatus: 403
        )
        let turnedAway = ThreadCatchUpState.idle(.unknown).asking().answered(
            .rejected(reason: threadCatchUpFailureReason(refused))
        )
        guard case .failed(let reason, _) = turnedAway else {
            return XCTFail("a rejected ask no longer lands on a phase of its own")
        }
        // Against the SHIPPED sentences rather than phrases typed here.
        XCTAssertEqual(
            threadCatchUpMessage(reason),
            threadCatchUpMessage(ApiErrorCode.forbidden)
        )
        XCTAssertNotEqual(threadCatchUpMessage(reason), threadCatchUpMessage("model_error"))
    }

    func testAnAnswerClearsTheStandingTheCardHeldThroughARejection() {
        // The hold is for the gap, not for ever — the same rule the pending
        // phase carries, one hop later where it is easier to get wrong: a
        // `.failed` phase can sit on the card indefinitely, so a standing it
        // kept stale would keep claiming a block that no longer exists.
        let held = ThreadCatchUpState.shown(
            ThreadCatchUp(
                opt_out: ThreadSummaryOptOut(source: "manual", at: "2026-07-12T08:00:00Z")
            )
        ).asking().answered(.rejected(reason: ApiErrorCode.network))
        XCTAssertNotNil(threadCatchUpOptOutNotice(held.visibleCarrier))

        let lifted = held.putAway().asking().answered(
            .answered(
                ThreadCatchUp(
                    lines: [line(ThreadSummarySectionId.open, "they never got the invoice")]
                )
            )
        )
        XCTAssertNil(
            threadCatchUpOptOutNotice(lifted.visibleCarrier),
            "the held standing outlived the answer that dropped it"
        )
    }

    func testAServerRefusalSpeaksForItselfWhereARejectedRequestCannot() {
        // The line the whole fix is drawn on. A refusal IS an answer: the server
        // read `opt_outs` and reported the standing along with its reason, so an
        // empty one is a fact and outranks anything held. Only a request that
        // never came back with a body is missing that — and folding the two into
        // one shape is what made a rejection look authoritative.
        let stopped = ThreadCatchUpState.shown(
            ThreadCatchUp(
                opt_out: ThreadSummaryOptOut(source: "manual", at: "2026-07-12T08:00:00Z")
            )
        ).asking()
        XCTAssertNil(
            threadCatchUpOptOutNotice(
                stopped.answered(.answered(ThreadCatchUp(reason: "over_cap"))).visibleCarrier
            ),
            "a refusal the server sent was overruled by a fact it did not repeat"
        )
        XCTAssertNotNil(
            threadCatchUpOptOutNotice(
                stopped.answered(.rejected(reason: "over_cap")).visibleCarrier
            ),
            "a request that never got a body was read as if the server had spoken"
        )
    }

    func testARejectedFirstAskClaimsNoStandingNobodyHasReportedYet() {
        // The direction that would be worse than the bug: inventing a standing
        // out of a failure. Nothing has answered on this thread, so there is
        // nothing to hold and nothing to print.
        let first = ThreadCatchUpState.idle(.unknown).asking().answered(
            .rejected(reason: ApiErrorCode.network)
        )
        XCTAssertNil(threadCatchUpOptOutNotice(first.visibleCarrier))
    }

    func testAFirstAskClaimsNoStandingNobodyHasReportedYet() {
        // The other direction, and the one that would be worse: a carry-over
        // that invented a standing on the first ask of a fresh thread. Nothing
        // has answered yet, so there is nothing to hold.
        let first = ThreadCatchUpState.idle(.unknown).asking()
        XCTAssertNil(threadCatchUpOptOutNotice(first.visibleCarrier))
    }

    func testAnAnswerOutranksTheFactTheCardWasHoldingForIt() {
        // The carry-over is for the WAIT, not for ever. A recorded opt-out can
        // be lifted (`ThreadController.revokeOptOut`), and a notice that
        // outlived the answer dropping it would keep claiming a block that no
        // longer exists — false in the one direction that costs a customer a
        // reply they were waiting for.
        let pending = ThreadCatchUpState.shown(
            ThreadCatchUp(
                opt_out: ThreadSummaryOptOut(source: "manual", at: "2026-07-12T08:00:00Z")
            )
        ).asking()
        XCTAssertNotNil(threadCatchUpOptOutNotice(pending.visibleCarrier))
        let lifted = ThreadCatchUpState.shown(
            ThreadCatchUp(
                lines: [line(ThreadSummarySectionId.open, "they never got the invoice")]
            )
        )
        XCTAssertNil(threadCatchUpOptOutNotice(lifted.visibleCarrier))
    }

    // MARK: - The ledger

    func testTheCatchUpReportsAgainstTheLedgersOwnFeatureKey() {
        // An outcome lands on the same row the spend does. A friendlier spelling
        // would open a second row and separate cost from value permanently, so
        // this is the server's key verbatim (`AI_UNIT_COST_CENTS.thread_summary`
        // / `THREAD_SUMMARY_FEATURE_SPEC.key`).
        XCTAssertEqual(AiOutcome.featureThreadSummary, "thread_summary")
        // The spec records `used: "opened a cited message"` and null for the
        // other two, so `used` is the only counter this feature has.
        XCTAssertEqual(AiOutcome.openedCitedMessage, AiOutcome.used)
    }

    // MARK: - The hand port matches its TypeScript source

    func testTheOfferRuleMatchesTheSharedRuleItWasPortedFrom() throws {
        // Swift cannot import TypeScript, so this rule exists three times and
        // the server's copy is the one that counts. A silent divergence here
        // offers a catch-up the server then refuses, or withholds one it would
        // have given. Read from the source rather than restated, because a
        // restated number is a second copy that drifts.
        let shared = try sharedThreadSummarySource()
        XCTAssertEqual(
            tsNumber("THREAD_SUMMARY_MIN_MESSAGES", in: shared),
            threadSummaryMinMessages
        )
        XCTAssertEqual(
            tsNumber("THREAD_SUMMARY_IDLE_DAYS", in: shared),
            threadSummaryIdleDays
        )
        XCTAssertEqual(
            tsNumber("THREAD_SUMMARY_IDLE_MIN_MESSAGES", in: shared),
            threadSummaryIdleMinMessages
        )
    }

    func testTheThreeHeadingsAreTheSharedOnesVerbatim() throws {
        // #437 found one claim written sixteen different ways because nothing
        // owned the words. Three clients each inventing a heading for "what we
        // committed to" is that failure waiting to happen again.
        let shared = try sharedThreadSummarySource()
        XCTAssertEqual(threadSummarySections.count, 3)
        for section in threadSummarySections {
            XCTAssertTrue(
                shared.contains("label: \"\(section.label)\""),
                "the heading \"\(section.label)\" is not in the shared source"
            )
            XCTAssertTrue(
                shared.contains("id: \"\(section.id)\""),
                "the section id \"\(section.id)\" is not in the shared source"
            )
        }
    }

    func testTheAttributionLineIsTheSharedOneVerbatim() throws {
        // The sentence that makes the card honest: whose reading this is, and
        // that the thread is still the arbiter.
        let shared = try sharedThreadSummarySource()
        XCTAssertTrue(
            shared.contains(threadSummaryAttribution),
            "the attribution differs from the shared source: \(threadSummaryAttribution)"
        )
    }

    // MARK: - Source scans: the properties no unit test can see

    func testCarrierTruthIsRenderedBeforeAnyLineOfTheCatchUp() throws {
        // "Never bury an opt-out" is an ORDERING, and ordering is a fact about
        // the view body that no assertion on a function can reach. If the notice
        // moved below the lines it would still render, still pass every test
        // above, and still be the second thing a hurried person read.
        let card = try iosSource("Features/Thread/ThreadSummaryCard.swift")
        guard let notice = card.range(of: "if let notice = threadCatchUpOptOutNotice("),
              let lines = card.range(of: "ForEach(groups")
        else {
            return XCTFail(
                "ThreadSummaryCard no longer renders the opt-out notice and the "
                    + "grouped lines the way this scan recognises them — re-point it "
                    + "rather than deleting it."
            )
        }
        XCTAssertTrue(
            notice.lowerBound < lines.lowerBound,
            "the opt-out notice renders AFTER the catch-up lines. Carrier truth "
                + "outranks a tidy paragraph."
        )
    }

    func testCarrierTruthRendersOnEveryPhaseAndNotOnlyOnAnAnswer() throws {
        // H3, which ANDROID shipped: its note rendered only inside the `Ready`
        // branch, so a workspace that had been STOPped was told nothing about it
        // whenever Lou refused — the exact moment the card has nothing else on
        // it. iOS shipped the same shape one level up: the notice was inside the
        // `.shown` arm, so a PENDING re-ask hid it too.
        //
        // The needle is therefore the phase switch itself, not the
        // empty/non-empty branch inside one of its arms. Everything after
        // `switch state` is one phase or another; a notice drawn before it is
        // drawn on all three.
        let card = try iosSource("Features/Thread/ThreadSummaryCard.swift")
        guard let notice = card.range(of: "if let notice = threadCatchUpOptOutNotice("),
              let phases = card.range(of: "switch state {"),
              let branch = card.range(of: "if groups.isEmpty")
        else {
            return XCTFail(
                "ThreadSummaryCard no longer renders the opt-out notice, the phase "
                    + "switch and the empty/non-empty branch the way this scan "
                    + "recognises them — re-point it rather than deleting it."
            )
        }
        XCTAssertTrue(
            notice.lowerBound < phases.lowerBound,
            "the opt-out notice is INSIDE one phase of the card, so the other "
                + "phases hide a STOP. It must render before the card switches on "
                + "what it is doing."
        )
        // Kept from the older, weaker version of this scan: the notice is also
        // above the refusal/answer branch, which the assertion above implies
        // only while that branch stays inside the switch.
        XCTAssertTrue(notice.lowerBound < branch.lowerBound)
    }

    func testTheCardPrintsWhatThePhaseIsEntitledToSayRatherThanTheResult() throws {
        // The notice now renders where there may be no result at all, so it
        // must read the phase's own carrier. `result.carrier` compiles in the
        // arm it used to live in and would quietly put the notice back inside
        // one phase.
        let card = try iosSource("Features/Thread/ThreadSummaryCard.swift")
        // The OPENING of the call, over whitespace-collapsed source.
        //
        // What this asserts is WHICH arm the card reads the carrier from —
        // `state.visibleCarrier`, not `result.carrier`. It has no opinion about
        // the rest of the argument list, and it used to pin the closing paren:
        // #228 then appended the reader's language, and rather than admit a
        // second argument the notice was left permanently English to keep this
        // green. Collapsing whitespace so the call may also wrap across lines,
        // which is the other thing this should never have had a view on.
        let flat = card.split(whereSeparator: \.isWhitespace).joined()
        XCTAssertTrue(
            flat.contains("threadCatchUpOptOutNotice(state.visibleCarrier"),
            "the card no longer asks the PHASE what it may say about the carrier."
        )
    }

    func testNoHopOfAReAskCanDropTheCarrierStanding() throws {
        // The transitions are `ThreadCatchUpState.asking()` / `putAway()` /
        // `answered(_:)`, and all three exist because the fact has to survive
        // them. A controller writing `.loading(.unknown)`, `.idle(.unknown)` or
        // a phase built out of a rejected request itself compiles, reads
        // perfectly well, and puts the bug straight back — so what is scanned
        // for is the controller CONSTRUCTING a phase rather than moving to one.
        //
        // The third hop is the one that shipped wrong, and it is the worst of
        // the three: the first two lose the standing for the length of a
        // request, and a phase assembled from a rejection loses it for good.
        let controller = try iosSource("Features/Thread/ThreadController.swift")
        for (function, transitions) in [
            ("func askForCatchUp()", ["catchUp.asking()", "catchUp.answered("]),
            ("func hideCatchUp()", ["catchUp.putAway()"]),
        ] {
            guard let body = functionBody(function, in: controller) else {
                return XCTFail("\(function) is gone or renamed — re-point this scan.")
            }
            for transition in transitions {
                XCTAssertTrue(
                    body.contains(transition),
                    "\(function) no longer moves through \(transition), which is "
                        + "one of the places the carrier standing is carried forward."
                )
            }
            for constructed in [".loading(", ".idle(", ".shown(", ".failed("] {
                XCTAssertFalse(
                    body.contains(constructed),
                    "\(function) builds \(constructed)…) itself. A phase assembled "
                        + "at the call site is a phase that can be assembled without "
                        + "the STOP the last answer carried."
                )
            }
        }
    }

    func testARefusedCatchUpSaysWhatHappenedInsteadOfDrawingNothing() throws {
        // The other half of H4, which WEB shipped: after a rejected request its
        // card's entire text was a heading and a placeholder, which is
        // indistinguishable from a dead button. Silence is the right degradation
        // for "no binding"; it is the wrong one for "your request was refused".
        let card = try iosSource("Features/Thread/ThreadSummaryCard.swift")
        XCTAssertTrue(
            card.contains("threadCatchUpMessage(result.reason)"),
            "the card no longer renders a sentence for an empty catch-up, so a "
                + "refusal now reads as a button that did nothing."
        )
    }

    func testARejectedAskGetsASentenceAndNotTheAnsweredMark() throws {
        // Two claims about the same phase, because they are the same claim: the
        // card has to say what happened, and it must not wear the mark that says
        // Lou answered while saying it. `.done` is the ring blooming — web
        // guards the identical thing on the identical event — and a bloom over
        // "Can't reach Loonext" credits a model that was never reached.
        //
        // The mark is a view property, so no assertion on a function reaches it.
        let card = try iosSource("Features/Thread/ThreadSummaryCard.swift")
        guard let rejected = functionBody("private func rejectedBody(", in: card),
              let answered = functionBody("private func resultBody(", in: card)
        else {
            return XCTFail(
                "ThreadSummaryCard no longer draws the rejected and answered "
                    + "phases as the two functions this scan recognises — re-point "
                    + "it rather than deleting it."
            )
        }
        XCTAssertTrue(
            rejected.contains("threadCatchUpMessage(reason)"),
            "a rejected ask draws no sentence, so the card rests as though "
                + "nobody had pressed anything."
        )
        XCTAssertTrue(
            rejected.contains("header(mark: .idle)"),
            "a rejected ask wears the answered mark. Nothing answered it."
        )
        XCTAssertTrue(
            answered.contains("header(mark: .done)"),
            "an answered catch-up no longer wears the answered mark, so the two "
                + "phases are indistinguishable and this scan proves nothing."
        )
    }

    func testTheRepositoryReportsTheFailureItHadRatherThanOneItInvented() throws {
        // The bug H4 names, at the place it was manufactured: a blanket
        // `reason: "model_error"` in the catch. The mapper is pure and asserted
        // above; this is what proves the repository actually uses it, and that
        // no second literal reason grew back beside it.
        let repository = try iosSource("Features/Thread/MessagingRepository.swift")
        guard let body = functionBody("func summarizeThread(", in: repository) else {
            return XCTFail("summarizeThread is gone or renamed — re-point this scan.")
        }
        XCTAssertTrue(
            body.contains("threadCatchUpFailureReason(error)"),
            "summarizeThread no longer maps its failure through the one function "
                + "that knows what this client may honestly claim."
        )
        XCTAssertFalse(
            body.contains("reason: \""),
            "summarizeThread names a reason itself. A client cannot know that a "
                + "MODEL failed — only that its own request did."
        )
        // Named separately from the pattern above, because the shape this
        // regressed into once is a FALLBACK — `threadCatchUpFailureReason(error)
        // ?? "model_error"` — which keeps the mapper, does not match
        // `reason: "`, and puts the same lie back on the card.
        XCTAssertFalse(
            body.contains("model_error"),
            "summarizeThread claims a model failure. Only the server can observe "
                + "one, and it says so in the body when it does."
        )
        // The SECOND thing it must not invent, and the one that cost a STOP.
        // Every response the server sends states the contact's carrier standing;
        // a response written on the device states null, and null is read
        // downstream as "we asked and nobody has opted out". The two claims are
        // indistinguishable once they share a type, so they must not share one.
        XCTAssertFalse(
            body.contains("ThreadCatchUp("),
            "summarizeThread builds a response the server never sent. Its empty "
                + "carrier fields then read as an authoritative \"nobody has "
                + "opted out\", which is how a rejected re-ask erased a STOP."
        )
        XCTAssertTrue(
            body.contains(".rejected("),
            "summarizeThread no longer reports a rejected request AS one, so "
                + "nothing downstream can tell it from the server refusing."
        )
    }

    func testNothingAsksForACatchUpExceptAPersonTappingForOne() throws {
        // The cost mandate as a guard. A thread is the largest input this
        // product hands a model, so an automatic trigger — on open, on an
        // inbound, on reconnect — would make the spend scale with the CUSTOMER's
        // behaviour rather than the crew's, and would do it silently.
        //
        // A WHITELIST, not a blacklist of trigger names. The first version of
        // this scan looked backwards a few lines for `.task` / `.onAppear` and
        // was proved decorative the moment it was broken: the obvious defect is
        // `.task { controller.askForCatchUp() }` on ONE line, where there is no
        // preceding line to find the trigger on. Naming the single call site
        // that is allowed catches every spelling of the mistake, including the
        // ones nobody has invented yet.
        var sites: [String] = []
        for relative in [
            "Features/Thread/ThreadView.swift",
            "Features/Thread/ThreadController.swift",
        ] {
            let source = try iosSource(relative)
            for (index, raw) in source.split(
                separator: "\n",
                omittingEmptySubsequences: false
            ).enumerated() {
                let line = String(raw)
                guard line.contains("askForCatchUp()") else { continue }
                // Whole-line comments are prose, and the declaration itself is
                // not a call site.
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("//") || trimmed.hasPrefix("*") { continue }
                if line.contains("func askForCatchUp") { continue }
                sites.append("\(relative):\(index + 1)  \(trimmed)")
            }
        }
        XCTAssertEqual(
            sites.count,
            1,
            "a catch-up may be asked for from exactly one place — the card's "
                + "onAsk, which is a person tapping. Found: \(sites)"
        )
        XCTAssertTrue(
            sites.first?.contains("onAsk:") == true,
            "the only ask for a catch-up must be the card's onAsk. Found: \(sites)"
        )
    }

    func testEverySaveOnTheAiSettingsScreenCarriesTheCatchUpToggle() throws {
        // The PATCH reads an ABSENT field as "leave it alone", so a call site
        // that dropped this would write the client's default over somebody's
        // choice — turning catch-ups back on for a workspace that turned them
        // off, from a tap on an unrelated toggle.
        let section = try iosSource("Features/Settings/AiSection.swift")
        // `saveDescription(` does not match: the needle requires the paren
        // immediately after the name. The declaration `private func save(` does,
        // and is checked too — its parameter list is where a defaulted
        // `catchUp:` would hide, which is the same defect one level up.
        let calls = Array(section.components(separatedBy: "save(").dropFirst())
        XCTAssertFalse(calls.isEmpty, "no save( call sites found — re-point this scan")
        for (index, call) in calls.enumerated() {
            // Every argument in this file is a plain path or `$0`, so the list
            // ends at the first `)`.
            let arguments = String(call.prefix(while: { $0 != ")" }))
            XCTAssertTrue(
                arguments.contains("catchUp:"),
                "save( call site #\(index + 1) omits catchUp: — an absent field "
                    + "means \"leave it alone\", so the default would be written "
                    + "over the workspace's choice."
            )
        }
    }

    func testTheCardNeverTrimsWhatTheServerSent() throws {
        // The server enforces the per-section and overall ceilings. A `prefix`
        // here would be a second ceiling that drifts, and a client quietly
        // deleting part of a catch-up somebody paid for.
        let card = try iosSource("Features/Thread/ThreadSummaryCard.swift")
        for (index, raw) in card.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            let line = String(raw)
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("//") || trimmed.hasPrefix("*") { continue }
            XCTAssertFalse(
                line.contains(".prefix(") || line.contains(".dropLast("),
                "ThreadSummaryCard.swift:\(index + 1) trims the server's lines: \(trimmed)"
            )
        }
    }

    // MARK: - Helpers

    private func line(
        _ section: String,
        _ text: String,
        messageId: String = "m1",
        at: String = "2026-08-01T14:02:00Z"
    ) -> ThreadSummaryLine {
        ThreadSummaryLine(section: section, text: text, message_id: messageId, at: at)
    }

    /// One declaration's body, sliced out of a source file by text.
    ///
    /// The body ends where the next declaration's doc block begins, which is
    /// crude and is what a scan can have: the alternative to reading source as
    /// text is a parser, and these scans hold properties no assertion on a
    /// function reaches — an ordering inside a view body, a call site that must
    /// not exist, a mark that must not bloom.
    ///
    /// Nil when the declaration is not there, so every caller has to say out
    /// loud what a missing subject means. It is never "pass": a scan that cannot
    /// find what it checks has verified nothing (see `MissingSource`).
    private func functionBody(_ declaration: String, in source: String) -> String? {
        guard let found = source.range(of: declaration) else { return nil }
        let rest = source[found.upperBound...]
        return rest.range(of: "\n    /// ").map { String(rest[..<$0.lowerBound]) }
            ?? String(rest)
    }

    /// The repo root, walked up from this file rather than guessed from a
    /// working directory — the test bundle lives in DerivedData.
    private func repoRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // apps
            .deletingLastPathComponent() // repo root
    }

    /// One iOS source file, by its path under `Loonext/`.
    ///
    /// FAILS rather than skips when the file is not there. A scan that cannot
    /// read its subject has verified nothing, and the conditions that produce a
    /// missing file — a rename, a moved directory, a bundle run from outside the
    /// checkout — are exactly the ones it must be loudest about. See
    /// `MissingSource`.
    private func iosSource(_ relative: String) throws -> String {
        let url = repoRoot()
            .appendingPathComponent("apps/ios/Loonext")
            .appendingPathComponent(relative)
        guard let source = try? String(contentsOf: url, encoding: .utf8) else {
            throw missingSource(url.path)
        }
        return source
    }

    /// The TypeScript this file was hand-ported from.
    private func sharedThreadSummarySource() throws -> String {
        let url = repoRoot()
            .appendingPathComponent("packages/shared/src/thread-summary.ts")
        guard let source = try? String(contentsOf: url, encoding: .utf8) else {
            throw missingSource(url.path)
        }
        return source
    }

    /// `export const NAME = 12;` → 12. Nil when the constant is not there, which
    /// fails the comparison rather than passing it — a rename in the shared file
    /// must not read as agreement.
    private func tsNumber(_ name: String, in source: String) -> Int? {
        guard let declaration = source.range(of: "export const \(name) = ") else {
            return nil
        }
        let rest = source[declaration.upperBound...]
        let digits = rest.prefix(while: { $0.isNumber })
        return digits.isEmpty ? nil : Int(digits)
    }
}
