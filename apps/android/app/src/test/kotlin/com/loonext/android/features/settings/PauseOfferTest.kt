package com.loonext.android.features.settings

import com.loonext.android.core.scheduled.ScheduledSend
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * #277 — the paid pause, on the phone.
 *
 * A trades crew goes quiet for the winter, keeps its number and its history,
 * stops texting, and pays a holding fee instead of the plan. No 30-day fuse.
 *
 * THREE THINGS CAN GO WRONG HERE, and they are not the same thing, so this file
 * has three halves.
 *
 * The first is A PAUSE OFFERED WHERE THERE IS NONE. `eligible` is decided by
 * eight server-side gates and a live Stripe price lookup; nothing on this device
 * can re-derive any of it. A client that ORs, guesses or caches its way to a
 * Pause button shows somebody a control that answers 409, on the screen they
 * came to leave from.
 *
 * The second is A PRICE WE MADE UP. This button starts a RECURRING charge, and
 * the one rule that cannot bend is that the amount is stated before anybody
 * agrees to it. So the guards below are not "the copy mentions a price" — they
 * are "every money token in the copy is the one the API sent", which is the only
 * form that fails when somebody types a plausible number in.
 *
 * The third is THE EXIT MOVING. Reaching Stripe having answered nothing must
 * stay ONE action from landing on the billing screen. A previous round of this
 * feature regressed that from one to two on all three clients and every build
 * report called it fine, so the layout property is asserted as a source lint in
 * the [CancellationFlowTest] idiom rather than trusted.
 *
 * WHAT IS NOT HERE: the words a held scheduled send is described with. Those
 * live in `core/scheduled/ScheduledSend.kt`, which already carries
 * `workspace_paused` for all three clients. This file checks that they were not
 * written a second time.
 */
class PauseOfferTest {

    private val billingSection = "features/settings/BillingSection.kt"
    private val settingsLogic = "features/settings/SettingsLogic.kt"

    /**
     * BOTH FILES, always. A guard aimed at one of them proves nothing about the
     * pause: the screen is in `BillingSection.kt` and every sentence it renders
     * is in `SettingsLogic.kt`, so a copy scan pointed at the first is pointed
     * at the file where the words are NOT.
     */
    private val pauseCopyFiles = listOf(billingSection, settingsLogic)

    // -- what may put a pause control on screen -------------------------------

    /** The offer as the API sends it when everything is in order. */
    private fun offered(cents: Long? = 500L) = PauseState(
        eligible = true,
        reason = null,
        paused_at = null,
        monthly_cents = cents,
        resume_plan = "pro",
    )

    /** Every documented refusal, which the route sends with `eligible: false`. */
    private val refusals = listOf(
        "not_provisioned",
        "no_subscription",
        "already_paused",
        "subscription_unhealthy",
        "plan_change_pending",
        "referral_month_pending",
        "already_prepaid",
        "prepaid_coupon_orphaned",
    )

    /**
     * `eligible` IS THE GATE, and this client adds nothing to it.
     *
     * The route answers `eligibility.eligible && offer !== null`, so a pause it
     * cannot quote already reports false. Every other field is information; none
     * of them may put a control on screen on their own.
     */
    @Test
    fun `nothing is offered unless the API says this workspace may pause`() {
        assertNull("no answer yet is not an offer", pauseOfferCopy(null))
        refusals.forEach { reason ->
            assertNull(
                "$reason must render nothing at all — not a greyed control, not an " +
                    "explanation of a control nobody was shown",
                pauseOfferCopy(
                    PauseState(eligible = false, reason = reason, monthly_cents = 500L),
                ),
            )
        }
        // And an eligible workspace really is offered one, so the assertions
        // above are about the gate rather than about a dead branch.
        assertNotNull(pauseOfferCopy(offered()))
    }

    /**
     * A PRICE WE CANNOT QUOTE IS NOT AN OFFER, even if the server said eligible.
     *
     * Belt to the route's braces. The failure this makes impossible is a Pause
     * button rendered beside a blank where the amount should be — which is the
     * same defect as a made-up number, arrived at by omission instead.
     */
    @Test
    fun `an offer with no figure beside it is not offered`() {
        assertNull(pauseOfferCopy(offered(cents = null)))
        assertNotNull(pauseOfferCopy(offered(cents = 1L)))
    }

    /**
     * The refusal codes are for a bug report, never for a person. Most say
     * nothing worth explaining, and `not_provisioned` means the offer does not
     * exist at all — an explanation there would be describing a feature to
     * somebody who cannot have it.
     *
     * "ANYWHERE" USED TO MEAN ONE FILE. This scanned `BillingSection.kt` alone,
     * which is the file that renders the pause and not the file that words it:
     * every pause sentence in the product is built in `SettingsLogic.kt`, so a
     * refusal code pasted into [pauseOfferCopy] or [pausedStateCopy] would have
     * shipped past a guard whose name promised otherwise. The held-message
     * guard below had scanned the pair since the day it was written; this one
     * had simply never been told there were two.
     *
     * ONE CODE IS ALSO PLAIN ENGLISH, and it is handled below rather than here.
     * The wire spelling `already_paused` stays banned in both files; its prose
     * form is the opening of the answer a PAUSED reader is given ("Your plan is
     * already paused, and that hold has no deadline"), which is a description of
     * their own account and the one sentence on this screen that has to say it.
     * Banning it outright would be a guard outliving the fact that justified it
     * — the fact being a code used to explain why an absent control is absent,
     * which is unchanged and still guarded.
     */
    @Test
    fun `the reason a pause is unavailable is never printed anywhere`() {
        pauseCopyFiles.forEach { file ->
            val spoken = spokenCopy(readMainSource(file)).lowercase()
            refusals.forEach { reason ->
                assertFalse(
                    "`$reason` reaches the screen from $file. These are wire codes " +
                        "for the eight server-side gates, and a screen that explains " +
                        "why an absent control is absent has invented a control",
                    spoken.contains(reason),
                )
                if (reason == "already_paused") return@forEach
                assertFalse(
                    "`$reason` reaches the screen from $file, spelled out",
                    spoken.contains(reason.replace("_", " ")),
                )
            }
        }
    }

    /**
     * ...AND THE ONE EXCEPTION IS PINNED TO THE SENTENCE THAT EARNED IT.
     *
     * "Already paused" is exempt from the sweep above because the answer written
     * for a paused reader opens with it. That exemption is worth exactly one
     * string, so this counts: it may appear once across both files, and the
     * place it appears must be the answer [cancellationOffer] gives a workspace
     * that is in a pause. Pasted anywhere else — into [pauseOfferCopy] as an
     * explanation of a missing button, into [planStateUnknownNote] as a guess
     * about a read that failed — the count goes to two and this fails.
     */
    @Test
    fun `only the paused reader's own answer says already paused`() {
        val spoken = pauseCopyFiles.joinToString(" ") {
            spokenCopy(readMainSource(it))
        }.lowercase()
        assertEquals(
            "`already paused` is written in more than one place. It is allowed in " +
                "exactly one: the seasonal answer given to a workspace that IS paused",
            1,
            Regex("already paused").findAll(spoken).count(),
        )
        assertTrue(
            "and that one place must be the paused answer itself",
            cancellationOffer("seasonal", "pro", paused = true)!!
                .heading.lowercase().contains("already paused"),
        )
        // Never to anybody else, which is the property the sweep above is about.
        assertFalse(
            "an unpaused workspace must not be told anything is already paused",
            cancellationOffer("seasonal", "pro")!!.heading.lowercase()
                .contains("already paused"),
        )
    }

