import XCTest
@testable import Loonext

/// #523 — a number the plan does not cover, said out loud.
///
/// # What is actually being protected
///
/// A held number is the least intuitive state this product has: the row is
/// intact, the carrier still delivers to it, the history is untouched, and it
/// cannot send or answer. Their customers hit it before the owner notices. The
/// only thing that makes that defensible instead of a defect is that the owner is
/// TOLD — by mail, by push, and by a card that stays on the billing screen with
/// two priced routes out of it.
///
/// So the assertions here are about the three ways that telling can go wrong:
///
///   the WRONG STATE   drawing this over a cancelled workspace, whose numbers are
///                     suspended for the other reason entirely and whose answer
///                     is the win-back card.
///   the WRONG MONEY   printing a USD figure as though it were the reader's own,
///                     which is #522 verbatim.
///   the WRONG MOMENT  offering a purchase against a fact this screen has not
///                     read, or one the API would refuse — which is how somebody
///                     concludes the button is broken.
///
/// # Why so much of it reads the source
///
/// The behaviour tests read `heldNumbersState` and `heldNumbersCopy`. They say
/// nothing at all about whether the CARD calls them: a view that ignored both and
/// typed the sentence again would pass every one of them, and typing the sentence
/// again is the defect. `RegistrationFeeCurrencyTests` made the same argument for
/// the same reason.
final class HeldNumbersTests: XCTestCase {
    // MARK: - Fixtures

    private func held(_ e164: String? = "+14155550102", id: String = "n2") -> HeldNumber {
        HeldNumber(id: id, number_e164: e164, suspended_at: "2026-08-05T10:00:00Z")
    }

    /// A Starter workspace holding two numbers after a win-back: one active, one
    /// held, nothing bought yet. The state the whole issue is about.
    private func answer(
        plan: String? = "starter",
        included: Int? = 1,
        paidExtras: Int = 0,
        allowance: Int? = 1,
        maxTotal: Int? = 2,
        reason: String? = HeldNumbersReason.overPlanAllowance,
        rows: [HeldNumber]? = nil,
        cents: Int? = 500,
        currency: String? = "usd",
        canReinstate: Bool = true,
        canUpgrade: Bool = true
    ) -> HeldNumbers {
        HeldNumbers(
            plan: plan,
            included: included,
            paid_extras: paidExtras,
            allowance: allowance,
            max_total: maxTotal,
            reason: reason,
            held: rows ?? [held()],
            extra_number_cents: cents,
            extra_number_currency: currency,
            can_reinstate: canReinstate,
            can_upgrade: canUpgrade
        )
    }

    /// The pause read that came back and said "not paused" — the only state in
    /// which anything on this card may be sold.
    private var notPaused: PauseRead {
        .ready(
            BillingPause(
                eligible: true,
                reason: nil,
                paused_at: nil,
                monthly_cents: 900,
                resume_plan: "starter"
            )
        )
    }

    private var paused: PauseRead {
        .ready(
            BillingPause(
                eligible: false,
                reason: "already_paused",
                paused_at: "2026-07-01T00:00:00Z",
                monthly_cents: 900,
                resume_plan: "starter"
            )
        )
    }

    private func state(
        _ view: HeldNumbers,
        read: PauseRead? = nil,
        writes: Bool = true,
        audience: BillingCurrency = .usd
    ) -> HeldNumbersState? {
        heldNumbersState(
            view,
            read: read ?? notPaused,
            billingWritesEnabled: writes,
            audience: audience
        )
    }

    // MARK: - The wrong state

    /// A cancelled workspace's numbers are suspended because the subscription is
    /// over and the 30-day hold is running. That has a different answer — the
    /// win-back inside the Subscription card — and TWO cards about one suspended
    /// number, giving two reasons, is the drift the server's `reason` field
    /// exists to prevent. The held list is deliberately non-empty here: the only
    /// thing keeping this card off the screen must be the reason.
    func testNothingIsDrawnForAWorkspaceInTheGraceWindow() {
        XCTAssertNil(
            state(answer(reason: HeldNumbersReason.subscriptionInactive)),
            "the held-numbers card drew over a cancelled workspace, which already "
                + "has a card explaining the very same suspended numbers"
        )
    }

    /// Nothing held, nothing to say — and no empty box on a billing screen.
    ///
    /// Both halves, because the server sends `reason: null` alongside an empty
    /// list and a card that leaned on only one of the two would draw an empty
    /// box the day the other arrived on its own.
    func testNothingIsDrawnWhenNothingIsHeld() {
        XCTAssertNil(state(answer(reason: nil, rows: [])))
        XCTAssertNil(state(answer(rows: [])))
        XCTAssertNil(state(answer(reason: nil)))
    }

    /// The server answers `allowance: null` when it could not read the plan (an
    /// unreadable price catalog, a paused subscription whose licensed item is the
    /// pause price). There is nothing honest to say about a limit we cannot name,
    /// and the claim itself restores everything in that case rather than holding
    /// anything — so a card asserting a hold would be describing a state that is
    /// not happening.
    func testNothingIsDrawnWhenTheServerCouldNotReadThePlan() {
        XCTAssertNil(state(answer(included: nil, allowance: nil)))
    }

    // MARK: - The wrong money

