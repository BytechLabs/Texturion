import XCTest
@testable import Loonext

/// #277 — the paid pause, held to the one rule that governs it.
///
/// `eligible` is the only thing that may put a Pause control on screen, and the
/// figure beside it is the only price this client may print. Everything below is
/// one of those two sentences, said about a case that could otherwise go wrong.
///
/// These are gates rather than copy assertions wherever a gate exists: a test
/// that pins a whole paragraph becomes a ceiling on the copy instead of a guard
/// against a defect. The copy cases here check the FACTS the words carry — the
/// price appears, the invented one does not.
final class BillingPauseTests: XCTestCase {
    // MARK: - Fixtures

    /// The figure on an OFFER, and deliberately not a round one.
    ///
    /// It was 500, which formats to "$5" — exactly what a hardcoded string
    /// produces. Every price assertion in this file passed just as happily
    /// against a price the client had invented as against one it read, which
    /// makes a suite of them decoration. 1275 formats to "$12.75", which nothing
    /// types by accident.
    private let offeredCents = 1275
    private let offeredPrice = "$12.75"

    /// What a PAUSED workspace is really charged — a second, different figure.
    ///
    /// The offer and the paused state are two responses read by two surfaces,
    /// and a client that quoted the wrong one of them would look correct in a
    /// suite where both were the same number.
    private let pausedCents = 940
    private let pausedPrice = "$9.40"

    /// A timestamp is a timestamp: any non-blank one means paused.
    private let pausedAtStamp = "2026-01-05T00:00:00Z"

    /// The default is the literal value of `offeredCents`, written out because a
    /// default argument expression cannot reach an instance property. The one
    /// test that would notice them drifting apart is
    /// `testTheFixturePricesAreNotWhatAHardcodeWouldPrint`.
    private func pause(
        eligible: Bool? = true,
        reason: String? = nil,
        pausedAt: String? = nil,
        monthlyCents: Int? = 1275,
        resumePlan: String? = "pro"
    ) -> BillingPause {
        BillingPause(
            eligible: eligible,
            reason: reason,
            paused_at: pausedAt,
            monthly_cents: monthlyCents,
            resume_plan: resumePlan
        )
    }

    // MARK: - Nothing may put Pause on screen except `eligible`

    func testOffersThePauseWhenTheApiSaysEligibleAndQuotesIt() {
        XCTAssertEqual(offeredPrice, pauseOfferPrice(pause()))
    }

    func testOffersNothingWhenTheApiSaysNo() {
        // Every refusal reason renders the same thing: nothing. `not_provisioned`
        // in particular means the offer does not EXIST, so the block is absent
        // rather than greyed out — and this client never has to know which of
        // the eight reasons it is looking at.
        for reason in [
            "not_provisioned", "no_subscription", "subscription_unhealthy",
            "already_paused", "plan_change_pending", "referral_month_pending",
            "already_prepaid", "prepaid_coupon_orphaned",
        ] {
            XCTAssertNil(
                pauseOfferPrice(pause(eligible: false, reason: reason)),
                "eligible:false with reason \(reason) must render no offer"
            )
        }
    }

    func testAMissingEligibleFlagIsNotAnOffer() {
        // A response this build cannot fully read fails toward silence. The
        // control it would otherwise draw starts a recurring charge.
        XCTAssertNil(pauseOfferPrice(pause(eligible: nil)))
        XCTAssertNil(pauseOfferPrice(nil))
    }

    func testNeverInventsAPriceForAnEligiblePause() {
        // The server folds "we could read a price" into `eligible`, so this pair
        // should not occur. It is refused anyway: this client is the last thing
        // between an amount and somebody agreeing to pay it every month, and a
        // button reading "Pause" with no number on it is the failure.
        XCTAssertNil(pauseOfferPrice(pause(monthlyCents: nil)))
    }

    func testAPausedWorkspaceIsNotOfferedThePauseAgain() {
        // The offer is over. What they have instead is the paused state.
        XCTAssertNil(
            pauseOfferPrice(pause(eligible: true, pausedAt: pausedAtStamp))
        )
    }

    // MARK: - Paused right now

    func testPausedIsReadFromTheTimestampAndNothingElse() {
        XCTAssertTrue(pauseIsActive(pause(pausedAt: pausedAtStamp)))
        XCTAssertFalse(pauseIsActive(pause()))
        XCTAssertFalse(pauseIsActive(nil))
        // An empty timestamp is a serialisation artefact, not a moment in time.
        XCTAssertFalse(pauseIsActive(pause(pausedAt: "   ")))
    }