    /** The pause answers the one reason that is a description of it. */
    @Test
    fun `the pause answers the seasonal reason and no other`() {
        assertEquals("seasonal", PAUSE_ANSWERS_REASON)
        assertTrue(
            "the code must be one the cancel card can actually store",
            CANCELLATION_REASONS.any { it.code == PAUSE_ANSWERS_REASON },
        )
        val note = composable("CancellationOfferNote")
        assertTrue(
            "the pause must be gated on the reason as well as on eligibility — " +
                "offered against `too_expensive` it is a second bill, and against " +
                "`not_using` it is a subscription to nothing",
            note.contains("reason == PAUSE_ANSWERS_REASON"),
        )
    }

    // -- the money, which is the half a customer discovers on their card ------

    /**
     * Every money token in a string, as the reader sees it.
     *
     * A LEADING `$` IS NOT WHAT MAKES A NUMBER A PRICE. This matched only
     * `$12.75`, so `You are charged 12.75 USD today.` was invisible to every
     * assertion built on it - on the resume confirmation, which is the one
     * surface in this feature where somebody agrees to a recurring charge.
     * That sentence passed the whole suite.
     *
     * The bare-decimal arm is deliberate rather than defensive: this tree
     * already carries `BillingCurrency.CAD` and `Locale.CANADA`, so a figure
     * written `12,75 EUR` or `CA$12.75` is the ordinary shape of the next
     * currency somebody adds rather than an exotic one.
     */
    private fun moneyIn(text: String): List<String> =
        Regex("""[A-Z]{0,2}\$\s?[0-9][0-9.,]*|\b[0-9]+[.,][0-9]{2}\b""")
            .findAll(text).map { it.value.trim() }.toList()

    /**
     * A pause fee, and the exact characters it must become on screen.
     *
     * BOTH SIDES ARE WRITTEN OUT, and the literal is the whole point of the
     * pair. A price assertion that reads `contains(formatMonthlyCents(cents))`
     * compares the shipped formatter's output against the shipped copy built out
     * of that same formatter, which is a tautology: rewrite [formatMonthlyCents]
     * to return a constant and the assertion still passes. Somebody is agreeing
     * to a recurring charge here, so the one thing that may not be
     * self-referential is the amount.
     *
     * TWO FIXTURES, ONE PER SURFACE, AND THEY MAY NEVER BE THE SAME NUMBER —
     * #524, adopted from web (1275/500) and iOS (1275/940). The offer and the
     * paused card are different copy for different moments, but they are built
     * side by side in one file out of one formatter, so a constant typed into a
     * shared sentence satisfies every literal assertion in reach of it. That is
     * not hypothetical: the paused price was once asserted as
     * `heading.contains("$5")` against a 500-cent fixture, which is exactly what
     * a heading with "$5" written into it produces, and the guard passed on the
     * defect it was written to catch.
     *
     * Split across two amounts, no single injected figure can satisfy both — and
     * [the two proving amounts are never the same] fails if a later edit quietly
     * points them at one number again. Neither is round, so both exercise the
     * formatter's fractional branch; neither is a plan price, so neither can
     * collide with the price book. The round-number branch is covered by the
     * sweeps below, which run several amounts including whole dollars.
     */
    private val offerCents = 1275L
    private val offerPrice = "\$12.75"

    private val pausedCents = 940L
    private val pausedPrice = "\$9.40"

    /**
     * ...AND THE SPLIT IS A PROPERTY, NOT A COINCIDENCE OF TWO CONSTANTS.
     *
     * The whole value of the pair is that they differ. Pointed at one number —
     * by a tidy-up, or by somebody making a fixture "consistent" — the two
     * literal assertions below become satisfiable by one injected sentence
     * again, silently, with both tests still green.
     */
    @Test
    fun `the two proving amounts are never the same`() {
        assertTrue(
            "the offer and the paused card must be proved with DIFFERENT figures, " +
                "or one hardcoded price satisfies both",
            offerCents != pausedCents && offerPrice != pausedPrice,
        )
        // And each literal really is what the shipped formatter makes of its own
        // amount, so the pair cannot drift into asserting nothing.
        assertEquals(offerPrice, formatMonthlyCents(offerCents))
        assertEquals(pausedPrice, formatMonthlyCents(pausedCents))
    }

    /**
     * THE FIGURE IS THE API'S, TO THE CENT, and it is on the control.
     *
     * A price shown only in the paragraph above the button is a price somebody
     * presses past. Both labels carry it because both are a place a thumb lands.
     */
    @Test
    fun `the price the API sent is on the offer and on both buttons`() {
        val copy = pauseOfferCopy(offered(cents = offerCents))!!
        listOf(
            "heading" to copy.heading,
            "body" to copy.body,
            "the control" to copy.actionLabel,
            "the confirmation" to copy.confirmBody,
            "the confirm button" to copy.confirmLabel,
        ).forEach { (where, text) ->
            assertTrue(
                "$where must name the real monthly figure: $text",
                text.contains(offerPrice),
            )
        }
        // Whole dollars stay whole — a trailing .00 on a plan price reads as
        // machine output, which is house style everywhere else on this screen.
        assertTrue(pauseOfferCopy(offered(cents = 500L))!!.actionLabel.contains("\$5"))
        assertFalse(pauseOfferCopy(offered(cents = 500L))!!.actionLabel.contains("\$5.00"))
    }

    /**
     * THE GUARD THAT SURVIVES A REPRICING. "The copy mentions a price" passes on
     * a literal typed into the sentence; this fails on it, because every money
     * token in the offer has to BE the figure the API sent.
     *
     * Run over several amounts so a copy that happens to agree with one fixture
     * cannot pass by coincidence.
     */
    @Test
    fun `the offer names no amount the API did not send`() {
        listOf(100L, 499L, 500L, 1250L, 9999L).forEach { cents ->
            val copy = pauseOfferCopy(offered(cents = cents))!!
            val expected = formatMonthlyCents(cents)
            val everything = listOf(
                copy.heading,
                copy.body,
                copy.actionLabel,
                copy.confirmTitle,
                copy.confirmBody,
                copy.confirmLabel,
            ).joinToString(" ")
            val money = moneyIn(everything)
            assertTrue("the offer must state a price at all", money.isNotEmpty())
            money.forEach { token ->
                assertEquals(
                    "the pause offer quotes $token while the API said $expected. Every " +
                        "figure on this card comes from GET /v1/billing/pause — a " +
                        "second one is a recurring charge somebody agreed to without " +
                        "being told the amount",
                    expected,
                    token,
                )
            }
        }
    }