    /// The price is the SERVER's figure, rendered in the currency the SERVER
    /// named, against the currency the reader is actually billed in.
    ///
    /// THE PAIR IS THE POINT. A single assertion about a CAD workspace is one a
    /// hardcoded "US$5/mo" passes. Asking both audiences about the same served
    /// figure, and asking a THIRD with a different figure, means no typed
    /// constant can satisfy all of them.
    func testThePriceIsTheServersFigureInTheCurrencyTheServerNamed() {
        // A US workspace reads its own money, unprefixed.
        XCTAssertEqual(
            state(answer(), audience: .usd)?.offer,
            .buy(price: "$5/mo")
        )
        // A Canadian workspace is being quoted a US-filed price. A bare "$5"
        // there means CAD to the reader and bills US$5 — #522, exactly.
        XCTAssertEqual(
            state(answer(), audience: .cad)?.offer,
            .buy(price: "US$5/mo")
        )
        // And the figure is read, not remembered.
        XCTAssertEqual(
            state(answer(cents: 400), audience: .cad)?.offer,
            .buy(price: "US$4/mo")
        )
    }

    /// A figure whose currency we cannot name is a figure we do not print.
    ///
    /// Failing CLOSED rather than assuming USD: the assumption is right today and
    /// silently wrong the day a CAD extra-number price is filed, and the reader
    /// who pays for that is the one being asked to consent to the charge.
    func testAnUnlabelledPriceIsNotPrinted() {
        XCTAssertEqual(state(answer(currency: nil))?.offer, .noPurchase)
        XCTAssertEqual(state(answer(currency: "gbp"))?.offer, .noPurchase)
        XCTAssertEqual(state(answer(cents: nil))?.offer, .noPurchase)
    }

    /// `formatMoneyIn` itself: the prefix appears only when the two disagree.
    /// "CA$39" shown to a Canadian reading their own invoice reads as though we
    /// expect them to be confused about their own money.
    func testMoneyIsPrefixedOnlyWhenItIsNotTheReadersOwn() {
        XCTAssertEqual(formatMoneyIn(3900, .cad, audience: .cad), "$39")
        XCTAssertEqual(formatMoneyIn(2900, .usd, audience: .usd), "$29")
        XCTAssertEqual(formatMoneyIn(500, .usd, audience: .cad), "US$5")
        XCTAssertEqual(formatMoneyIn(500, .cad, audience: .usd), "CA$5")
        // The house rounding survives: whole dollars stay whole, cents do not.
        XCTAssertEqual(formatMoneyIn(750, .usd, audience: .cad), "US$7.50")
    }

    // MARK: - The wrong moment

    /// A paused workspace cannot be sold anything — `POST …/reinstate` answers
    /// `workspace_paused` by design — so the button is absent and the copy names
    /// the two steps in the order the API's own refusal names them.
    func testAPausedWorkspaceIsToldToResumeFirstAndOfferedNothing() {
        let paused = state(answer(), read: self.paused)
        XCTAssertEqual(paused?.offer, .resumeFirst)
        XCTAssertEqual(
            paused?.copy.routes,
            "Your plan is paused, so nothing can be added to it yet. Resume it "
                + "from the plan card above, then you can bring it back."
        )
        XCTAssertFalse(
            paused?.copy.routes?.contains("paid extra") ?? true,
            "a paused workspace was pointed at a purchase its own subscription refuses"
        )
    }

    /// The read has not landed. Nothing may be sold against a fact nobody has
    /// read — the same rule the add-ons card follows one card below, and the
    /// reason `PauseRead` exists at all rather than a `BillingPause?`.
    ///
    /// `unaskable` is included for completeness: the card never fetches for a
    /// reader without `billing.manage`, but a gate that depends on that being
    /// true elsewhere is a gate one refactor away from being wrong.
    func testNoPurchaseIsOfferedAgainstAPauseNobodyHasRead() {
        for read in [PauseRead.loading, .failed, .unaskable] {
            XCTAssertEqual(
                state(answer(), read: read)?.offer,
                .noPurchase,
                "a price was offered while the pause read was \(read)"
            )
        }
    }

    /// #163's store-rules kill-switch hides every in-app billing WRITE. Adding a
    /// priced line to a subscription is exactly that. The reading half of the
    /// card is untouched — the owner still learns the number is held.
    func testTheStoreRulesKillSwitchHidesThePurchaseAndNotTheExplanation() {
        let off = state(answer(), writes: false)
        XCTAssertEqual(off?.offer, .noPurchase)
        XCTAssertEqual(off?.copy.title, "One of your numbers is on hold")
        XCTAssertEqual(
            off?.copy.routes,
            "Move to Pro from the plan card above and everything that fits comes back."
        )
    }

    /// Starter tops out at two numbers, so a workspace that has already bought
    /// its one extra has no second extra to buy at any price. Named rather than
    /// left as a missing button: an owner who sees no control and no explanation
    /// concludes the product is broken.
    ///
    /// The CAP is the server's `max_total`, not this client's memory of #80.
    func testTheHardCapIsNamedRatherThanLeavingAMissingButton() {
        let full = state(
            answer(paidExtras: 1, allowance: 2, rows: [held(id: "n3")], canReinstate: false)
        )
        XCTAssertEqual(full?.offer, .planIsFull(maxTotal: 2))
        XCTAssertEqual(
            full?.copy.routes,
            "Starter tops out at 2 numbers, so there's no extra to buy here. Move "
                + "to Pro from the plan card above and everything that fits comes back."
        )
        // The figure is read. A client that remembered "2" would print 2 here.
        XCTAssertEqual(
            state(
                answer(paidExtras: 2, allowance: 3, maxTotal: 3, canReinstate: false)
            )?.offer,
            .planIsFull(maxTotal: 3)
        )
    }