    func testTheReasonAlreadyPausedDoesNotMakeAWorkspacePaused() {
        // `reason` says why an OFFER was refused. Seven of its eight values mean
        // something other than "paused", and reading the state off it would put
        // the paused card in front of a workspace with a pending plan change.
        XCTAssertFalse(
            pauseIsActive(pause(eligible: false, reason: "already_paused", pausedAt: nil))
        )
    }

    func testPausedPriceIsTheMirrorAndNeverThePlanPrice() {
        // A DIFFERENT FIGURE FROM THE OFFER's, and that is the assertion: the
        // paused card must print what the paused response carried, not the one
        // this suite happens to use everywhere else.
        XCTAssertEqual(
            pausedPrice,
            pausedMonthlyPrice(pause(pausedAt: pausedAtStamp, monthlyCents: pausedCents))
        )
        // No figure from the server means no sentence about money. The plan's
        // own price is the one number certainly wrong here — a paused
        // subscription's licensed line IS the holding fee.
        XCTAssertNil(
            pausedMonthlyPrice(pause(pausedAt: pausedAtStamp, monthlyCents: nil))
        )
        XCTAssertNil(pausedMonthlyPrice(pause(monthlyCents: pausedCents)))
    }

    // MARK: - Which answer the cancel card gives

    func testThePauseAnswersSeasonalAndOnlySeasonal() {
        XCTAssertEqual(
            offeredPrice,
            pauseAnswerPrice(reason: cancellationReasonSeasonal, pause: pause())
        )
        // "Your number survives the winter" is not an answer to "this costs too
        // much" — that reason keeps the smaller-plan offer it already had.
        XCTAssertNil(pauseAnswerPrice(reason: "too_expensive", pause: pause()))
        XCTAssertNil(pauseAnswerPrice(reason: "missing_feature", pause: pause()))
        for silent in ["switched", "not_using", "other"] {
            XCTAssertNil(pauseAnswerPrice(reason: silent, pause: pause()))
        }
        // Nobody has answered yet. The card is a plain cancel card.
        XCTAssertNil(pauseAnswerPrice(reason: nil, pause: pause()))
    }

    func testSeasonalKeepsTheSharedAnswerWhenThereIsNoPauseToOffer() {
        // The substitution is conditional on a real, quoted offer. Without one
        // the screen is byte-for-byte what it was before this feature.
        XCTAssertNil(
            pauseAnswerPrice(
                reason: cancellationReasonSeasonal,
                pause: pause(eligible: false, reason: "not_provisioned", monthlyCents: nil)
            )
        )
        XCTAssertNil(pauseAnswerPrice(reason: cancellationReasonSeasonal, pause: nil))
        // And the answer it falls back to still exists, so nothing is lost when
        // the pause is unavailable.
        XCTAssertNotNil(
            cancellationOffer(reason: cancellationReasonSeasonal, plan: "pro")
        )
    }

    func testTheSeasonalCodeIsTheOneTheReasonListOffers() {
        // Three spellings of "seasonal" would split the answer from the choice
        // silently. The list is the contract.
        XCTAssertTrue(
            cancellationReasons.contains { $0.code == cancellationReasonSeasonal }
        )
    }

    // MARK: - What the words promise

    func testTheOfferNamesThePriceItWasGivenAndNoOther() {
        let body = pauseOfferBody(price: offeredPrice, resumePlanName: "Pro")
        XCTAssertTrue(body.contains("\(offeredPrice) a month"))
        XCTAssertTrue(body.contains("Come back on Pro"))
        // The hold is named only to say the pause does not have one.
        XCTAssertTrue(body.contains("no \(cancellationGraceDays)-day clock"))
    }

    func testTheOfferSaysWhatStopsAndWhatDoesNot() {
        // A seasonal crew can be wrong about this at their customers' expense:
        // `runPreSendGates` refuses with `workspace_paused`, inbound still
        // arrives, and scheduled sends are HELD rather than failed.
        let body = pauseOfferBody(price: offeredPrice, resumePlanName: "Pro")
        XCTAssertTrue(body.contains("Texting and calling stop"))
        XCTAssertTrue(body.contains("still arrive"))
        XCTAssertTrue(body.contains("held rather than cancelled"))
    }