    /**
     * NO FIGURE ON THIS SCREEN IS TYPED. Every one is cents from the API, run
     * through [formatMonthlyCents] or [planFacts].
     *
     * BOTH FILES, WHICH IS THE WHOLE POINT (#524). The screen is
     * `BillingSection.kt` and every sentence it renders is built in
     * `SettingsLogic.kt`, so the iOS twin of this guard shipped for a while
     * pointed at the screen alone — at the file where the words are NOT. A price
     * typed into a sentence is invisible from there, and the sweeps above only
     * see the surfaces they were told to look at: a figure written into a
     * sentence nobody added to a list is a number with no read behind it,
     * shown to somebody about to agree to a recurring charge.
     *
     * SLICED, AND HERE IS THE ONE THING THE SLICE LEAVES OUT. Above
     * `CANCELLATION_REASONS`, `SettingsLogic.kt` carries the merge-field tidier,
     * whose `Regex(...)` replacement template is the string "$1" — a
     * backreference, not a price, and a scan reading "a `$` then a digit" cannot
     * tell them apart. Everything above the cut is a price BOOK rather than a
     * sentence and has its own pins: `pins the shared price book against the
     * TypeScript it was ported from` in [CancellationOfferTest],
     * [ExtraNumberPriceTest] and [RegistrationFeeTest] all read those
     * declarations directly.
     */
    @Test
    fun `no price is typed into the billing screen or into its words`() {
        val cut = "val CANCELLATION_REASONS"
        val logic = withoutComments(readMainSource(settingsLogic))
        val at = logic.indexOf(cut)
        assertTrue(
            "`$cut` is gone from $settingsLogic, so this guard no longer knows where " +
                "the sentences start. Re-anchor it rather than deleting it",
            at > 0,
        )

        val typed = Regex("\\\$\\s?[0-9]")
        listOf(
            billingSection to withoutComments(readMainSource(billingSection)),
            settingsLogic to logic.substring(at),
        ).forEach { (file, source) ->
            val offenders = typed.findAll(source)
                .map { source.substring(it.range.first, minOf(source.length, it.range.last + 20)) }
                .toList()
            assertEquals(
                "a figure is written into $file: $offenders. Prices on this screen " +
                    "arrive from the API as cents and are formatted by " +
                    "`formatMonthlyCents` or `planFacts` — a typed one is a charge " +
                    "with no read behind it, and it agrees with the sweeps above " +
                    "exactly until the day the price changes",
                emptyList<String>(),
                offenders,
            )
        }
    }

    /**
     * The paused state quotes THE MIRROR — what this workspace is being charged
     * — and where the mirror has no figure it names none. Today's catalog price
     * substituted into the gap would be quoting a charge nobody is on.
     *
     * ASSERTED AGAINST ITS OWN FIGURE, WHICH IS NOT THE OFFER'S. This used to
     * read `heading.contains("$5")` over a 500-cent fixture, which is what a
     * heading with "$5" written into it says too — the assertion and the defect
     * were the same string. It is now [pausedCents], deliberately a different
     * amount from the one the offer is proved with, so no single price typed
     * into a sentence these two surfaces share can satisfy both. See
     * [offerCents].
     */
    @Test
    fun `the paused state names the mirror's figure, or no figure at all`() {
        val paused = PauseState(
            eligible = false,
            reason = "already_paused",
            paused_at = "2026-01-15T09:00:00Z",
            monthly_cents = pausedCents,
            resume_plan = "pro",
        )
        val copy = pausedStateCopy(paused, "Pro")!!
        assertTrue(
            "the paused heading must name what this workspace is actually charged: " +
                "${copy.heading}",
            copy.heading.contains(pausedPrice),
        )
        assertEquals(
            "the paused card quotes a figure the mirror did not send. Every amount " +
                "on it is `monthly_cents` — this is what the customer's statement " +
                "says, and a second number here is a charge they did not agree to",
            listOf(pausedPrice),
            moneyIn(
                listOf(
                    copy.heading, copy.body, copy.resumeLabel,
                    copy.confirmTitle, copy.confirmBody, copy.confirmLabel,
                ).joinToString(" "),
            ).distinct(),
        )

        // Several amounts, so copy that happens to agree with one fixture cannot
        // pass by coincidence — and the round one, which is the branch that
        // drops the cents.
        //
        // ALL SIX FIELDS, AND THAT IS THE FIX RATHER THAN THOROUGHNESS. This
        // swept `heading` and `body` only, which left the assertion above — a
        // comparison against the literal [pausedPrice] at ONE amount — as the
        // sole guard on the other four. A literal satisfies itself: typing
        // "You are charged $9.40 today." into `confirmBody` passed every test in
        // this module, because at that one amount the injected figure IS the
        // expected one and no other amount was ever tried on that field.
        //
        // `confirmBody` is the worst possible place for that hole. It is the
        // resume confirmation — the sentence somebody reads immediately before
        // agreeing to be charged the plan price again — so it is the one surface
        // on this card where a made-up number is money changing hands rather
        // than a wrong word. Swept across five amounts it cannot hold a constant
        // at all: at 100 cents an injected "$9.40" is not "$1", and this fails
        // naming both.
        listOf(100L, 499L, 500L, 1250L, 9999L).forEach { cents ->
            val each = pausedStateCopy(paused.copy(monthly_cents = cents), "Pro")!!
            val everything = listOf(
                each.heading,
                each.body,
                each.resumeLabel,
                each.confirmTitle,
                each.confirmBody,
                each.confirmLabel,
            ).joinToString(" ")
            moneyIn(everything).forEach { token ->
                assertEquals(
                    "the paused card quotes $token while the mirror said $cents cents. " +
                        "Every figure on this card is `monthly_cents`, and the " +
                        "confirmation is where somebody agrees to the charge",
                    formatMonthlyCents(cents),
                    token,
                )
            }
        }

        val noFigure = pausedStateCopy(paused.copy(monthly_cents = null), "Pro")!!
        assertTrue(
            "with no mirrored price the heading must still say the plan is paused",
            noFigure.heading.contains("Paused"),
        )
        assertTrue(
            "and it must name no amount rather than borrow one: ${noFigure.heading}",
            moneyIn(noFigure.heading + noFigure.body).isEmpty(),
        )
    }

    /**
     * #524 — the sentence a paused reader is given INSTEAD of the promise the
     * cancel card's standing header used to make them.
     *
     * That header read "Texting stops at the end of your billing period", which
     * is a promise of texting until then made to somebody whose texting stopped
     * the day they paused — on the same screen as the card telling them so. The
     * header is now true for both readers and says nothing about the pause,
     * because it renders ABOVE the button that leaves and may not reflow when a
     * Stripe round trip lands. [pausedCancelNote] is the rest of the truth, and
     * the render site puts it below that button.
     *
     * ONLY AN ANSWERED READ SPEAKS, which is the same rule every other claim on
     * this screen follows: a read in flight and a read that failed are not
     * permission to tell somebody their plan is paused.
     *
     * WHAT IT MAY NOT DO is quote a price. The amount lives on the paused card
     * above, where it is the mirror's own figure; a second copy of it down here
     * is a number with no read behind it.
     */
    @Test
    fun `only a workspace we were TOLD is paused is told what cancelling starts`() {
        listOf(
            PauseRead.Unasked,
            PauseRead.Loading,
            PauseRead.Failed,
            PauseRead.Answered(offered()),
        ).forEach { read ->
            assertNull(
                "$read is not an answer that this workspace is paused, so it may not " +
                    "be told anything about being paused",
                pausedCancelNote(read),
            )
        }

        val note = pausedCancelNote(
            PauseRead.Answered(
                PauseState(paused_at = "2026-01-15T09:00:00Z", monthly_cents = pausedCents),
            ),
        )!!
        assertTrue(
            "the reader has to be told that the thing cancelling starts is the clock " +
                "a pause has been keeping off their number: $note",
            note.contains("$CANCELLATION_GRACE_DAYS days"),
        )
        // #529: AND WHERE THE CLOCK IS COUNTED FROM. This asserted
        // `contains("30-day")` and nothing else, so it pinned a spelling rather
        // than a fact — the note said "starts the 30-day clock on your number"
        // with no anchor at all and this test was green.
        //
        // The anchor is the expensive half. `runGraceJob` measures
        // `now - companies.canceled_at`, and Stripe stamps that at the time of
        // the REQUEST; this sentence arrives one breath after "your plan runs to
        // the end of the billing period", so an unanchored "30 days" reads as 30
        // days from THAT. Somebody who cancels on day 2 of a month counts about
        // 59 days and has about 30, and loses the number on the side of the van.
        //
        // The web client asserts this for every duration anywhere on its cancel
        // card (OFFER-13). This note is Android-only, so no shared assertion ever
        // read it — which is how it shipped without the clause.
        assertTrue(
            "the note names $CANCELLATION_GRACE_DAYS days without saying where they " +
                "are counted from. A duration with no anchor on this card is read " +
                "from the period end, which is most of a month later than the truth: " +
                "$note",
            note.contains("from the day you cancel"),
        )
        assertTrue(
            "and it must not quote an amount: the figure belongs to the paused card, " +
                "which reads it off the mirror. $note",
            moneyIn(note).isEmpty(),
        )
    }