    /// The server's own answer to "would the POST be accepted" is trusted rather
    /// than re-derived. It knows about a scheduled plan change and an
    /// unprovisioned extra-number price; this screen knows about neither, and a
    /// button whose outcome is a 409 by design is not a button.
    func testTheServersOwnRefusalIsTrusted() {
        XCTAssertEqual(
            state(answer(canReinstate: false))?.offer,
            .noPurchase
        )
    }

    /// A Pro workspace with nothing to sell and nothing to upgrade to is the one
    /// state with no automatic route left. It gets a person rather than a
    /// sentence with nothing behind it.
    func testTheLastResortIsAPersonAndNotSilence() {
        let stuck = state(answer(plan: "pro", maxTotal: nil, canReinstate: false, canUpgrade: false))
        XCTAssertEqual(stuck?.offer, .noPurchase)
        XCTAssertTrue(stuck?.copy.offerHelp ?? false)
        XCTAssertEqual(stuck?.copy.routes, "Get in touch and we'll bring it back.")
        // And a workspace that CAN upgrade is never sent to support instead.
        XCTAssertFalse(state(answer(canReinstate: false))?.copy.offerHelp ?? true)
    }

    // MARK: - The words

    /// The card's title IS the mail's subject line
    /// (`heldNumbersCopy` in apps/api/src/billing/number-allowance.ts), so
    /// somebody arriving from the mail lands on a card they recognise. Pinned in
    /// both numbers, because the plural branch is the one nobody reads back.
    func testTheTitleIsTheSubjectLineOfTheMailThatSentThemHere() {
        XCTAssertEqual(
            heldNumbersCopy(allowance: 1, heldCount: 1, offer: .noPurchase, canUpgrade: true).title,
            "One of your numbers is on hold"
        )
        XCTAssertEqual(
            heldNumbersCopy(allowance: 1, heldCount: 3, offer: .noPurchase, canUpgrade: true).title,
            "3 of your numbers are on hold"
        )
    }

    /// The allowance is the SERVER's figure and the sentence does no arithmetic
    /// of its own.
    ///
    /// It deliberately does not say "and you have 2": active + held is only the
    /// total while the claim's own invariant holds, and a number released between
    /// the claim and this read would make the client's sum a confident lie about
    /// somebody's own workspace. "More than that" is what the mail says, and it
    /// is true in every ordering.
    func testTheLeadNamesTheAllowanceAndCountsNothingItself() {
        XCTAssertEqual(
            heldNumbersCopy(allowance: 1, heldCount: 1, offer: .noPurchase, canUpgrade: true).lead,
            "Your plan covers 1 number, and you have more than that."
        )
        XCTAssertEqual(
            heldNumbersCopy(allowance: 2, heldCount: 1, offer: .noPurchase, canUpgrade: true).lead,
            "Your plan covers 2 numbers, and you have more than that."
        )
    }

    /// Reassurance first, and it never says "released", because nothing was.
    func testTheCardSaysWhatAHoldIsNotBeforeItSaysWhatItCosts() {
        let copy = heldNumbersCopy(
            allowance: 1, heldCount: 1, offer: .buy(price: "US$5/mo"), canUpgrade: true
        )
        XCTAssertEqual(
            copy.kept,
            "A number on hold hasn't been given up. We're still holding it, texts "
                + "and calls still reach it, and nothing in its history has been "
                + "touched — you just can't send or answer from it while it's on hold."
        )
        XCTAssertFalse(copy.kept.contains("released"))
        // The paid route is the button on the row and is NOT restated in prose:
        // one figure, one home on one card.
        XCTAssertEqual(
            copy.routes,
            "Or move to Pro from the plan card above: that brings back everything "
                + "that fits, with no extra number to buy."
        )
        XCTAssertFalse(copy.routes?.contains("5") ?? false)
    }

    /// A Pro workspace has no upgrade to point at, so the button on the row is
    /// the whole answer and there is no trailing sentence.
    func testProIsNotPointedAtAnUpgradeItAlreadyHas() {
        XCTAssertNil(
            heldNumbersCopy(
                allowance: 2, heldCount: 1, offer: .buy(price: "$4/mo"), canUpgrade: false
            ).routes
        )
    }

    // MARK: - What happened after the button

    /// THE THIRD OUTCOME IS THE POINT. `reinstated == false` with
    /// `already_active == false` means the Stripe write landed and the un-hold
    /// did not — the #110 raise fence refused a capacity raise formed against a
    /// stale epoch. The money HAS moved, so this must never read as "try again":
    /// pressing again reads a fresh billed quantity and buys a SECOND unit of
    /// capacity for a number already paid for.
    func testTheChargedButNotRestoredOutcomeNeverInvitesARetry() {
        let message = reinstateOutcomeMessage(
            ReinstatedNumber(reinstated: false, already_active: false),
            number: "(415) 555-0102"
        )
        XCTAssertEqual(
            message,
            "Your plan covers (415) 555-0102 now, and the charge went through — "
                + "but it hasn't come back yet. Get in touch and we'll finish it; "
                + "you won't be charged again."
        )
        for invitation in ["try again", "Try again", "again in a moment"] {
            XCTAssertFalse(
                message.contains(invitation),
                "a paid-but-not-restored reinstate invited a retry that buys a "
                    + "second unit of capacity: \(message)"
            )
        }
    }