    func testTheOfferNamesNoPlanWhenTheServerNamedNone() {
        let body = pauseOfferBody(price: offeredPrice, resumePlanName: nil)
        XCTAssertTrue(body.contains("Come back whenever the work does."))
        XCTAssertFalse(body.contains("Come back on "))
    }

    func testTheConfirmationRepeatsThePriceWhereItIsAgreedTo() {
        // The note above is an offer somebody may have scrolled past. This is
        // the sentence read with a thumb over the button.
        XCTAssertTrue(
            pauseConfirmMessage(price: offeredPrice).contains("\(offeredPrice) a month")
        )
    }

    func testThePausedStateLeadsWithTheChargeWhenThereIsOne() {
        let lines = pausedStateLines(price: pausedPrice)
        XCTAssertEqual(4, lines.count)
        XCTAssertEqual(
            "You're billed \(pausedPrice) a month while this is paused.", lines.first
        )
    }

    func testThePausedStateSaysNothingAboutMoneyWithoutAFigure() {
        let lines = pausedStateLines(price: nil)
        XCTAssertEqual(3, lines.count)
        XCTAssertFalse(lines.contains { $0.contains("$") })
        // The three facts that matter are still all there.
        XCTAssertTrue(lines.contains { $0.contains("Texting and calling are off") })
        XCTAssertTrue(lines.contains { $0.contains("still arrive") })
        XCTAssertTrue(lines.contains { $0.contains("no deadline") })
    }

    func testResumeNamesThePlanWhenThereIsOne() {
        XCTAssertEqual("Resume Pro", pauseResumeLabel(planName: "Pro"))
        XCTAssertEqual("Resume", pauseResumeLabel(planName: nil))
    }

    func testTheConfirmationIsBuiltFromTheResponse() {
        // POST /v1/billing/pause re-reads its own mirror and 409s when the two
        // disagree, so this sentence is only ever composed from a pause that
        // demonstrably exists — and from the figure that came back with it.
        // CENTS IN, A FORMATTED PRICE OUT, and 940 is chosen so the two cannot
        // be confused for one another: "$9.40" is not a string anybody types by
        // accident, and it is not the figure any other fixture in this file uses.
        XCTAssertEqual(
            "Paused. You're billed \(pausedPrice) a month until you resume.",
            pausedConfirmationMessage(monthlyCents: pausedCents)
        )
        XCTAssertEqual(
            "Paused. Texting is off until you resume.",
            pausedConfirmationMessage(monthlyCents: nil)
        )
    }

    // MARK: - A screen may not state a fact it has not read

    /// The defect this section exists to end, stated once: a paused workspace on
    /// a cold start whose read failed was shown `Pro · $79/mo` beside a green
    /// `Active` pill — a wrong number about the reader's own money, on the
    /// billing screen, in the confident voice. `GET /v1/billing/pause` THROWS
    /// rather than degrading to a null precisely so that cannot happen; a `try?`
    /// on the calling line quietly undid it.
    ///
    /// The render site is guarded separately, in `CancelOneActionTests`. These
    /// are the rules; that is the proof they are the ones being applied.
    func testOnlyAnAnswerMayDrawTheOrdinaryPlanCard() {
        XCTAssertEqual(.active, planCardShape(.ready(pause())))
        XCTAssertEqual(.paused, planCardShape(.ready(pause(pausedAt: pausedAtStamp))))
        // Neither of these has read anything, so neither may say "Active".
        XCTAssertEqual(.unconfirmed(checking: true), planCardShape(.loading))
        XCTAssertEqual(.unconfirmed(checking: false), planCardShape(.failed))
    }

    func testAFailedReadIsNotTheSameAsNoPause() {
        // The whole of the defect in one assertion: if these two ever agree, a
        // workspace paying a holding fee is being told it is on its plan.
        XCTAssertNotEqual(planCardShape(.failed), planCardShape(.ready(pause())))
        XCTAssertNotEqual(planCardShape(.loading), planCardShape(.ready(pause())))
    }

    func testTheLoadWindowIsNotAnActiveScreen() {
        // Before the read lands there is nothing to say about the pause, and the
        // first frame of every visit is this one. It used to be the ordinary
        // plan card — price, pill, and a "Switch to Starter" whose POST 409s by
        // design on a paused workspace.
        XCTAssertNotEqual(.active, planCardShape(.loading))
    }