    /**
     * THE RULE THAT CANNOT BEND, GUARDED WHERE IT CAN ACTUALLY BE BROKEN.
     *
     * Every eligibility and price assertion above this line tests
     * [pauseOfferCopy] and [pausedStateCopy], which are pure and behave
     * perfectly. None of them touches the RENDER SITE — so a verifier left both
     * functions alone, replaced the API's answer one line before the call with
     * `PauseState(eligible = true, monthly_cents = 500L)`, and every test in
     * this file passed while the screen offered a made-up holding fee to a
     * workspace the server refuses.
     *
     * Three properties close it, and each one is about the screen rather than
     * the copy: each decision function is consulted exactly ONCE, with the
     * read's own answer and nothing else; and every [PauseState] the screen
     * constructs is built out of a response to a write, never out of literals.
     * A fallback has nowhere left to go.
     */
    @Test
    fun `the screen never mints eligibility or a price of its own`() {
        val src = withoutComments(readMainSource(billingSection))

        assertEquals(
            "the offer is decided once, from the read's own answer. A second call " +
                "site is where a fallback goes, and a fallback here is a recurring " +
                "charge quoted to somebody the API would refuse",
            listOf("pause.answer"),
            Regex("pauseOfferCopy\\(([^)]*)\\)").findAll(src)
                .map { it.groupValues[1].trim() }
                .toList(),
        )
        assertEquals(
            "the paused state is decided once, from the read's own answer",
            1,
            Regex("pausedStateCopy\\(").findAll(src).count(),
        )
        assertEquals(
            listOf("answer"),
            Regex("pausedStateCopy\\(\\s*([A-Za-z0-9_.]+)\\s*,").findAll(src)
                .map { it.groupValues[1] }
                .toList(),
        )

        val built = Regex("PauseState\\(([^)]*)\\)").findAll(src)
            .map { it.groupValues[1] }
            .toList()
        assertTrue(
            "the screen must still build the state the API told it about — if this " +
                "moved, point the guard at the new shape rather than deleting it",
            built.isNotEmpty(),
        )
        built.forEach { args ->
            assertFalse(
                "the screen declares a workspace eligible to pause: `$args`. Eight " +
                    "server-side gates and a live price lookup decide that, and " +
                    "nothing on this device can re-derive any of it",
                Regex("eligible\\s*=\\s*true").containsMatchIn(args),
            )
            Regex("(monthly_cents|paused_at|resume_plan)\\s*=\\s*([^,\n]+)")
                .findAll(args)
                .forEach { field ->
                    val name = field.groupValues[1]
                    val value = field.groupValues[2].trim()
                    assertTrue(
                        "`$name = $value` is not the API's answer. Every field of a " +
                            "pause this screen believes in comes off the route's own " +
                            "re-read of the mirror, because a replayed pause returns " +
                            "a cached Stripe response with no swap performed",
                        value.startsWith("settled."),
                    )
                }
        }
    }

    // -- what the screen knows, which is not the same as what is true ---------

    /**
     * THE DEFECT, AS A TYPE.
     *
     * `PauseState?` carried three meanings in one nullable — nobody asked, the
     * API said no, the ask failed — and all three rendered as an ordinary
     * running plan. A paused workspace whose cold-start read failed was shown a
     * green `Active` pill beside `Pro`, five allowance lines describing a plan
     * that is not running, and a live plan-switch button whose POST 409s by
     * design, while it paid a holding fee and could not send.
     *
     * So the accessors are the guard. [PauseRead.answer] is null unless there
     * IS one, and [PauseRead.isRunning] is deliberately not `!isPaused`: that
     * expression is true of a read in flight and of a read that failed, and it
     * is the one every claim on the plan card used to hang off.
     */
    @Test
    fun `a read that has not landed, or that failed, is not an answer`() {
        val paused = PauseState(
            eligible = false,
            reason = "already_paused",
            paused_at = "2026-01-15T09:00:00Z",
            monthly_cents = 500L,
            resume_plan = "pro",
        )
        val unanswered = listOf<PauseRead>(
            PauseRead.Unasked,
            PauseRead.Loading,
            PauseRead.Failed,
        )

        unanswered.forEach { read ->
            assertNull("$read is not an answer", read.answer)
            assertFalse("$read cannot know that a workspace is paused", read.isPaused)
            assertFalse(
                "$read reports a running plan. The pill, the allowance lines, the " +
                    "plan switch and the add-ons card all hang off `isRunning`, and " +
                    "a read nobody has an answer to may license none of them",
                read.isRunning,
            )
        }

        assertEquals(paused, PauseRead.Answered(paused).answer)
        assertTrue(PauseRead.Answered(paused).isPaused)
        assertFalse(
            "paused is not running, however active Stripe still calls the " +
                "subscription — the pause is a price swap, not a status change",
            PauseRead.Answered(paused).isRunning,
        )
        assertFalse(PauseRead.Answered(offered()).isPaused)
        assertTrue(PauseRead.Answered(offered()).isRunning)
    }

    /**
     * A SCREEN MAY NOT STATE A FACT IT HAS NOT READ.
     *
     * The two rows that matter are `Unasked` and `Failed` with an active
     * subscription: that is the shipped defect exactly, and it used to be green.
     * `Loading` says only that we are asking, which is all that is true yet.
     */
    @Test
    fun `the plan card claims nothing about a plan it has not asked about`() {
        val running = offered()
        val paused = PauseState(
            paused_at = "2026-01-15T09:00:00Z",
            monthly_cents = 500L,
            resume_plan = "pro",
        )

        listOf<PauseRead>(PauseRead.Unasked, PauseRead.Failed).forEach { read ->
            assertNull(
                "$read badges the plan. Nothing was read, so nothing may be claimed " +
                    "— and the claim this made was the reassuring one",
                planBadge(read, subscriptionActive = true, cancelAtPeriodEnd = false),
            )
        }
        assertEquals(
            "the load window must say what it is doing rather than guess",
            PlanBadge.Checking,
            planBadge(PauseRead.Loading, subscriptionActive = true, cancelAtPeriodEnd = false),
        )
        assertEquals(
            PlanBadge.Active,
            planBadge(PauseRead.Answered(running), subscriptionActive = true, cancelAtPeriodEnd = false),
        )
        assertEquals(
            "a paused workspace's subscription is still `active` in Stripe, so this " +
                "row is the one that has to come back Paused",
            PlanBadge.Paused,
            planBadge(PauseRead.Answered(paused), subscriptionActive = true, cancelAtPeriodEnd = false),
        )
        // Past due, unpaid, or on the way out: the amber banner at the top of the
        // screen has already said which, and a second badge saying it again is
        // noise on a screen somebody is reading in a hurry.
        assertNull(
            planBadge(PauseRead.Answered(running), subscriptionActive = false, cancelAtPeriodEnd = false),
        )
        assertNull(
            planBadge(PauseRead.Answered(running), subscriptionActive = true, cancelAtPeriodEnd = true),
        )
    }