    /// Three outcomes, three sentences. A client that collapsed any two of them
    /// would either apologise for a double-press or celebrate a purchase that
    /// did not land.
    func testTheThreeOutcomesAreThreeDifferentSentences() {
        let number = "(415) 555-0102"
        let back = reinstateOutcomeMessage(
            ReinstatedNumber(reinstated: true), number: number
        )
        let already = reinstateOutcomeMessage(
            ReinstatedNumber(reinstated: false, already_active: true), number: number
        )
        let stuck = reinstateOutcomeMessage(
            ReinstatedNumber(reinstated: false, already_active: false), number: number
        )
        XCTAssertEqual(back, "\(number) is back. You can send and answer from it again.")
        XCTAssertEqual(already, "\(number) was already back.")
        XCTAssertEqual(Set([back, already, stuck]).count, 3)
        // A double-press is not a failure and gets no apology.
        XCTAssertFalse(already.contains("Get in touch"))
    }

    /// An upgrade now has a SECOND effect: the bigger allowance can bring held
    /// numbers back in the same call. Until the toast says so, somebody presses
    /// "Upgrade to Pro" to fix a held number and is told only that they are on
    /// Pro — then has to go and check whether the thing they paid for happened.
    ///
    /// Read off the RESPONSE, never assumed from the plan: an ordinary upgrade
    /// reinstates nothing and must not claim otherwise.
    func testAnUpgradeSaysWhatCameBackWithIt() {
        XCTAssertEqual(
            changePlanMessage(
                ChangePlanResult(
                    plan: "pro", effective: "now", effective_at: nil,
                    reinstated: [held()], held: []
                )
            ),
            "You're on Pro now, and (415) 555-0102 is back."
        )
        XCTAssertEqual(
            changePlanMessage(
                ChangePlanResult(
                    plan: "pro", effective: "now", effective_at: nil,
                    reinstated: [held(), held("+14155550103", id: "n3")], held: []
                )
            ),
            "You're on Pro now, and 2 numbers are back."
        )
        XCTAssertEqual(
            changePlanMessage(
                ChangePlanResult(
                    plan: "pro", effective: "now", effective_at: nil,
                    reinstated: [], held: []
                )
            ),
            "You're on Pro now."
        )
        XCTAssertEqual(
            changePlanMessage(
                ChangePlanResult(
                    plan: "starter", effective: "period_end",
                    effective_at: "2026-09-01T00:00:00Z", reinstated: [], held: []
                )
            ),
            "Switch to Starter scheduled for the end of this period."
        )
    }

    // MARK: - The numbers screen

    /// The line under a suspended number used to say "Update your payment method
    /// under Settings › Billing to bring it back". That is ONE of two reasons a
    /// number is suspended, and since #523 it is the less likely one: the
    /// workspace reading it is paid up, and it is being sent to fix something
    /// that is not broken.
    ///
    /// It does not guess the other reason either. `GET /v1/billing/held-numbers`
    /// decides that and sits behind `billing.manage`, so a tech cannot be told
    /// which — and a second client-side opinion about one state is what the
    /// server's `reason` field exists to prevent.
    func testTheNumbersScreenNoLongerNamesACauseItCannotKnow() {
        for reader in [true, false] {
            let line = suspendedNumberLine(canManageBilling: reader)
            XCTAssertFalse(
                line.lowercased().contains("payment method"),
                "the numbers screen still sends a paid-up workspace to fix its card: \(line)"
            )
            // What IS true in both cases, and is the part nobody guesses.
            XCTAssertTrue(line.contains("still reach it"))
            XCTAssertTrue(line.contains("can't send or answer"))
        }
        XCTAssertTrue(
            suspendedNumberLine(canManageBilling: true).contains("Settings › Billing"),
            "somebody who can act on this was not told where"
        )
        XCTAssertTrue(
            suspendedNumberLine(canManageBilling: false).contains("account owner"),
            "a tech was sent to a screen that will not answer them"
        )
    }

    // MARK: - The card really uses all of this

    /// Every behaviour test above reads the logic functions. None of them says
    /// the CARD calls them, and a view that typed the sentence again would pass
    /// all of them — which is the defect, not a hypothetical: this repo's own
    /// enable-US card carried a flat "$29" in three sentences while the shared
    /// price book sat one import away.
    func testTheCardRendersFromTheDecisionRatherThanItsOwnCopy() throws {
        let source = try cardSource().joined(separator: "\n")
        XCTAssertTrue(
            source.contains("heldNumbersState("),
            "the card stopped asking `heldNumbersState` what to draw"
        )
        XCTAssertTrue(
            source.contains("reinstateNumberCopy("),
            "the consent sheet stopped reading the shared copy"
        )
        XCTAssertTrue(
            source.contains("reinstateOutcomeMessage("),
            "the card is describing the outcome in its own words again"
        )
    }

    /// No price is typed into this screen.
    ///
    /// The scan is `typesAPrice`, the same walk `CancelOneActionTests` runs over
    /// the billing screen — it tells a `$` in a SwiftUI binding and a `$0` inside
    /// interpolation apart from money, which a regular expression does not.
    func testNoPriceIsTypedIntoTheHeldNumbersCard() throws {
        var offenders: [String] = []
        for (index, raw) in try cardSource().enumerated() {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.hasPrefix("//") { continue }
            if typesAPrice(raw) {
                offenders.append("HeldNumbersCard.swift:\(index + 1): \(line)")
            }
        }
        XCTAssertEqual(
            offenders, [],
            "a price was typed into the card instead of read from the server"
        )
    }

    /// The scan is reading a real file with real content, so an empty read can
    /// never be mistaken for a clean one.
    func testThePriceScanIsActuallyReadingTheCard() throws {
        let lines = try cardSource()
        XCTAssertGreaterThan(lines.count, 100)
        XCTAssertTrue(lines.joined(separator: "\n").contains("struct HeldNumbersCard"))
        // And the walk still fires on money when money is there.
        XCTAssertTrue(typesAPrice("Text(\"An extra number is $5/mo\")"))
        XCTAssertFalse(typesAPrice("Button(\"Bring it back · \\(price)\") { }"))
    }