    func testAReaderWhoCannotAskGetsTheScreenTheyAlwaysHad() {
        // Narrow and deliberate. The whole /v1/billing router is behind
        // `billing.manage`, so for a tech there is no answer to be had at any
        // point — "unconfirmed" would not be a loading state for them, it would
        // permanently delete the plan price from the only screen that prints it,
        // to guard a case they can neither act on nor see a control for. Closing
        // this properly is an API change, not a client one.
        XCTAssertEqual(.active, planCardShape(.unaskable))

        // AND THE EXCEPTION IS ASKED FOR BY THE ROLE, WHICH IS THE HALF THIS
        // TEST WAS MISSING. On its own, the line above licenses the defect
        // instead of guarding it: while the billing screen's own `@State` was a
        // `PauseRead`, editing its default from `.loading` to `.unaskable`
        // restored `Pro · $79/mo` beside a green `Active` pill on a paused
        // workspace, and this file stayed green because that is precisely what
        // it pinned. `.unaskable` now has exactly one source — the role — and a
        // reader who simply has not asked yet cannot reach it.
        XCTAssertEqual(
            .active, planCardShape(pauseReadFor(canManageBilling: false, fetch: .loading))
        )
        XCTAssertEqual(
            .active, planCardShape(pauseReadFor(canManageBilling: false, fetch: .failed))
        )
    }

    func testAReaderWhoHasSimplyNotAskedYetIsNotAReaderWhoCannotAsk() {
        // THE MUTATION THIS EXISTS FOR. Somebody with `billing.manage` and a
        // request in flight must get the unconfirmed card, never the exception
        // written for a tech — the two are one keyword apart in the source and
        // several hundred dollars apart on the screen.
        XCTAssertEqual(
            .unconfirmed(checking: true),
            planCardShape(pauseReadFor(canManageBilling: true, fetch: .loading))
        )
        XCTAssertEqual(
            .unconfirmed(checking: false),
            planCardShape(pauseReadFor(canManageBilling: true, fetch: .failed))
        )
        // ...and an answer is still an answer for them, in both directions.
        XCTAssertEqual(
            .active,
            planCardShape(pauseReadFor(canManageBilling: true, fetch: .ready(pause())))
        )
        XCTAssertEqual(
            .paused,
            planCardShape(pauseReadFor(
                canManageBilling: true, fetch: .ready(pause(pausedAt: pausedAtStamp))
            ))
        )
        // The add-ons gate reads the same value and must agree: a control that
        // invoices immediately may not be offered on a read that has not landed.
        XCTAssertFalse(mayBuyAddOns(pauseReadFor(canManageBilling: true, fetch: .loading)))
        XCTAssertTrue(
            mayBuyAddOns(pauseReadFor(canManageBilling: true, fetch: .ready(pause())))
        )
    }

    func testTheUnreadCardSaysWhichPartsAreMissing() {
        // The reader's question on seeing a thinner card is "where did my price
        // go", and the second is "did something happen to my subscription".
        let failed = planUnconfirmedLine(checking: false)
        XCTAssertTrue(failed.contains("price"))
        XCTAssertTrue(failed.contains("Nothing about your plan has changed"))
        // No price may appear in either sentence — that is the whole point.
        XCTAssertFalse(failed.contains("$"))
        XCTAssertFalse(planUnconfirmedLine(checking: true).contains("$"))
        // And the two states do not read alike: one resolves itself, one wants
        // the retry the card offers.
        XCTAssertNotEqual(planUnconfirmedLine(checking: true), failed)
    }

    func testOnlyAnAnswerMayOfferAControlThatCharges() {
        // Enabling a module invoices immediately, and POST /v1/billing/modules
        // refuses a paused workspace. Every direction other than "the read came
        // back and said the plan is running" fails closed.
        XCTAssertTrue(mayBuyAddOns(.ready(pause())))
        XCTAssertFalse(mayBuyAddOns(.ready(pause(pausedAt: pausedAtStamp))))
        XCTAssertFalse(mayBuyAddOns(.loading))
        XCTAssertFalse(mayBuyAddOns(.failed))
        XCTAssertFalse(mayBuyAddOns(.unaskable))
    }