    /**
     * Only the FAILURE explains itself. The load window is covered by the pill,
     * and narrating a network request at somebody reading their plan is not
     * information; nobody asked in the `Unasked` case, and for a member nobody
     * can — GET /v1/billing/pause is behind `billing.manage`.
     *
     * The sentence has to say that nothing changed, because that is the reader's
     * next thought after "couldn't check".
     */
    @Test
    fun `only a failed read explains itself, and it says nothing happened`() {
        assertNull(planStateUnknownNote(PauseRead.Unasked))
        assertNull(planStateUnknownNote(PauseRead.Loading))
        assertNull(planStateUnknownNote(PauseRead.Answered(offered())))

        val note = planStateUnknownNote(PauseRead.Failed)!!
        assertTrue(
            "the failure must say what it could not do: $note",
            note.lowercase().contains("couldn't check"),
        )
        assertTrue(
            "and that the plan and the number are untouched, which is the reader's " +
                "next question: $note",
            note.contains("untouched"),
        )
        refusals.forEach { reason ->
            assertFalse("a wire code reached the customer: $note", note.contains(reason))
        }
        assertTrue(
            "a failure may not name an amount — there is no figure to name",
            moneyIn(note).isEmpty(),
        )
    }

    // -- what is true while paused, said out loud -----------------------------

    /**
     * BOTH HALVES, ALWAYS. "You cannot send" without "everything they send still
     * arrives" reads as a dead line and is the reason somebody cancels instead;
     * the reassuring half alone lets somebody plan a winter around a product
     * they think is answering their customers, and find out otherwise from a
     * customer.
     *
     * Asserted on the sentences a person reads rather than on a constant, so
     * copy that quietly drops a clause fails here.
     */
    @Test
    fun `every pause surface says what stops and what does not`() {
        val surfaces = listOf(
            "the offer" to pauseOfferCopy(offered())!!.body,
            "the confirmation" to pauseOfferCopy(offered())!!.confirmBody,
            "the paused state" to pausedStateCopy(
                PauseState(paused_at = "2026-01-15T09:00:00Z", monthly_cents = 500L),
                "Pro",
            )!!.body,
        )
        surfaces.forEach { (where, body) ->
            val lower = body.lowercase()
            listOf(
                "can't send" to "that sending stops — runPreSendGates answers 402",
                "take calls" to "that the phone does not ring, in or out",
                "still arrives" to "that inbound texts are never lost",
                "held" to "that scheduled sends are held rather than dropped",
                "number" to "that the number is kept",
                "message history" to "that the history is untouched",
            ).forEach { (clause, why) ->
                assertTrue(
                    "$where does not say $why: $body",
                    lower.contains(clause),
                )
            }
        }
    }

    /**
     * The 30-day fuse is the whole contrast, and it is the one figure on this
     * card that is NOT the API's — it is [CANCELLATION_GRACE_DAYS], the constant
     * the release job runs on.
     *
     * The anchor comes with it for the reason the cancel card's own guard gives:
     * "we hold your number for 30 days" invites the reader to count from the end
     * of their billing period and land on about twice the real window.
     */
    @Test
    fun `the offer contrasts the clock cancelling starts, and names its first day`() {
        val body = pauseOfferCopy(offered())!!.body
        assertTrue(
            "the offer must name the clock it is an alternative to: $body",
            body.contains("$CANCELLATION_GRACE_DAYS-day"),
        )
        assertTrue(
            "and the day that clock starts on, or the reader counts from the end of " +
                "their billing period instead: $body",
            Regex("from the day you cancel").containsMatchIn(body),
        )
        assertTrue(
            "and it must say the pause starts no such clock, which is the offer: $body",
            body.contains("no clock at all"),
        )
    }

    /**
     * A pause has no term. Copy naming one — "for the winter", "for three
     * months" — is a promise the swap does not make: it holds until somebody
     * presses Resume, and it bills every month until they do.
     */
    @Test
    fun `the confirmation says the charge repeats and that it can be undone`() {
        val confirm = pauseOfferCopy(offered())!!.confirmBody.lowercase()
        assertTrue(
            "a recurring charge has to be described as recurring: $confirm",
            confirm.contains("every month"),
        )
        assertTrue(
            "and the way back has to be on the same screen as the charge: $confirm",
            confirm.contains("resume"),
        )
    }

    // -- the paused state -----------------------------------------------------

    /**
     * `paused_at` DECIDES, on its own. It is non-null exactly while the mirror
     * says the subscription carries the pause price — the same fact every send
     * gate reads — so this card and the composer cannot disagree about whether
     * a workspace can text.
     */
    @Test
    fun `the paused state is decided by paused_at and nothing else`() {
        assertNull(pausedStateCopy(null, "Pro"))
        assertNull(
            "eligible-to-pause is not paused",
            pausedStateCopy(offered(), "Pro"),
        )
        assertNotNull(
            "and being ineligible for a NEW pause is exactly what a paused " +
                "workspace looks like",
            pausedStateCopy(
                PauseState(
                    eligible = false,
                    reason = "already_paused",
                    paused_at = "2026-01-15T09:00:00Z",
                    monthly_cents = 500L,
                    resume_plan = "starter",
                ),
                "Starter",
            ),
        )
    }

    /**
     * `resume_plan` is what they come back to, and it is a real answer months
     * in because the pause never touches `companies.plan`. An unknown plan
     * string names the way back without it rather than printing "null" at
     * somebody.
     */
    @Test
    fun `the way back is named from resume_plan, and survives not knowing it`() {
        val paused = PauseState(
            paused_at = "2026-01-15T09:00:00Z",
            monthly_cents = 500L,
            resume_plan = "pro",
        )
        val known = pausedStateCopy(paused, "Pro")!!
        assertEquals("Resume Pro", known.resumeLabel)
        assertTrue(known.body.contains("Pro"))

        val unknown = pausedStateCopy(paused.copy(resume_plan = "enterprise"), null)!!
        assertEquals("Resume my plan", unknown.resumeLabel)
        listOf(unknown.heading, unknown.body, unknown.resumeLabel, unknown.confirmBody)
            .forEach { text ->
                assertFalse("a missing plan name must not be printed: $text", text.contains("null"))
            }
    }

    /**
     * Resuming bills the rest of the period back up to the plan price on the
     * spot (`create_prorations`). Somebody pressing Resume in March is spending
     * money, and a button that spends money without saying so is the same defect
     * as the pause price being absent.
     */
    @Test
    fun `resuming says what it costs before it is pressed`() {
        val copy = pausedStateCopy(
            PauseState(paused_at = "2026-01-15T09:00:00Z", monthly_cents = 500L),
            "Pro",
        )!!
        assertTrue(copy.confirmBody.contains("rest of this billing period"))
        assertTrue(copy.confirmBody.contains("Pro price"))
    }

    // -- the roster, which is not this file's to rewrite ----------------------

    /**
     * `workspace_paused` was already in all three clients' scheduled-send
     * rosters before this screen existed. A second sentence about held messages
     * written here would be the drift that roster exists to prevent — one
     * product with two vocabularies for one state.
     */
    @Test
    fun `the held-message sentence is the roster's, not a second copy`() {
        assertTrue(
            ScheduledSend.HOLD_REASONS.containsKey("workspace_paused"),
        )
        assertTrue(
            "a pause is the most recoverable state in the product — marked terminal " +
                "it would quietly destroy a workspace's scheduled work",
            ScheduledSend.reasonRecovers("workspace_paused"),
        )
        val roster = ScheduledSend.HOLD_REASONS.getValue("workspace_paused")
        listOf(billingSection, "features/settings/SettingsLogic.kt").forEach { file ->
            assertFalse(
                "$file restates the roster's own sentence. Read it from " +
                    "ScheduledSend.HOLD_REASONS instead",
                spokenCopy(readMainSource(file)).contains(roster),
            )
        }
    }