    private func cardSource() throws -> [String] {
        try settingsSource("HeldNumbersCard.swift")
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
    }

    // MARK: - Reading the sources

    /// One settings source from the repo — or a FAILURE, never a skip. The
    /// reasoning is in `MissingSource`, which every scan in this target now
    /// shares.
    ///
    /// The candidates are tried in order because the test bundle lives in
    /// DerivedData: `#filePath` is the compile-time path of THIS file and is the
    /// one that holds in CI, and the working-directory forms are for a runner
    /// invoked from `apps/ios` or from the repo root.
    private func settingsSource(
        _ name: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> String {
        let parts = ["Loonext", "Features", "Settings", name]
        let roots = [
            URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent() // LoonextTests
                .deletingLastPathComponent(), // ios
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent("apps")
                .appendingPathComponent("ios"),
        ]
        let candidates = roots.map { root in
            parts.reduce(root) { $0.appendingPathComponent($1) }
        }
        for candidate in candidates {
            // Line endings normalised: every window below is written with LF,
            // and a checkout on Windows hands back CRLF.
            if let text = try? String(contentsOf: candidate, encoding: .utf8) {
                return text.replacingOccurrences(of: "\r\n", with: "\n")
            }
        }
        throw missingSource(
            "\(name) — tried " + candidates.map(\.path).joined(separator: ", "),
            file: file,
            line: line
        )
    }

    private func numbersSource() throws -> String {
        try settingsSource("NumbersSection.swift")
    }

    /// The text between `marker` and the first `end` after it — the smallest
    /// window that holds one decision.
    ///
    /// A WINDOW RATHER THAN THE WHOLE FILE, which is the second draft of this
    /// guard on Android and is ported here for the same reason.
    /// `NumberStatus.suspended` appears in `NumbersSection.swift` several times
    /// over — the pill, the note, the card filter, the action gate — so a
    /// whole-file search for it passes with the arm it is about deleted. A guard
    /// that cannot see which occurrence it found is a spelling check.
    ///
    /// A missing marker FAILS rather than returning "": reformatting must send
    /// somebody to re-point the guard, not quietly retire it.
    private func window(
        _ source: String,
        from marker: String,
        to end: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> String {
        guard let start = source.range(of: marker) else {
            XCTFail(
                "this guard is pointed at code that no longer exists — re-point "
                    + "it rather than deleting it. Marker: \(marker)",
                file: file,
                line: line
            )
            throw MissingSource.at(marker)
        }
        let rest = source[start.upperBound...]
        guard let stop = rest.range(of: end) else {
            XCTFail("no \(end.debugDescription) after \(marker)", file: file, line: line)
            throw MissingSource.at(end)
        }
        return String(rest[..<stop.lowerBound])
    }

    // MARK: - A held line has to render at all, and be endable

    /// A HELD PORTED LINE HAS TO RENDER AT ALL.
    ///
    /// The card filter admitted `source == "provisioned"` or `status == active`.
    /// A ported number that goes on hold is neither, so it fell through both
    /// arms and appeared nowhere — no card, no "On hold" pill, no note — while
    /// the port tracker below only speaks about a transfer still in flight. The
    /// oldest-first restore makes this the likely case rather than a corner: the
    /// number a workspace ported in most recently is exactly the one held.
    func testAHeldNumberGetsACardWhateverItsSource() throws {
        let source = try numbersSource()
        let filter = try window(
            source,
            from: "let cards = data.numbers.filter { number in",
            to: "}"
        )
        XCTAssertTrue(
            filter.contains("NumberStatus.suspended"),
            "the card filter drops a held ported line, which then renders nowhere "
                + "in this app at all. Filter was: \(filter)"
        )
    }

    /// AND AN OWNER HAS TO BE ABLE TO END IT.
    ///
    /// The action row was gated on `status == active`, so Release — the only way
    /// to stop paying a carrier for a line the workspace has decided against,
    /// and the only way to clear the Pro-to-Starter checklist, which counts held
    /// rows — was unreachable from this app. Web has always drawn it for any row
    /// that is not released.
    func testAnOwnerCanGiveUpAHeldNumberFromThisApp() throws {
        let source = try numbersSource()
        let gate = try window(source, from: "private var manageable: Bool {", to: "\n    }")
        XCTAssertTrue(
            gate.contains("NumberStatus.suspended"),
            "a held number carries no actions, so it cannot be given up from a "
                + "phone. Gate was: \(gate)"
        )
        let row = try window(source, from: "if manageable {", to: "\n            }")
        // #228 moved the label into the catalogue, so the key IS the shipped
        // constant now — a guard quoting the English would fail on a French
        // release that lost nothing, and pass on a rename that lost the button.
        XCTAssertTrue(
            row.contains("\"settingsMore.release\""),
            "the action row is drawn for a held number but Release is not in it"
        )
        XCTAssertTrue(
            row.contains("canRelease"),
            "Release stopped being owner-only — `DELETE /v1/numbers/:id` needs "
                + "`workspace.own` and would refuse everybody else"
        )
        XCTAssertTrue(
            row.contains("canRelease && releasable"),
            "the Release control stopped asking the shared rule whether this row "
                + "may be given up. Row was: \(row)"
        )
    }

    /// #523 — ONE RULE FOR ONE IRREVERSIBLE CONTROL.
    ///
    /// This app used to draw Release for `active || suspended` with no
    /// subscription check anywhere near it, which made iOS the one client that
    /// offered "give it up for good" to a workspace whose real problem was a
    /// declined card. The gate is now `mayReleaseNumber`, and this pins that the
    /// screen asks it rather than restating it — a copy of the rule beside the
    /// rule is how the three clients disagreed in the first place.
    func testTheReleaseGateIsTheSharedRuleAndNotACopyOfIt() throws {
        let source = try numbersSource()
        let gate = try window(source, from: "private var releasable: Bool {", to: "\n    }")
        XCTAssertTrue(
            gate.contains("mayReleaseNumber("),
            "the release gate was rewritten inline instead of calling the shared "
                + "rule. Gate was: \(gate)"
        )
        XCTAssertTrue(
            gate.contains("subscriptionActive: company.subscriptionActive"),
            "the rule is being asked without the subscription, so a past-due "
                + "workspace is offered an irreversible button again. Gate was: \(gate)"
        )
        // The sheet answers to the same rule as the button that opens it.
        let sheet = try window(source, from: ".sheet(isPresented: $releasing) {", to: "\n        }")
        XCTAssertTrue(
            sheet.contains("if releasable {"),
            "the release sheet can be presented for a row the rule refuses. "
                + "Sheet was: \(sheet)"
        )
    }

    /// The rule itself, on every row that matters.
    func testWhoMayGiveUpANumber() {
        let live = "+14155550102"
        // The #523 hold: over the allowance, subscription paid up. The whole
        // reason the control exists on a suspended row at all.
        XCTAssertTrue(
            mayReleaseNumber(
                status: NumberStatus.suspended, numberE164: live, subscriptionActive: true
            ),
            "a held number cannot be given up from this app, so a mobile-only "
                + "owner keeps paying carrier rent on a line they cannot use"
        )
        // The other reason a number is suspended. The answer there is the card,
        // and an irreversible button is a press made in a panic.
        XCTAssertFalse(
            mayReleaseNumber(
                status: NumberStatus.suspended, numberE164: live, subscriptionActive: false
            ),
            "a past-due workspace is being offered 'give it up for good' as the "
                + "way out of a declined payment"
        )
        // An active line is releasable whatever the subscription is doing: the
        // grace window still has working numbers, and giving one up there is a
        // decision about the number rather than about the card.
        for active in [true, false] {
            XCTAssertTrue(
                mayReleaseNumber(
                    status: NumberStatus.active, numberE164: live, subscriptionActive: active
                )
            )
        }
        // Nothing to give up, or nothing to type into the confirmation.
        for status in [
            NumberStatus.provisioning, NumberStatus.provisionFailed, NumberStatus.released,
        ] {
            XCTAssertFalse(
                mayReleaseNumber(
                    status: status, numberE164: live, subscriptionActive: true
                ),
                "\(status) was offered a release"
            )
        }
        XCTAssertFalse(
            mayReleaseNumber(
                status: NumberStatus.active, numberE164: nil, subscriptionActive: true
            ),
            "a row with no digits was offered a confirmation box asking the "
                + "reader to type digits it has not got"
        )
    }

    /// The sheet that takes the confirmation says what releasing THIS row does.
    ///
    /// The one paragraph it used to carry ends "a number is included, so you can
    /// set up a new one here afterward", and for a held row that is false: the
    /// included number is already in use, which is why this one is on hold, so
    /// the replacement it promises is a paid extra.
    func testTheReleaseSheetSaysWhatGivingUpTHISROWDoes() throws {
        let source = try numbersSource()
        XCTAssertTrue(
            source.contains("releaseNumberMessage(heldOverAllowance: heldOverAllowance)"),
            "the release sheet stopped asking which kind of row it is releasing"
        )
        // And what it is handed is the ALLOWANCE hold rather than the status. A
        // past-due suspension is not a choice between two ways out, and the
        // held paragraph — "bringing it back from Settings › Billing stops being
        // an option" — describes a route that reader never had.
        let derived = try window(
            source,
            from: "private var heldOverAllowance: Bool {",
            to: "\n    }"
        )
        XCTAssertTrue(
            derived.contains("NumberStatus.suspended")
                && derived.contains("company.subscriptionActive"),
            "the sheet is back to reading a bare status, which cannot tell an "
                + "allowance hold from a declined card. Derivation was: \(derived)"
        )
        XCTAssertFalse(
            source.contains("so you can set up a new one here"),
            "the free-replacement promise is typed into the sheet again, where it "
                + "is false for every held row"
        )
        // And the note above the button still comes from the shared sentence
        // rather than a fourth copy of it.
        XCTAssertTrue(
            source.contains("suspendedNumberLine(canManageBilling:"),
            "the numbers screen is describing the hold in its own words again"
        )
    }

    /// The two messages are two decisions.
    func testReleasingAHeldNumberDoesNotPromiseAFreeReplacement() {
        let held = releaseNumberMessage(heldOverAllowance: true)
        let ordinary = releaseNumberMessage(heldOverAllowance: false)
        XCTAssertNotEqual(
            held, ordinary,
            "one paragraph is being shown for two different decisions"
        )
        for promise in ["set up a new one", "doesn't change your plan", "what you pay"] {
            XCTAssertFalse(
                held.contains(promise),
                "releasing a held number was said to cost nothing and to be "
                    + "replaceable for free — the included number is already in "
                    + "use, so the replacement is a paid extra: \(held)"
            )
        }
        // What it says instead: the hold is not the loss, and the other way out
        // closes with it.
        XCTAssertTrue(held.contains("on hold, not gone"))
        XCTAssertTrue(held.contains("still reach it"))
        XCTAssertTrue(held.contains("Settings › Billing"))
        // Neither branch quotes a price. The only figure in this product for
        // ending a hold is the served one on the billing card.
        for message in [held, ordinary] {
            XCTAssertFalse(typesAPrice("\"\(message)\""), "a price was typed into a release sheet")
            XCTAssertTrue(message.contains("for good"), "the permanence stopped being said")
            XCTAssertTrue(
                message.hasSuffix("Type the number to confirm."),
                "the typed confirmation stopped being asked for"
            )
        }
        XCTAssertTrue(
            ordinary.contains("set up a new one here afterward"),
            "the ordinary release lost the reassurance that is true for it"
        )
    }

    /// The hold note is not swallowed by the crew-size note.
    ///
    /// `statusBody` is an exclusive chain, so whichever arm matches first is the
    /// only thing the card says about the row's state. Today nothing depends on
    /// the order — `GET /v1/numbers` resolves `ring_targets` only for active
    /// rows — but a card whose hold note can be displaced by "nobody is rung on
    /// every call" is one server change away from telling a held workspace
    /// nothing at all.
    func testTheHoldNoteIsNotDisplacedByTheRingCeiling() throws {
        let source = try numbersSource()
        let hold = "} else if number.status == NumberStatus.suspended {"
        let ceiling = "} else if let ceiling = ringCeilingLine(number) {"
        guard let holdAt = source.range(of: hold), let ceilingAt = source.range(of: ceiling) else {
            XCTFail("the status chain was rewritten — re-point this guard")
            return
        }
        XCTAssertTrue(
            holdAt.lowerBound < ceilingAt.lowerBound,
            "the ring-ceiling arm is checked first, so a held row with a big crew "
                + "would be told about call fan-out and never told it is on hold"
        )
    }

    // MARK: - The two cards about one line have to agree

    /// A transfer row, decoded rather than built.
    ///
    /// `PortRequest` has thirty-one fields, a third of them behind `@Default`,
    /// and a memberwise call listing all of them is a fixture that breaks on
    /// every unrelated field the server adds. Decoding also exercises the shape
    /// the app actually receives.
    private func portRow(
        status: String,
        e164: String = "+14155550102",
        id: String = "p1"
    ) throws -> PortRequest {
        let json = "{\"id\":\"\(id)\",\"phone_e164\":\"\(e164)\","
            + "\"country\":\"US\",\"status\":\"\(status)\"}"
        return try JSONDecoder().decode(PortRequest.self, from: Data(json.utf8))
    }

    private func numberRow(
        status: String,
        e164: String? = "+14155550102",
        id: String = "n1",
        source: String? = "ported"
    ) -> PhoneNumberSummary {
        PhoneNumberSummary(
            id: id,
            status: status,
            country: "US",
            number_e164: e164,
            requested_area_code: nil,
            created_at: "2026-07-01T00:00:00Z",
            source: source,
            voice_enabled: nil,
            suspended_at: status == NumberStatus.suspended ? "2026-08-05T10:00:00Z" : nil,
            released_at: nil,
            failure_reason: nil,
            provision_attempts: nil,
            retrying: nil
        )
    }

    /// THE TRANSFER TRACKER MAY NOT CONTRADICT THE CARD ABOVE IT.
    ///
    /// #523 admitted `suspended` rows to the number-card filter, so a held
    /// ported line finally gets a card saying it is on hold — and left the
    /// tracker beside it drawing "Ported" in the positive tone over a full
    /// stepper. One screen then said both "this line is on hold and cannot send"
    /// and "Ported, all done". Two stories about one line is worse than the one
    /// wrong story it replaced, because now the owner has to pick.
    func testAFinishedTransferKnowsItsLineIsOnHold() throws {
        let completed = try portRow(status: PortStatus.ported)
        XCTAssertTrue(
            portedLineIsOnHold(completed, in: [numberRow(status: NumberStatus.suspended)]),
            "the tracker still celebrates a line that cannot send"
        )
        XCTAssertFalse(
            portedLineIsOnHold(completed, in: [numberRow(status: NumberStatus.active)]),
            "an ordinary finished transfer was told its line is held"
        )
        // A different line's hold is not this transfer's business. Matching is
        // on the E.164 because it is the one identifier both rows carry.
        XCTAssertFalse(
            portedLineIsOnHold(
                completed,
                in: [numberRow(status: NumberStatus.suspended, e164: "+14155550199")]
            ),
            "a hold on some other number silenced this transfer's tracker"
        )
        XCTAssertFalse(
            portedLineIsOnHold(completed, in: []),
            "a transfer with no delivered row resolved a hold out of nothing"
        )
        // A released number has been given up. Its card's story is the release,
        // and a hold note over it would be about a line nobody holds.
        XCTAssertFalse(
            portedLineIsOnHold(completed, in: [numberRow(status: NumberStatus.released)])
        )
    }

    /// AND IT ONLY EVER REPLACES THE FINISHED PILL.
    ///
    /// A transfer still with the carriers has its own true story — which step
    /// the order has reached — and overwriting that with "On hold" would be a
    /// fresh wrong story rather than a fix. The collision is real rather than
    /// theoretical: a landline text-enabled first carries a live `hosted` row
    /// with this same E.164 while a voice transfer of it is in flight.
    func testAnInFlightTransferIsNeverRelabelledByAHold() throws {
        let held = [numberRow(status: NumberStatus.suspended)]
        for status in [
            PortStatus.draft,
            PortStatus.submitted,
            PortStatus.inProcess,
            PortStatus.exception,
            PortStatus.focDateConfirmed,
            PortStatus.activationInProgress,
            PortStatus.cancelPending,
        ] {
            let inFlight = try portRow(status: status)
            XCTAssertFalse(
                portedLineIsOnHold(inFlight, in: held),
                "a transfer at \(status) had its own state replaced by a hold"
            )
        }
    }

    /// The tracker's sentence names WHICH of the two things is on hold.
    ///
    /// The card is titled "Transfer: …" and its pill now reads "On hold", which
    /// on its own could be read as the transfer stalling — a third wrong story,
    /// and the one this card is least entitled to tell, because the stepper
    /// under it is fully filled and correct. The number did move to us.
    func testTheTrackerSaysWhichOfTheTwoThingsIsHeld() {
        for reader in [true, false] {
            let line = portedLineOnHoldLine(canManageBilling: reader)
            XCTAssertTrue(
                line.hasPrefix("The transfer finished"),
                "the tracker's hold sentence stopped saying that the TRANSFER is "
                    + "fine, so 'On hold' reads as a stalled transfer: \(line)"
            )
            XCTAssertTrue(line.contains("the line that's on hold"))
            // Byte-identical to the number card's tail: two cards, one line, one
            // account of what a hold is.
            XCTAssertTrue(
                line.hasSuffix(heldNumberTail(canManageBilling: reader)),
                "the tracker grew its own second copy of the hold sentence: \(line)"
            )
            XCTAssertTrue(
                suspendedNumberLine(canManageBilling: reader)
                    .hasSuffix(heldNumberTail(canManageBilling: reader)),
                "the number card grew its own second copy of the hold sentence"
            )
            // It names no cause. This screen may not read the billing route that
            // decides which of the two holds this is.
            XCTAssertFalse(line.lowercased().contains("payment method"))
        }
        XCTAssertTrue(
            portedLineOnHoldLine(canManageBilling: true).contains("Settings › Billing"),
            "somebody who can act on this was not told where"
        )
        XCTAssertTrue(
            portedLineOnHoldLine(canManageBilling: false).contains("account owner"),
            "a tech was sent to a screen that will not answer them"
        )
    }

    /// And the tracker actually renders all of that.
    ///
    /// Every assertion above reads the logic. None of them says the CARD calls
    /// it, and a tracker that ignored both and went on drawing the positive pill
    /// would pass every one — which is the defect, not a hypothetical: that is
    /// exactly the state #523 left this file in.
    func testTheTrackerRendersTheHoldRatherThanCelebrating() throws {
        let source = try settingsSource("PortCards.swift")
        XCTAssertTrue(
            source.contains("onHold: portedLineIsOnHold(port, in: numbers)"),
            "the tracker stopped asking whether the line it delivered still works"
        )
        let pill = try window(
            source,
            from: "private var statusPill: some View {",
            to: "\n    }"
        )
        XCTAssertTrue(
            pill.contains("if onHold {"),
            "the pill no longer branches on the hold, so a held line is labelled "
                + "by its transfer alone. Pill was: \(pill)"
        )
        // The positive arm is still there for an ordinary finished transfer —
        // this is not a guard against saying "Ported", it is a guard against
        // saying it over a line that cannot send.
        // #228 moved the label into the catalogue. The key is the shipped
        // constant, and the TONE is the half that carries the claim — a lime
        // pill over a line that can neither send nor answer is the defect.
        XCTAssertTrue(pill.contains("\"settingsMore.portStepPorted\""))
        guard let holdAt = pill.range(of: "if onHold {"),
              let portedAt = pill.range(of: "\"settingsMore.portStepPorted\"")
        else {
            XCTFail("the pill was rewritten — re-point this guard")
            return
        }
        XCTAssertTrue(
            holdAt.lowerBound < portedAt.lowerBound,
            "the finished-transfer arm is reached first, so the hold branch can "
                + "never run and the card celebrates a held line again"
        )
        XCTAssertTrue(
            source.contains("portedLineOnHoldLine("),
            "the tracker is describing the hold in its own words again"
        )
        // The stepper is deliberately untouched: the transfer did complete, so
        // it still reads the transfer's own status. Dimming it under a hold
        // would swap one wrong claim for another.
        XCTAssertTrue(
            source.contains("PortStepper(status: port.status)"),
            "the stepper stopped reporting the transfer's own state — the number "
                + "did move to us, and a hold is not a reason to deny it"
        )
    }

    /// The scan is reading the real tracker, so an empty read cannot pass as a
    /// clean one. `settingsSource` fails rather than skips when the file moves;
    /// this is the second half of that, for a file that is present but wrong.
    func testTheTrackerScanIsActuallyReadingTheTracker() throws {
        let source = try settingsSource("PortCards.swift")
        XCTAssertGreaterThan(source.count, 5_000)
        XCTAssertTrue(source.contains("struct PortsBlock"))
        XCTAssertTrue(
            source.contains("let numbers: [PhoneNumberSummary]"),
            "the tracker block cannot see the numbers list, so it cannot know "
                + "about a hold at all"
        )
    }

    /// The numbers screen hands the list down. Without this the block above
    /// compiles, reads an empty list and reports no hold, ever.
    func testTheNumbersScreenHandsTheListToTheTracker() throws {
        let source = try numbersSource()
        let block = try window(source, from: "PortsBlock(", to: "\n                )")
        XCTAssertTrue(
            block.contains("numbers: data.numbers"),
            "the tracker is built without the numbers list. Call was: \(block)"
        )
    }
}