    func testTheOfferIsHandedOnOnlyWhenThereIsAnAnswer() {
        // `answer` is what the cancel card is given. Nil is what it already
        // renders as "no pause to offer", so no read state can gate, move or
        // disable the way out — it only ever removes an offer BELOW it.
        XCTAssertNotNil(PauseRead.ready(pause()).answer)
        XCTAssertNil(PauseRead.loading.answer)
        XCTAssertNil(PauseRead.failed.answer)
        XCTAssertNil(PauseRead.unaskable.answer)
        XCTAssertNil(pauseAnswerPrice(
            reason: cancellationReasonSeasonal, pause: PauseRead.failed.answer
        ))
    }

    // MARK: - The fixtures themselves

    func testTheFixturePricesAreNotWhatAHardcodeWouldPrint() {
        // THE GUARD ON THE GUARDS. Every price assertion in this file is worth
        // something only while the fixture is a figure no hand would type: 500
        // cents renders "$5", which is exactly what a literal renders, so a suite
        // built on it passes whether the client read the response or invented the
        // number. Both figures below survive that test, and they differ from each
        // other so that one literal cannot stand in for both surfaces.
        XCTAssertEqual(offeredPrice, formatMonthlyCents(offeredCents))
        XCTAssertEqual(pausedPrice, formatMonthlyCents(pausedCents))
        XCTAssertNotEqual(offeredCents, pausedCents)
        for cents in [offeredCents, pausedCents] {
            XCTAssertNotEqual(
                0, cents % 100,
                "a whole-dollar fixture prints what a hardcoded price prints"
            )
        }
        // ...and the fixture's own default is the offer's figure, which is the
        // one thing a default argument cannot state by reference.
        XCTAssertEqual(offeredCents, pause().monthly_cents)
    }

    // MARK: - The answer under the exit, decided by what was actually READ

    /// The cancel card's own call, with the two fields that only pick a currency
    /// pinned so every case below differs in the read alone.
    private func cardAnswer(
        _ read: PauseRead,
        _ reason: String?,
        plan: String? = "pro",
        registrationFeePaidAt: String? = nil
    ) -> CancellationOffer? {
        cancellationOffer(
            read: read,
            reason: reason,
            plan: plan,
            billingCurrency: "usd",
            country: "US",
            registrationFeePaidAt: registrationFeePaidAt
        )
    }

    func testAPausedWorkspaceIsNeverHandedThePlanSwitcher() {
        // THE DEFECT. While paused the pause offer is over (the API answers
        // `already_paused`), so the card falls through to the written answer —
        // and for a Pro workspace saying "too expensive" that answer used to
        // carry "Switch to Starter", whose POST /v1/billing/change-plan replies
        // 409 "Your plan is paused. Resume it first, then switch plans". The plan
        // card an inch above already withheld its own switch on the same fact.
        let paused = cardAnswer(.ready(pause(pausedAt: pausedAtStamp)), "too_expensive")
        XCTAssertNil(paused?.action)
        XCTAssertNil(paused?.actionLabel)
        // The words stay: somebody cancelling over $79 must still be told about
        // the $29 plan they can have, and the order the API insists on.
        XCTAssertTrue(paused?.body.contains("$29") ?? false)
        XCTAssertTrue(paused?.body.contains("resume first, then switch plans") ?? false)
    }

    func testAReadThatHasNotLandedWithholdsThePlanSwitchAndKeepsTheWords() {
        // A Bool cannot tell "not paused" from "not read yet", and `false` on a
        // paused workspace is how the 409 gets back in front of somebody. Both
        // unread states therefore answer in words and offer nothing to press.
        for read in [PauseRead.loading, .failed, .unaskable] {
            let unread = cardAnswer(read, "too_expensive")
            XCTAssertNotNil(unread, "the answer itself is not withheld, only its control")
            XCTAssertNil(unread?.action)
            XCTAssertNil(unread?.actionLabel)
            XCTAssertTrue(unread?.body.contains("$29") ?? false)
        }
    }

    func testAnAnswerThatSaysNotPausedIsTheScreenItAlwaysWas() {
        // The common case, and it must be byte-for-byte the answer this module
        // gave before the pause existed — including the control.
        XCTAssertEqual(
            cancellationOffer(
                reason: "too_expensive", plan: "pro", billingCurrency: "usd", country: "US"
            ),
            cardAnswer(.ready(pause()), "too_expensive")
        )
        XCTAssertEqual(cardAnswer(.ready(pause()), "too_expensive")?.action, .changePlan)
        XCTAssertEqual(
            "Switch to Starter", cardAnswer(.ready(pause()), "too_expensive")?.actionLabel
        )
    }