    // -- THE CONSTRAINT THAT OUTRANKS EVERYTHING ------------------------------

    /**
     * ONE ACTION TO STRIPE, STILL.
     *
     * The set of things that render between landing on the billing screen and
     * the card with the exit on it. A pause card of its own would be new content
     * above the button that leaves, which is exactly the regression that was
     * shipped and called fine last time — so the paused state rides on the plan
     * card that was already there, and the offer renders BELOW the exit.
     *
     * A LIST, NOT A SET, and that is this round's fix rather than a style
     * preference. Compared as a set, the guard asked only WHICH names appear
     * above the exit — so a verifier inserted a real regression using nothing
     * but names already on the list (a second `SettingsCard` wrapping the plan,
     * an extra `PortalButton`) and the set was unchanged. Order and count are
     * the properties that actually describe "nothing new got added here".
     *
     * The names are still named rather than counted, so a failure message says
     * which thing appeared and where.
     */
    @Test
    fun `the pause adds nothing above the button that leaves`() {
        val section = composable("BillingSection")
        val exit = section.indexOf("CancelCard(")
        assertTrue("the billing screen must still carry the cancel card", exit > 0)

        val above = Regex("(?m)^\\s+([A-Z][A-Za-z]*)\\(")
            .findAll(section.substring(0, exit))
            .map { it.groupValues[1] }
            .toList()
        assertEquals(
            "something new renders above the way out. Reaching Stripe having " +
                "answered nothing is ONE action from landing on this screen, and " +
                "every card added here is height between a thumb and that button. " +
                "The paused state belongs on the plan card, and the offer belongs " +
                "under the exit",
            listOf(
                // Renders nothing — it is the pause read itself, which is why it
                // is allowed to be here at all.
                "LaunchedEffect",
                "StatusNotices",
                "MissedWhileOffNote",
                "OffRampCard",
                "PlanCard",
                "ModulesCard",
                "SettingsCard",
                "PortalButton",
            ),
            above,
        )

        // And nothing above the exit may be a thing that has to be OPENED. The
        // list above cannot see this: a trigger is a press, and the shape that
        // took cancelling from one tap to two last time was a collapse, not a
        // new card. `CancellationFlowTest` pins the same words inside the cancel
        // card itself; this is the stretch of screen above it.
        val code = withoutComments(section.substring(0, exit))
        listOf(
            "AlertDialog",
            "ModalBottomSheet",
            "AnimatedVisibility",
            "expanded",
            "showSheet",
            "collapsed",
        ).forEach { trigger ->
            assertFalse(
                "`$trigger` renders above the way out. Anything that has to be " +
                    "opened first is a press, and the one press somebody has is the " +
                    "one that reaches Stripe",
                code.contains(trigger),
            )
        }
    }

    /**
     * The exit does not wait on the pause read, and cannot be disabled by it.
     *
     * The read is a network round trip through Stripe. If the way out were
     * gated on it, a slow or dead billing route would become a person who
     * cannot cancel — the exact failure the whole cancel screen is built
     * against, re-created by a feature meant to be an alternative to leaving.
     *
     * THREE NAMED MECHANISMS, WHICH IS THE LIMIT OF WHAT THIS CAN BE (#524). A
     * disabled control, a read of its own, a dialog in the body: each is a real
     * shape and each stays pinned here. But `Modifier.height(0.dp)` on the
     * button is none of the three, and neither is a `return` above the card's
     * body, and neither was caught. The property that catches all of them and
     * the ones nobody has invented yet lives in [ExitPath], asserted next door
     * in [CancellationFlowTest]: nothing on the path to the exit may name the
     * pause read at all.
     */
    @Test
    fun `the way out is never gated on the pause`() {
        val card = composable("CancelCard")
        Regex("enabled\\s*=\\s*([^,\n]*)").findAll(card).forEach { match ->
            val expression = match.groupValues[1]
            assertFalse(
                "a control on the cancel card is gated on the pause ($expression). " +
                    "Only the request already in flight may disable anything here",
                expression.contains("pause") || expression.contains("Pause"),
            )
        }
        assertFalse(
            "the cancel card must not fetch the pause itself: the read would then " +
                "sit between the card opening and the exit",
            card.contains("pauseState("),
        )
        assertFalse(
            "and it must not host the pause dialog — a confirmation in this card's " +
                "body is the friction the cancel rule forbids",
            card.contains("ConfirmDialog"),
        )
    }

    /**
     * The offer is an ANSWER, below the button, in the same paragraph position
     * every other answer uses. Above it, choosing "quiet season" would push the
     * way out further down the screen the moment the radio was tapped.
     */
    @Test
    fun `the pause offer renders under the exit, inside the note`() {
        val card = composable("CancelCard")
        val note = card.indexOf("CancellationOfferNote(")
        val confirm = card.indexOf(ExitPath.EXIT_KEY)
        assertTrue(note > confirm)

        val body = composable("CancellationOfferNote")
        assertTrue(
            "the offer must come from the API's answer, not from a local guess. " +
                "[PauseRead.answer] is null for a read that has not landed and for " +
                "one that failed, which is the whole point of asking it for the " +
                "answer rather than for the state",
            body.contains("pauseOfferCopy(pause.answer)"),
        )
        assertFalse(
            "eligibility must never be READ here, let alone re-derived: the route " +
                "folds eight gates and a live price lookup into one boolean, and " +
                "[pauseOfferCopy] is the only thing that may consult it",
            body.contains(".eligible"),
        )
        assertTrue(
            "and the control renders only when there is an offer to render",
            body.contains("if (pauseAnswer != null)"),
        )
    }

    /**
     * TOLD FROM THE RESPONSE, NEVER FROM THE PRESS.
     *
     * Both routes re-read the database mirror after the Stripe swap and answer
     * 409 when it disagrees — a replayed pause returns a cached Stripe response
     * with no swap performed, and everything after it still succeeds. A client
     * that stamped its own `paused_at` on a 200 would tell somebody they had
     * paused while they are still being billed the full plan price and can still
     * send.
     */
    @Test
    fun `the pause and the resume are told from the API's re-read`() {
        val note = composable("CancellationOfferNote")
        assertTrue(note.contains("scope.repo.pausePlan("))
        assertTrue(
            "the state that lands on screen must be built from the response",
            note.contains("settled.paused_at"),
        )
        assertFalse(
            "a locally minted timestamp is a pause this device believes in and the " +
                "database does not",
            note.contains("Instant.now()"),
        )

        val resumed = composable("PausedPlanNote")
        assertTrue(resumed.contains("scope.repo.resumePlan("))
        assertTrue(resumed.contains("settled.paused_at"))
        assertFalse(
            "resume must not assert its own null either — the route 409s when the " +
                "mirror still says paused, and that is the case worth seeing",
            resumed.contains("paused_at = null"),
        )
    }