    func testTheRouteToAHumanSurvivesAReadThatDidNotLand() {
        // ONLY the plan switch is withheld. `openHelp` is a screen in this app
        // that no state refuses, so a pause read that never came back has nothing
        // to say about it — deleting it would cost somebody the route to a person
        // over a fact that does not apply.
        for read in [PauseRead.loading, .failed, .unaskable, .ready(pause())] {
            XCTAssertEqual(cardAnswer(read, "missing_feature")?.action, .openHelp)
            XCTAssertEqual("Get help", cardAnswer(read, "missing_feature")?.actionLabel)
        }
    }

    func testThePausedSeasonalAnswerIsReachedThroughTheReadAndNotByAFlag() {
        // The two seasonal answers, told apart by the read alone. The unpaused
        // one has to end by admitting a long season outruns the hold; the paused
        // one would be contradicting the paused card twelve lines above it.
        let paused = cardAnswer(.ready(pause(pausedAt: pausedAtStamp)), "seasonal")
        XCTAssertTrue(paused?.body.contains("nothing expires while your plan is paused") ?? false)
        XCTAssertFalse(paused?.body.contains("outruns the hold") ?? true)

        let unpaused = cardAnswer(.ready(pause()), "seasonal")
        XCTAssertTrue(unpaused?.body.contains("outruns the hold") ?? false)
        XCTAssertNotEqual(paused?.heading, unpaused?.heading)

        // Unread reads the same as unpaused, which is the answer this screen has
        // always shown — and neither of them has a control to withhold.
        XCTAssertEqual(unpaused, cardAnswer(.loading, "seasonal"))
        XCTAssertNil(paused?.action)
    }

    func testNoReadStateInventsAnAnswerWhereThereWasNone() {
        // Silence is a result, and the read may not turn it into speech. Starter
        // has nothing below it, three reasons have nothing honest to add, and an
        // unrecognised code renders nothing at all — paused, unpaused or unread.
        for read in [PauseRead.loading, .failed, .unaskable,
                     .ready(pause()), .ready(pause(pausedAt: pausedAtStamp))] {
            XCTAssertNil(cardAnswer(read, "too_expensive", plan: "starter"))
            XCTAssertNil(cardAnswer(read, "too_expensive", plan: nil))
            for silent in ["switched", "not_using", "other"] {
                XCTAssertNil(cardAnswer(read, silent))
            }
            XCTAssertNil(cardAnswer(read, nil))
            XCTAssertNil(cardAnswer(read, "moving_to_carrier_pigeon"))
        }
    }

    // MARK: - Decoding

    func testDecodesTheEligibleOffer() throws {
        let json = """
        {"eligible":true,"reason":null,"paused_at":null,"monthly_cents":1275,
         "resume_plan":"starter"}
        """
        let decoded = try JSONDecoder().decode(BillingPause.self, from: Data(json.utf8))
        XCTAssertTrue(decoded.isEligible)
        XCTAssertEqual(offeredPrice, pauseOfferPrice(decoded))
        XCTAssertEqual("starter", decoded.resume_plan)
    }

    func testDecodesAPausedWorkspace() throws {
        let json = """
        {"eligible":false,"reason":"already_paused","paused_at":"2026-01-05T00:00:00Z",
         "monthly_cents":940,"resume_plan":"pro"}
        """
        let decoded = try JSONDecoder().decode(BillingPause.self, from: Data(json.utf8))
        XCTAssertTrue(pauseIsActive(decoded))
        XCTAssertEqual(pausedPrice, pausedMonthlyPrice(decoded))
        XCTAssertNil(pauseOfferPrice(decoded))
    }

    func testDecodesTheTwoWriteResponses() throws {
        let paused = try JSONDecoder().decode(
            BillingPaused.self,
            from: Data(
                #"{"paused_at":"2026-01-05T00:00:00Z","monthly_cents":940,"resume_plan":"pro"}"#
                    .utf8
            )
        )
        XCTAssertEqual(pausedCents, paused.monthly_cents)

        let resumed = try JSONDecoder().decode(
            BillingResumed.self,
            from: Data(#"{"plan":"pro","paused_at":null}"#.utf8)
        )
        XCTAssertEqual("pro", resumed.plan)
        XCTAssertNil(resumed.paused_at)
    }
}