    /**
     * The 409 sentences are written for the customer ("If you resumed earlier
     * today, try again tomorrow — you won't be charged twice for pausing") and
     * carry the one instruction that resolves the state. Replacing them with
     * "Something went wrong" throws away the only useful part.
     *
     * READS THE CATCH BLOCK, which is this round's fix. The old version asked
     * whether the string `cause.userMessage()` appeared ANYWHERE in the
     * composable, so it could not see what else the failure path did — a
     * verifier moved `showMessage("Paused. Your number and your history are
     * safe.")` INTO the catch and the guard stayed green, which is a 409 that
     * congratulates somebody on a pause that did not happen.
     *
     * So the block itself is read, and it has to be three things: an assignment
     * of the API's own sentence, no words of our own (no string literal at all
     * lives in a correct one), and nothing announced to the customer from
     * inside it. The confirmation belongs on the success path, and the last
     * assertion pins it there.
     */
    @Test
    fun `a refusal shows the sentence the API wrote, and says nothing else`() {
        listOf("CancellationOfferNote", "PausedPlanNote").forEach { name ->
            val body = composable(name)
            val blocks = catchBlocks(body)
            assertEquals("$name must handle exactly one failure", 1, blocks.size)
            val caught = blocks.single()

            assertTrue(
                "$name must surface the API's own message, by assigning it to the " +
                    "state the dialog renders: `$caught`",
                // `\(` rather than `\(\)`. The empty parens made this refuse an
                // ARGUMENT, and #228 needs one: the wiring pass left both catch
                // blocks in BillingSection English rather than turn this red,
                // which is a guard quietly dictating what language a refusal is
                // written in. What it exists to assert is that the API's own
                // sentence is ASSIGNED to the state the dialog renders, and that
                // survives a locale being threaded through.
                Regex("=\\s*cause\\.userMessage\\(").containsMatchIn(caught),
            )
            assertFalse(
                "$name writes copy of its own in the failure path: `$caught`. The " +
                    "409 sentence carries the one instruction that resolves the " +
                    "state, and anything written here is instead of it",
                caught.contains("\""),
            )
            assertFalse(
                "$name tells the customer something from inside the catch: " +
                    "`$caught`. Every showMessage on these two paths is a " +
                    "confirmation, and a confirmation fired on a failure is the " +
                    "screen saying a pause happened when the API said it did not",
                caught.contains("showMessage("),
            )

            val confirmation = body.indexOf("showMessage(")
            val failure = body.indexOf("catch (cause")
            assertTrue("$name must still confirm what happened on success", confirmation > 0)
            assertTrue(
                "$name's confirmation is not on the success path",
                confirmation < failure,
            )
        }
    }

    /**
     * A paused workspace is refused a plan change by POST /v1/billing/change-plan
     * on purpose — "resume it first, then switch plans" — so a switch control
     * drawn here would be a button whose only possible outcome is an error.
     *
     * AND SO WOULD ONE DRAWN BEFORE THE READ LANDS. The gate used to be
     * `paused == null`, which is true of a workspace we have not asked about and
     * of one whose read failed — the same nullable standing in for three
     * different facts that put a green Active pill over a paused plan. Every
     * claim on this card is positive now: [PauseRead.isRunning], which only an
     * answer can make true.
     */
    @Test
    fun `the plan card offers no control the pause would make fail`() {
        // Comments off: this docblock and the card's own explain the shape they
        // forbid by writing it out, so a scan that read them would fail on its
        // own footnotes.
        val card = withoutComments(composable("PlanCard"))
        assertTrue(
            "the paused state must be decided by the shared copy function",
            card.contains("pausedStateCopy("),
        )
        assertFalse(
            "`paused == null` is true of a read that has not landed and of one that " +
                "failed. It cannot gate anything that claims the plan is running",
            card.contains("paused == null"),
        )
        assertTrue(
            "the plan switch must be gated on the read having ANSWERED",
            Regex("if \\(canManage && company\\.subscriptionActive && running\\)")
                .containsMatchIn(card),
        )
        assertTrue(
            "and `running` must be the read's own answer rather than a local guess",
            card.contains("val running = pause.isRunning"),
        )
    }

    /**
     * ...AND NEITHER DOES THE SECOND SWITCH, AN INCH BELOW THE FIRST.
     *
     * [cancellationOffer] takes a `paused: Boolean`, and a boolean has no way to
     * say "nobody has asked yet" — so an unread pause arrives there as `false`,
     * and the `too_expensive` answer comes back carrying the plan switch. That
     * is the plan card's whole defect re-created under the cancel button: the
     * card above gates its switcher on [PauseRead.isRunning] and this one, drawn
     * from the same read on the same screen, would not.
     *
     * So the WORDS come from the flag and the CONTROL comes from the read.
     * Exercised as a function first, because that is where it can be broken.
     */
    @Test
    fun `the answer's own plan switch waits for the read, exactly as the card does`() {
        val running = PauseRead.Answered(offered())
        val paused = PauseRead.Answered(
            PauseState(paused_at = "2026-01-15T09:00:00Z", monthly_cents = pausedCents),
        )

        listOf<PauseRead>(PauseRead.Unasked, PauseRead.Loading, PauseRead.Failed, paused)
            .forEach { read ->
                assertFalse(
                    "$read draws the plan switch under the cancel button. POST " +
                        "/v1/billing/change-plan 409s a paused workspace, and a read " +
                        "that has not landed cannot know this one is not paused",
                    mayDrawOfferControl(CancellationOfferAction.ChangePlan, read),
                )
            }
        assertTrue(
            "an answered, running plan really can be switched — otherwise this gate " +
                "closes a control that has nothing wrong with it",
            mayDrawOfferControl(CancellationOfferAction.ChangePlan, running),
        )

        // Help and coming back are not the pause's to refuse: one opens a screen
        // no billing state gates, and the other belongs to a cancelled
        // subscription, which has no live pause to read.
        listOf(
            CancellationOfferAction.OpenHelp,
            CancellationOfferAction.ResubscribeStarter,
            null,
        ).forEach { action ->
            listOf<PauseRead>(PauseRead.Unasked, PauseRead.Loading, PauseRead.Failed, paused)
                .forEach { read ->
                    assertTrue(
                        "$action withheld on $read — the pause refuses the plan " +
                            "change and nothing else, and a gate wider than the API's " +
                            "is a control removed for a reason we invented",
                        mayDrawOfferControl(action, read),
                    )
                }
        }
    }

    /**
     * ...and the note is wired to both halves of that: the ANSWER is told the
     * fact, and the CONTROL is told the read.
     *
     * Two assertions because they fail separately. Without the first, a paused
     * workspace reads the unpaused seasonal paragraph — "a quiet season longer
     * than that outruns the hold" — twelve lines under a card saying the pause
     * starts no clock at all. Without the second, the load window draws the
     * button anyway.
     */
    @Test
    fun `the note tells the answer the fact and the control the read`() {
        val note = withoutComments(composable("CancellationOfferNote"))
        assertTrue(
            "the answer must be told whether this workspace is paused, from the " +
                "read's own answer: `isPaused` is true only on an ANSWERED read",
            note.contains("paused = pause.isPaused"),
        )
        assertFalse(
            "`pause.answer?.paused_at != null` and friends re-derive what [PauseRead] " +
                "already decided, and the version of that expression this screen " +
                "shipped treated an unanswered read as `not paused`",
            note.contains("paused_at != null"),
        )
        assertTrue(
            "the control must be gated on the read rather than drawn from the " +
                "answer's action directly",
            note.contains("mayDrawOfferControl("),
        )
        assertFalse(
            "switching on `offer?.action` draws whatever the flag produced, which " +
                "for an unread pause is the switch the API refuses",
            note.contains("when (offer?.action)"),
        )
        assertFalse(
            "nothing on this note is ever greyed. A withheld control is ABSENT — a " +
                "disabled button under the cancel button is the friction this whole " +
                "screen is built against, and it invites a press that cannot work",
            Regex("enabled\\s*=").containsMatchIn(note),
        )
    }

    /**
     * THE PILL, WHICH IS THE CLAIM THIS SCREEN GOT WRONG.
     *
     * A green `Active` beside `Pro · $79/mo` on a workspace paying a holding fee
     * and unable to send was what a failed read produced, and what every reader
     * saw for the length of the load window. The decision now lives in
     * [planBadge], where it is exercised as a function above; this is the wiring
     * that says the card asks it rather than deciding for itself.
     */
    @Test
    fun `the pill is drawn from the read, in one place`() {
        val card = withoutComments(composable("PlanCard"))
        assertTrue(
            "the pill must come from the shared decision",
            card.contains("planBadge(pause, company.subscriptionActive"),
        )
        // #228: the word itself is in `SettingsStrings` now, so the thing that
        // may appear exactly once on this card is the KEY that fetches it. The
        // property is unchanged and so is what it prevents — a card that can
        // call a plan Active from anywhere other than the branch [planBadge]
        // handed it.
        val branch = card.indexOf("PlanBadge.Active ->")
        val label = card.indexOf("\"settings.planPillActive\"")
        assertTrue("the card must still badge a running plan", branch > 0)
        assertEquals(
            "`Active` is written more than once on this card. The word may exist " +
                "only in the branch [planBadge] hands it",
            1,
            Regex("\"settings\\.planPillActive\"").findAll(card).count(),
        )
        assertTrue(
            "`Active` is rendered somewhere other than the branch that earned it",
            label > branch && label - branch < 60,
        )
    }

    /**
     * The add-ons card sells things, and enabling one invoices IMMEDIATELY
     * (`always_invoice`). Offered on a paused workspace it charges an owner on
     * the spot for the voice module on a line that cannot dial — and the API
     * refuses it, so the control's only outcome is a refusal with a charge
     * attempted in front of it.
     *
     * `isRunning`, not `!isPaused`: an unanswered read is not permission to sell
     * somebody something.
     */
    @Test
    fun `the add-ons card is not offered while paused, or before we know`() {
        val section = withoutComments(composable("BillingSection"))
        val call = section.indexOf("ModulesCard(scope)")
        assertTrue("the billing screen must still carry the add-ons card", call > 0)
        val gate = section.lastIndexOf("if (", call)
        assertTrue("the add-ons card must still be behind a gate", gate in 1 until call)
        val condition = section.substring(gate, call)

        assertTrue(
            "the add-ons card is offered to a workspace whose pause we have not " +
                "read: `${condition.trim()}`",
            condition.contains("pause.isRunning"),
        )
        assertFalse(
            "`!pause.isPaused` is true of a read that has not landed and of one " +
                "that failed, which is exactly the window a paused owner would be " +
                "charged in",
            condition.contains("!pause.isPaused"),
        )
    }

    // -- helpers --------------------------------------------------------------

    /**
     * A function's source, from its signature to its closing brace at column 0.
     *
     * Matches `fun NAME(` rather than `private fun NAME(` so the section itself,
     * which is public, can be read the same way as the private cards inside it.
     */
    private fun composable(name: String): String {
        val src = readMainSource(billingSection)
        val start = src.indexOf("fun $name(")
        if (start < 0) fail("$name not found in $billingSection")
        val end = src.indexOf("\n}\n", start)
        if (end < 0) fail("$name has no closing brace at column 0")
        return src.substring(start, end)
    }

    /**
     * Only what a person can READ: every double-quoted literal, with comments
     * dropped first.
     *
     * Comments quote old copy in order to explain why it went, and identifiers
     * carry the words of whatever they are wiring — a guard reading either would
     * fail on correct code, and the version that gets softened until it stops
     * doing that is a guard that catches nothing.
     */
    private fun spokenCopy(source: String): String {
        val out = StringBuilder()
        var inString = false
        var inLineComment = false
        var inBlockComment = false
        var i = 0
        while (i < source.length) {
            val ch = source[i]
            when {
                inLineComment -> if (ch == '\n') inLineComment = false
                inBlockComment ->
                    if (ch == '*' && i + 1 < source.length && source[i + 1] == '/') {
                        inBlockComment = false
                        i++
                    }

                inString -> {
                    if (ch == '\\') i++ else if (ch == '"') inString = false else out.append(ch)
                }

                ch == '/' && i + 1 < source.length && source[i + 1] == '/' -> inLineComment = true
                ch == '/' && i + 1 < source.length && source[i + 1] == '*' -> inBlockComment = true
                ch == '"' -> inString = true
            }
            i++
        }
        return out.toString()
    }

    /**
     * Source with comments stripped and everything else — code AND copy — left
     * where it was.
     *
     * The difference from [spokenCopy] is that this keeps the wiring, which is
     * what a guard about call sites has to read. Comments have to go for the
     * usual reason: they quote the shape they are warning against in order to
     * explain it, so a scan that reads them fails on its own footnotes.
     */
    private fun withoutComments(source: String): String {
        val out = StringBuilder(source.length)
        var inString = false
        var inLineComment = false
        var inBlockComment = false
        var i = 0
        while (i < source.length) {
            val ch = source[i]
            when {
                inLineComment -> if (ch == '\n') {
                    inLineComment = false
                    out.append(ch)
                }

                inBlockComment ->
                    if (ch == '*' && i + 1 < source.length && source[i + 1] == '/') {
                        inBlockComment = false
                        i++
                    }

                inString -> {
                    out.append(ch)
                    if (ch == '\\' && i + 1 < source.length) {
                        out.append(source[i + 1])
                        i++
                    } else if (ch == '"') {
                        inString = false
                    }
                }

                ch == '/' && i + 1 < source.length && source[i + 1] == '/' -> inLineComment = true
                ch == '/' && i + 1 < source.length && source[i + 1] == '*' -> inBlockComment = true
                else -> {
                    out.append(ch)
                    if (ch == '"') inString = true
                }
            }
            i++
        }
        return out.toString()
    }

    /**
     * The body of every `catch (…) { … }` in a function, comments removed.
     *
     * Braces are matched rather than scanned for, because a failure path with a
     * `runCatching` or a `let` in it would otherwise end at the wrong `}` and
     * the guard would read half a block. String contents are stepped over so a
     * `{` inside copy does not look like a block that opened — which is exactly
     * the copy this is looking for.
     */
    private fun catchBlocks(source: String): List<String> {
        val src = withoutComments(source)
        val blocks = mutableListOf<String>()
        Regex("catch\\s*\\(").findAll(src).forEach { match ->
            val open = src.indexOf('{', match.range.last)
            if (open < 0) fail("a catch with no block in the source under test")
            var depth = 0
            var inString = false
            var i = open
            while (i < src.length) {
                val ch = src[i]
                if (inString) {
                    if (ch == '\\') i++ else if (ch == '"') inString = false
                } else {
                    when (ch) {
                        '"' -> inString = true
                        '{' -> depth++
                        '}' -> {
                            depth--
                            if (depth == 0) {
                                blocks.add(src.substring(open + 1, i).trim())
                                i = src.length
                            }
                        }
                    }
                }
                i++
            }
        }
        return blocks
    }

    private fun mainRoot(): File {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )
        for (base in bases) {
            val dir = File(base)
            if (dir.exists()) return dir
        }
        fail("main source root not found (cwd=${File(".").absolutePath})")
        error("unreachable")
    }

    private fun readMainSource(relative: String): String {
        val f = File(mainRoot(), relative)
        if (!f.exists()) fail("source not found: $relative")
        return f.readText()
    }
}
