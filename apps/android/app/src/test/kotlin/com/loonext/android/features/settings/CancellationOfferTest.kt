package com.loonext.android.features.settings

import com.loonext.android.core.i18n.AppStrings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.time.Instant

/**
 * #277 follow-up — the answer to the reason somebody gave, and the two places
 * it is allowed to appear.
 *
 * THREE HALVES, and each catches a failure the other two cannot see.
 *
 * The first pins the COPY: that each sentence SAYS the figure, and says it in
 * agreement with itself. `assertEquals(3, STARTER_SEATS)` passes on copy that
 * never mentions a seat, and `contains("business number")` passes on "1
 * business numbers", so the assertions here are on the exact string a person
 * reads. What this half cannot do is notice a repricing: `$29` in the assertion
 * and `2900` in [PLAN_PRICE_CENTS] are two Kotlin literals a few hundred lines
 * apart, and moving one without the other is caught by the compiler in neither
 * direction. That is the second half's job.
 *
 * The second is the CROSS-LANGUAGE half, and it is the only part of this file
 * that can fail because of a change made in TypeScript. These sentences are
 * hand-ported from `packages/shared/src/cancellation-offers.ts`; the port has
 * no compiler between it and being wrong, and money is the thing it is
 * expensive to be wrong about. So `pins the shared price book…` and the two
 * beside it READ the TypeScript and compare it against the Kotlin — which is a
 * real drift detector, where an assertion written in Kotlin against a Kotlin
 * literal is only a spelling check.
 *
 * The third pins the WIRING, in the [CancellationFlowTest] idiom, because the
 * constraint that outranks everything on this screen is a layout property: the
 * offer must not add an action, a scroll past the button, or a disabled state
 * to leaving. A unit test cannot render a composable here; a source scan can
 * say where the offer sits relative to the exit, which is the whole of it.
 *
 * SOME GUARDS READ THE COMPOSABLE AND NOT ONLY THE MODULE, and that is
 * deliberate rather than belt-and-braces. `BillingSection.kt` writes
 * cancellation copy of its own — the consequence line on the cancel card, the
 * scheduled-cancel notice, the hold sentence on the canceled card — and every
 * one of those is read by the same person, in the same minute, as the module's
 * answer. A property asserted over [everyOffer] alone was satisfied while the
 * composable twenty dp below contradicted it in as many words.
 */
class CancellationOfferTest {

    private val billingSection = "features/settings/BillingSection.kt"
    private val models = "features/settings/SettingsModels.kt"

    // -- what we refuse to say -----------------------------------------------

    /**
     * THE guard for this feature, and the one #277 named in advance.
     *
     * There is no plan below Starter. An offer here would have to invent one,
     * and inventing a cheaper plan for somebody who has just said the price is
     * too high is the exact dishonesty the issue forbids. Null in both phases
     * and on a null plan, which is a workspace that never checked out.
     */
    @Test
    fun `a workspace already on Starter is offered no cheaper plan`() {
        assertNull(cancellationOffer("too_expensive", "starter"))
        assertNull(
            cancellationOffer("too_expensive", "starter", CancellationOfferPhase.Grace),
        )
        assertNull(cancellationOffer("too_expensive", null))
        assertNull(cancellationOffer("too_expensive", null, CancellationOfferPhase.Grace))
        // And Pro really is answered, so the assertions above are about the
        // Starter guard rather than about the whole branch being dead.
        assertNotNull(cancellationOffer("too_expensive", "pro"))
    }

    /**
     * Three of the six reasons answer NOTHING, always, and null is a real
     * answer rather than copy nobody has written yet: we do not know what
     * somebody switched to, and "not using it" is already served by the export
     * and the exit that are on the card. A client must never substitute copy.
     */
    @Test
    fun `switched, not using and something else are answered with silence`() {
        listOf("switched", "not_using", "other").forEach { reason ->
            CancellationOfferPhase.entries.forEach { phase ->
                listOf(null, "starter", "pro").forEach { plan ->
                    assertNull(
                        "$reason on $plan in $phase must render nothing",
                        cancellationOffer(reason, plan, phase),
                    )
                }
            }
        }
    }

    /**
     * A code from a newer build, or none at all, renders nothing. Guessing at
     * an unrecognised reason is how a workspace gets answered about something
     * it never said.
     */
    @Test
    fun `an absent or unrecognised reason answers nothing`() {
        assertNull(cancellationOffer(null, "pro"))
        assertNull(cancellationOffer("", "pro"))
        assertNull(cancellationOffer("too-expensive", "pro"))
        assertNull(cancellationOffer("price", "pro"))
    }

    /**
     * A PAUSE IS NAMED ONLY TO A WORKSPACE THAT IS IN ONE.
     *
     * This guard used to be absolute — "there is no pause feature", the word
     * banned from every answer. #277 built one and this module was then told
     * about it, so the absolute form is now a fact about last quarter. A guard
     * pinning a literal that has since moved is a ceiling rather than a catch,
     * and the honest move is to say what is still true rather than to delete it.
     *
     * WHAT IS STILL TRUE, and it is the whole of the original worry:
     * [cancellationOffer] is a hand-port of a pure shared module. It is told the
     * FACT that a workspace is paused; it can never be told whether a pause is
     * AVAILABLE, because that is eight server-side gates and a live Stripe price
     * lookup per workspace (a prepaid year, a referral month, a pending plan
     * change, an unhealthy card, an unprovisioned price — any one of them says
     * no). So a pause named in an answer given to somebody who is NOT in one is
     * a promise made to every reader of that answer, including all the ones the
     * API would refuse: the exact "button that is not there" this guard was
     * written against, reached by a different route.
     *
     * THE POSITIVE HALF IS NOT DECORATION. Without it, an implementation that
     * simply never mentions a pause to anybody — which is the shipped defect,
     * the paused reader being handed the unpaused words — satisfies this test
     * completely. Silence must not be able to pass a guard about what is said.
     *
     * The screen's own pause copy is guarded in [PauseOfferTest], where it can
     * be checked against the thing that actually decides it.
     */
    @Test
    fun `a pause is named only to a workspace that is actually in one`() {
        val banned = listOf("paus", "freeze", "frozen", "suspend your", "put it on ice")

        everyCase().forEach { case ->
            val offer = case.offer ?: return@forEach
            val lower = "${offer.heading} ${offer.body}".lowercase()
            if (case.inPause) return@forEach
            banned.forEach { word ->
                assertFalse(
                    "\"$word\" in ${case.label} names a pause to a workspace that is " +
                        "not in one. This module is told whether a pause EXISTS for " +
                        "this workspace and can never be told whether one is on " +
                        "OFFER — that is GET /v1/billing/pause, and nowhere else",
                    lower.contains(word),
                )
            }
        }

        // And the two answers that ARE for a paused reader say so out loud, so
        // the sweep above is a rule about where the word may appear rather than
        // a ban satisfied by never writing it.
        listOf("seasonal", "too_expensive").forEach { reason ->
            val offer = cancellationOffer(reason, "pro", paused = true)!!
            assertTrue(
                "the $reason answer for a paused workspace must say the plan is " +
                    "paused: ${offer.heading} ${offer.body}",
                "${offer.heading} ${offer.body}".lowercase().contains("paused"),
            )
        }
    }

    /**
     * ...AND THE CARD THAT LEAVES STILL MAY NOT, above the button.
     *
     * [CancelCard]'s own copy is the consequence line, the question, the export
     * and the exit — all of it above the button that leaves, all of it rendered
     * unconditionally. A pause sentence written into any of it would be a
     * feature promise made to every reader of the cancel screen, including the
     * workspaces the API refuses, and it would sit in front of the exit rather
     * than under it.
     *
     * The pause belongs to [CancellationOfferNote], BELOW the button, gated on
     * the API's own `eligible`. That composable is deliberately not scanned
     * here; [PauseOfferTest] checks it against its gate instead.
     */
    @Test
    fun `the cancel card itself never mentions a pause above the exit`() {
        val banned = listOf("paus", "freeze", "frozen", "suspend your", "put it on ice")
        // The SENTENCES only. The card threads a `pause` parameter down to the
        // note below the button, so a scan of raw source would fail on the
        // wiring that puts the offer in the one place it is allowed to be.
        val card = spokenCopy(cancelCard()).lowercase()

        banned.forEach { word ->
            assertFalse(
                "\"$word\" in CancelCard sits above the button that leaves and is " +
                    "rendered for everybody. Whatever it promises has to move below " +
                    "the exit and behind the API's `eligible`",
                card.contains(word),
            )
        }
    }

    // -- money, which is the half that gets discovered by the customer --------

    /**
     * The prices are the price book's, in the currency the card is charged in.
     *
     * Asserted as the sentence somebody reads rather than as the constants, so
     * copy that quietly stops naming a price fails here. It does NOT catch a
     * repricing — both sides of this assertion are Kotlin literals. `pins the
     * shared price book against the TypeScript it was ported from` is the one
     * that does.
     */
    @Test
    fun `the price named is the one this workspace is actually charged`() {
        val usd = cancellationOffer("too_expensive", "pro", billingCurrency = "usd")!!
        assertTrue(
            "USD Pro must be told Starter is $29 rather than $79: ${usd.body}",
            usd.body.startsWith("Starter is \$29 a month instead of \$79,"),
        )
        val cad = cancellationOffer("too_expensive", "pro", billingCurrency = "cad")!!
        assertTrue(
            "CAD Pro must be told the CAD figures: ${cad.body}",
            cad.body.startsWith("Starter is \$39 a month instead of \$109,"),
        )
    }

    /**
     * DEFECT #328 ON THIS SCREEN: two prices, one card, one of them wrong.
     *
     * `api_create_company` sets `billing_currency` to 'cad' for every Canadian
     * workspace and the column is `not null default 'usd'`, so there is no null
     * case to fall back for. The plan card used to print the literal "$79/mo"
     * while the cancellation answer an inch below printed "$109" out of the
     * price book — both visible at once, to the one reader who knows which of
     * them matches their invoice.
     *
     * The plan card and the offer are asserted against each OTHER here rather
     * than against a literal, because agreeing with each other on the same
     * screen is the actual requirement.
     */
    @Test
    fun `the plan card quotes the same currency the cancellation answer does`() {
        val cadPro = planFacts("pro", billingCurrency = "cad", country = "CA")!!
        assertEquals("\$109/mo", cadPro.price)
        val cadStarter = planFacts("starter", billingCurrency = "cad", country = "CA")!!
        assertEquals("\$39/mo", cadStarter.price)

        val usdPro = planFacts("pro", billingCurrency = "usd", country = "US")!!
        assertEquals("\$79/mo", usdPro.price)

        // The stored currency beats the country here for the same reason it
        // does in the offer: `checkout-currency.ts` bills a Canadian workspace
        // in USD whenever the Stripe catalog cannot honour CAD.
        assertEquals(
            "\$79/mo",
            planFacts("pro", billingCurrency = "usd", country = "CA")!!.price,
        )
        assertEquals(
            "\$109/mo",
            planFacts("pro", billingCurrency = null, country = "CA")!!.price,
        )

        // And the two surfaces on the card agree. A Canadian owner reading
        // "Pro · $109/mo" must not then read "instead of $79" underneath it.
        listOf("usd" to "\$79", "cad" to "\$109").forEach { (currency, pro) ->
            val card = planFacts("pro", billingCurrency = currency, country = null)!!
            val answer = cancellationOffer(
                "too_expensive",
                "pro",
                billingCurrency = currency,
            )!!
            assertEquals("$pro/mo", card.price)
            assertTrue(
                "the plan card says ${card.price} and the answer below it says " +
                    "something else: ${answer.body}",
                answer.body.contains("instead of $pro,"),
            )
        }
    }

    /**
     * `checkout-currency.ts` bills a Canadian workspace in USD whenever the
     * Stripe catalog cannot honour CAD, so the country is NOT a stand-in for
     * the stored currency. Reading the country first would print a CAD price to
     * somebody whose card is charged in US dollars.
     */
    @Test
    fun `the stored currency beats the country, and the country is only a fallback`() {
        val grandfathered =
            cancellationOffer("too_expensive", "pro", billingCurrency = "usd", country = "CA")!!
        assertTrue(
            "a CA workspace billed in USD must read USD prices: ${grandfathered.body}",
            grandfathered.body.startsWith("Starter is \$29 a month instead of \$79,"),
        )
        val preCurrencyColumn =
            cancellationOffer("too_expensive", "pro", billingCurrency = null, country = "CA")!!
        assertTrue(
            "with no stored currency the country decides: ${preCurrencyColumn.body}",
            preCurrencyColumn.body.startsWith("Starter is \$39 a month instead of \$109,"),
        )
        // Anything we do not bill in is not a currency; fall back rather than
        // asking a map for a key it does not have.
        val nonsense =
            cancellationOffer("too_expensive", "pro", billingCurrency = "eur", country = "US")!!
        assertTrue(nonsense.body.startsWith("Starter is \$29 a month instead of \$79,"))
    }

    // -- the one half of this file TypeScript can break ----------------------

    /**
     * THE CROSS-LANGUAGE GUARD, and the only assertion here that a change made
     * in `packages/shared` can fail.
     *
     * Everything above compares a Kotlin literal against a Kotlin literal typed
     * in the same language a few hundred lines away, which catches a typo and
     * nothing else. A repricing lands in `billing-currency.ts`, and until this
     * existed it could ship to a customer through the web while these tests
     * stayed green and this client quoted last quarter's number at somebody
     * standing on the cancel screen because of the number.
     *
     * FAILS RATHER THAN SKIPS when the TypeScript cannot be found. A guard that
     * quietly passes because it could not locate its own input is worse than no
     * guard: it reads as protection in the file and provides none.
     */
    @Test
    fun `pins the shared price book against the TypeScript it was ported from`() {
        // Scoped to the price book's own block first. `usd: {` also opens
        // OVERAGE_CENTS_PER_SEGMENT further down the same file, and a guard
        // that read those four numbers instead would compare the wrong things
        // and say so in a message naming the right ones.
        val book = tsBlock(sharedSource("billing-currency.ts"), "export const PLAN_PRICE_CENTS")
        mapOf(BillingCurrency.USD to "usd: {", BillingCurrency.CAD to "cad: {")
            .forEach { (currency, marker) ->
                listOf("starter", "pro").forEach { plan ->
                    assertEquals(
                        "PLAN_PRICE_CENTS[$currency][$plan] has drifted from " +
                            "packages/shared/src/billing-currency.ts. The web has " +
                            "already repriced and this client has not",
                        tsNumber(book, marker, plan),
                        PLAN_PRICE_CENTS.getValue(currency).getValue(plan),
                    )
                }
            }
    }

    /**
     * The seat and number allowances, likewise — and these are not marketing
     * figures. POST /v1/billing/change-plan answers 409 over both, so a Kotlin
     * copy that drifts above the shared one describes a downgrade the server
     * refuses, in the sentence directly above the button that requests it.
     */
    @Test
    fun `pins the shared seat and number limits against the TypeScript`() {
        val ts = sharedSource("seats.ts")
        assertEquals(
            "STARTER_SEATS has drifted from PLAN_SEATS.starter in seats.ts",
            tsNumber(ts, "export const PLAN_SEATS", "starter"),
            STARTER_SEATS,
        )
        assertEquals(
            "PRO_SEATS has drifted from PLAN_SEATS.pro in seats.ts",
            tsNumber(ts, "export const PLAN_SEATS", "pro"),
            PRO_SEATS,
        )
        assertEquals(
            "STARTER_NUMBERS has drifted from PLAN_NUMBERS.starter in seats.ts",
            tsNumber(ts, "export const PLAN_NUMBERS", "starter"),
            STARTER_NUMBERS,
        )
        assertEquals(
            "PRO_NUMBERS has drifted from PLAN_NUMBERS.pro in seats.ts",
            tsNumber(ts, "export const PLAN_NUMBERS", "pro"),
            PRO_NUMBERS,
        )
    }

    /**
     * The hold length, from the module the release job derives its own from.
     *
     * `apps/api/src/billing/grace.ts` takes `GRACE_PERIOD_DAYS` from
     * `CANCELLATION_GRACE_DAYS`, so the TypeScript constant is what the cron
     * actually counts to. A Kotlin copy that says 30 while the job releases at
     * 14 prints a deadline two weeks after the number is gone.
     */
    @Test
    fun `pins the grace window against the constant the release job counts to`() {
        val ts = sharedSource("cancellation-offers.ts")
        val shared = Regex("CANCELLATION_GRACE_DAYS\\s*=\\s*(\\d+)").find(ts)
            ?.groupValues?.get(1)?.toInt()
        assertNotNull("CANCELLATION_GRACE_DAYS not found in cancellation-offers.ts", shared)
        assertEquals(
            "the hold this client prints is not the one the release job counts to",
            shared,
            CANCELLATION_GRACE_DAYS,
        )
    }

    @Test
    fun `whole dollars stay whole and the cents survive when there are any`() {
        assertEquals("\$29", formatMoney(2900, BillingCurrency.USD))
        assertEquals("\$109", formatMoney(10900, BillingCurrency.CAD))
        assertEquals("\$7.50", formatMoney(750, BillingCurrency.USD))
    }

    /**
     * The allowances named are the ones POST /v1/billing/change-plan actually
     * enforces on a downgrade, so the offer cannot describe a plan the server
     * will refuse to sell.
     *
     * Pinned as one exact phrase INCLUDING the pluralisation. A looser check
     * passes on "1 business numbers", which is a sentence nobody would write
     * deliberately and exactly what a `STARTER_NUMBERS` drift produces.
     *
     * THE PHASE IS SPELLED OUT rather than defaulted, because it is now
     * load-bearing: change-plan is the route that 409s over these, and it is
     * the only one. See the pair below.
     */
    @Test
    fun `the limits named are the ones the API will enforce`() {
        val offer =
            cancellationOffer("too_expensive", "pro", CancellationOfferPhase.Before)!!
        assertTrue(
            "the Starter allowances must be named exactly: ${offer.body}",
            offer.body.contains("It covers 3 people and 1 business number."),
        )
        assertFalse(
            "\"1 business numbers\" is what a plural that ignores the count reads like",
            offer.body.contains("business numbers"),
        )
        assertEquals(3, STARTER_SEATS)
        assertEquals(1, STARTER_NUMBERS)
    }

    /**
     * A FIGURE MAY ONLY BE PRINTED ON THE PATH THAT ENFORCES IT, and this is
     * the pair that defect produced.
     *
     * The grace action opens Stripe checkout, whose only gates are "one live
     * subscription" and the US registration draft — it counts neither members
     * nor numbers — and `checkout.session.completed` then un-suspends EVERY
     * suspended number with no plan filter. So a Pro workspace with two numbers
     * and eight members can press a button captioned "covers 3 people and 1
     * business number" and land on Starter holding two and eight.
     *
     * The button STAYS: change-plan 409s a canceled subscription outright
     * ("resubscribe to change plans"), so checkout is the only route back once
     * the subscription is dead, and removing the control would leave the
     * win-back with nothing to press at the one moment it is worth anything.
     * What was false was the figure. The price is still stated, because
     * checkout charges it.
     */
    @Test
    fun `no seat or number limit is named in the grace phase, where nothing applies one`() {
        val grace = cancellationOffer("too_expensive", "pro", CancellationOfferPhase.Grace)!!
        val copy = "${grace.heading} ${grace.body} ${grace.actionLabel}"
        assertFalse(
            "checkout counts no members, so a seat allowance may not be printed " +
                "beside the button that opens it: $copy",
            copy.contains("$STARTER_SEATS people"),
        )
        assertFalse(
            "and it counts no numbers either: $copy",
            copy.contains("business number"),
        )
        assertFalse(
            "nor any looser wording for the same promise: $copy",
            Regex("\\bseats?\\b|\\bcovers\\b", RegexOption.IGNORE_CASE).containsMatchIn(copy),
        )
        // The price still is: checkout charges it, so it is enforced there.
        assertTrue(grace.body.contains("\$29"))
        assertEquals(CancellationOfferAction.ResubscribeStarter, grace.action)
    }

    /**
     * "Your number and your message history stay exactly as they are" was true
     * for a workspace that fits Starter and false for exactly the one being
     * spoken to: change-plan answers 409 "Release your extra phone number
     * before downgrading to Starter". The history does survive, and is still
     * promised.
     */
    @Test
    fun `the downgrade answer does not promise the second number survives it`() {
        val body =
            cancellationOffer("too_expensive", "pro", CancellationOfferPhase.Before)!!.body
        assertFalse(
            "the second number is the one thing that does NOT stay as it is",
            body.contains("stay exactly as they are"),
        )
        assertTrue(body.contains("message history comes with you"))
        assertTrue(body.contains("a second number does not"))
        assertTrue(body.contains("refused until you release it"))
        assertTrue(body.contains("back inside $STARTER_SEATS seats"))
    }

    // -- the sentences that stop somebody planning around a false product ----

    /**
     * A cancelled workspace RECEIVES and cannot SEND — `runPreSendGates`
     * requires an active subscription and answers 402 otherwise. Omitting that
     * would let somebody plan a quiet season around a product they think is
     * answering their customers, and find out from a customer.
     */
    @Test
    fun `the seasonal answer says the line still receives and cannot reply`() {
        CancellationOfferPhase.entries.forEach { phase ->
            val offer = cancellationOffer("seasonal", "pro", phase)!!
            assertTrue(
                "$phase must say inbound still lands: ${offer.body}",
                offer.body.contains("receiving texts") || offer.body.contains("receiving texts,"),
            )
            assertTrue(
                "$phase must say they cannot reply: ${offer.body}",
                offer.body.contains("cannot reply"),
            )
        }
    }

    /**
     * THE ANCHOR IS THE CANCELLATION, NOT THE PERIOD END.
     *
     * `runGraceJob` measures `now - canceled_at`, and `startCancellationLifecycle`
     * stamps that column from Stripe's `canceled_at` — which, for a
     * `cancel_at_period_end` cancellation, is the time of the REQUEST rather
     * than the end of the period. The vendored `Subscriptions.d.ts` says so in
     * as many words. Somebody who cancels on day 2 of a monthly period and
     * reads "texting stops at the end of your billing period, and we hold your
     * number for 30 days" counts about 59 days and has about 30, and what they
     * lose at the end of the miscount is the number on their van.
     */
    @Test
    fun `the seasonal answer anchors the hold to the cancellation in both phases`() {
        CancellationOfferPhase.entries.forEach { phase ->
            val offer = cancellationOffer("seasonal", "pro", phase)!!
            val copy = "${offer.heading} ${offer.body}"
            assertTrue(
                "$phase must count the hold from the day they cancel: $copy",
                Regex("$CANCELLATION_GRACE_DAYS days .{0,20}from the day you cancel")
                    .containsMatchIn(copy),
            )
            // ...and denies the wrong anchor by name, because the wrong anchor
            // is the one the reader already has in their head from the
            // consequence line at the top of the same card.
            assertTrue(
                "$phase must say plainly which date it is NOT: $copy",
                copy.contains("not from the end of your"),
            )
        }
    }

    /**
     * THE HEADING MAY NOT COVER THE SEASON. It read "Your number is held while
     * you are gone", over a body that said 30 days, to a reader who had just
     * chosen "Quiet season, I'll be back". A trades quiet season is months, the
     * hold is 30 days, and the heading is the louder line.
     *
     * SCOPED TO THE UNPAUSED HEADING, DELIBERATELY. The ban exists because the
     * hold is 30 days and the heading promised more; a pause has no clock at
     * all, so "held for as long as you stay paused" is simply true for the
     * reader who gets it. Extending this over the paused heading would be the
     * guard outliving the fact that justified it — the ceiling this file's other
     * rewrite was about. The paused heading has its own guard below, and it is
     * the opposite property: it must say there is NO deadline.
     */
    @Test
    fun `the seasonal heading never promises cover for the whole absence`() {
        CancellationOfferPhase.entries.forEach { phase ->
            val heading = cancellationOffer("seasonal", "pro", phase)!!.heading.lowercase()
            assertFalse(
                "the heading promises the hold lasts as long as they are away, and " +
                    "the body says 30 days: `$heading`",
                Regex(
                    "while you are (gone|away|out)|until you (are back|return)|" +
                        "(whole|entire|all) (season|winter|year)|as long as",
                ).containsMatchIn(heading),
            )
        }
    }

    /**
     * The one fact a seasonal business needs and cannot get anywhere else: 30
     * days does not cover a winter, and #413 is what happens at the end of it.
     * Leaving it implied means the reader has to do the subtraction, and the
     * reader who does not is the one who loses the number.
     */
    @Test
    fun `the seasonal answer says a longer season outruns the hold`() {
        val body = cancellationOffer("seasonal", "pro", CancellationOfferPhase.Before)!!.body
        assertTrue(body.contains("longer than that outruns the hold"))
        assertTrue(body.contains("goes back to the phone company"))
    }

    /**
     * The fee promise is gated on the TIMESTAMP, not on the country: the $29
     * line is added at checkout only when `registration_fee_paid_at IS NULL`,
     * and the webhook stamps it once per company ever. A workspace that has not
     * paid it WILL be charged on return, so the sentence is simply absent for
     * them rather than softened into something reassuring and wrong.
     */
    @Test
    fun `the registration fee promise is made only to a workspace that paid it`() {
        val paid = cancellationOffer(
            "seasonal",
            "pro",
            registrationFeePaidAt = "2026-01-04T00:00:00Z",
        )!!
        assertTrue(paid.body.contains("already paid the one-time registration fee"))
        assertTrue(paid.body.contains("does not charge it again"))

        listOf(null, "", "   ").forEach { unpaid ->
            val offer = cancellationOffer("seasonal", "pro", registrationFeePaidAt = unpaid)!!
            assertFalse(
                "a workspace that has not paid the fee must be told nothing about it",
                offer.body.contains("registration fee"),
            )
        }
    }

    // -- the answers for a workspace that has already paused ------------------

    /**
     * THE 409 THIS SCREEN USED TO DRAW A BUTTON FOR.
     *
     * While paused, GET /v1/billing/pause answers `eligible: false,
     * already_paused`, so the pause offer is over and the cancel card falls
     * through to this module. A Pro workspace answering "too expensive" then got
     * `ChangePlan` and a "Switch to Starter" control — and POST
     * /v1/billing/change-plan refuses a paused workspace outright, in a sentence
     * it wrote for the customer: "Your plan is paused. Resume it first, then
     * switch plans." The plan card's own switch was gated on the pause; this
     * second one, an inch below it, was not.
     *
     * THE WORDS STAY AND THE BUTTON GOES. Returning null for the whole answer
     * was the wrong fix — somebody cancelling over $79 would then be told
     * nothing about the $29 plan they can have. What the API refuses is the
     * click, not the fact.
     */
    @Test
    fun `a paused workspace is told about Starter and offered no control for it`() {
        val offer = cancellationOffer("too_expensive", "pro", paused = true)!!

        assertNull(
            "the plan switch is refused while paused, so a control here is a button " +
                "whose only possible outcome is an error: ${offer.actionLabel}",
            offer.action,
        )
        assertNull(offer.actionLabel)
        assertFalse(
            "and the words on that control may not survive it either",
            "${offer.heading} ${offer.body}".contains("Switch to Starter"),
        )

        // The facts about the cheaper plan are still stated, because they are
        // still true — the price, the allowances, and what comes with them.
        assertTrue(offer.body.contains("Starter is \$29 a month instead of \$79,"))
        assertTrue(offer.body.contains("It covers 3 people and 1 business number."))
        // ...and the heading does not change, because it is a fact about the two
        // plans that a pause does not touch.
        assertEquals(
            cancellationOffer("too_expensive", "pro")!!.heading,
            offer.heading,
        )
    }

    /**
     * The order matters and it is the API's own. "Resume it first, then switch
     * plans" is what the 409 says, so somebody who goes and does it reads the
     * same sentence twice rather than a contradiction.
     *
     * NO RESUME ACTION EITHER, and that is not an oversight: Resume already sits
     * on the paused card at the top of this same screen. A second one down here
     * would be this module growing a control — the thing the header forbids.
     */
    @Test
    fun `the paused answer names the two steps in the order the API asks for them`() {
        val body = cancellationOffer("too_expensive", "pro", paused = true)!!.body
        assertTrue(
            "the answer must say the plan is paused, or the missing button reads as " +
                "a bug: $body",
            body.contains("Your plan is paused"),
        )
        assertTrue(
            "and it must name both steps, in the order change-plan asks for: $body",
            body.contains("resume first, then switch plans"),
        )
    }

    /**
     * THE PROPERTY, not the one example. `too_expensive` is the answer that
     * carries [CancellationOfferAction.ChangePlan] today, and a second reason
     * given that action later would re-create the same button in a place nobody
     * thought to re-check.
     *
     * Runs over every input this module takes, which is why the pause is an axis
     * of [everyCase] rather than a fixture in one test.
     */
    @Test
    fun `no answer names a control the product refuses in the state it answered for`() {
        everyCase().forEach { case ->
            val offer = case.offer ?: return@forEach
            if (!case.inPause) return@forEach
            assertFalse(
                "${case.label} returns ChangePlan to a paused workspace. POST " +
                    "/v1/billing/change-plan 409s while `companies.paused_at` is set, " +
                    "so this control's only possible outcome is that error",
                offer.action == CancellationOfferAction.ChangePlan,
            )
        }
        // The action still exists for the workspace it was written for, so the
        // sweep above is about the pause rather than about a dead enum.
        assertEquals(
            CancellationOfferAction.ChangePlan,
            cancellationOffer("too_expensive", "pro")!!.action,
        )
    }

    /**
     * THE TWO SENTENCES THAT WERE ON SCREEN TOGETHER.
     *
     * The unpaused seasonal answer ends "a quiet season longer than that outruns
     * the hold and the number goes back to the phone company". Twelve lines
     * above it, the paused card on the same screen says pausing starts no clock
     * at all. Both true of somebody deciding whether to cancel; the first is
     * simply FALSE for somebody who already paused instead, and it is the more
     * frightening of the two.
     */
    @Test
    fun `a paused workspace is not told the hold it is in is running out`() {
        val offer = cancellationOffer("seasonal", "pro", paused = true)!!
        val copy = "${offer.heading} ${offer.body}"

        assertFalse(
            "the pause has no fuse, so nothing may say this one is running down: $copy",
            copy.contains("outruns the hold"),
        )
        assertTrue(
            "and it must say so positively, because that is the fact the reader " +
                "cannot get anywhere else on this screen: $copy",
            copy.contains("no deadline") && copy.contains("nothing expires"),
        )
        assertTrue(
            "including that there is no date to be back by, which is the whole " +
                "difference from the 30-day hold: $copy",
            copy.contains("no date you have to be back by"),
        )
    }

    /**
     * ...AND THE DEADLINE IT DOES NAME BELONGS TO CANCELLING.
     *
     * The paused answer still prints [CANCELLATION_GRACE_DAYS], because that is
     * the trade it exists to describe: an open-ended hold for a 30-day one. What
     * it may never do is attach that number to the pause. The clock is measured
     * by `runGraceJob` as `now - canceled_at`, and a paused workspace has no
     * `canceled_at` — so there is genuinely nothing counting until they cancel.
     */
    @Test
    fun `every deadline the paused answer names is attached to cancelling`() {
        val offer = cancellationOffer("seasonal", "pro", paused = true)!!
        val copy = "${offer.heading} ${offer.body}"

        Regex("\\b$CANCELLATION_GRACE_DAYS days\\b").findAll(copy).forEach { hit ->
            val window = copy.substring(
                maxOf(0, hit.range.first - 60),
                minOf(copy.length, hit.range.last + 60),
            )
            assertTrue(
                "the paused answer counts days without saying they are the price of " +
                    "cancelling, so a reader takes them for a limit on the pause they " +
                    "are already in: `$window`",
                window.contains("Cancelling instead") || window.contains("starts a clock"),
            )
            assertTrue(
                "and the day that clock starts on comes with it: `$window`",
                window.contains("from the day you cancel"),
            )
        }
        assertTrue(
            "the trade has to be named at all, or the answer is only the reassuring " +
                "half: $copy",
            copy.contains("$CANCELLATION_GRACE_DAYS days"),
        )
    }

    /**
     * THE DEFAULT IS THE OLD BEHAVIOUR, BYTE FOR BYTE.
     *
     * Three clients hand-port these strings and their tests compare them, so a
     * caller that has not been taught about the pause has to read exactly what
     * it read before #277 — not something close to it. This is also the guard
     * that fails if the default is ever flipped to `true`, which is the single
     * edit that would hand every unpaused workspace the paused answers.
     */
    @Test
    fun `omitting the pause answers what this module answered before it existed`() {
        CANCELLATION_REASONS.forEach { reason ->
            CancellationOfferPhase.entries.forEach { phase ->
                listOf(null, "starter", "pro").forEach { plan ->
                    listOf(null, "2026-01-01T00:00:00Z").forEach { fee ->
                        assertEquals(
                            "omitting `paused` must answer exactly what `paused = " +
                                "false` answers, for ${reason.code} ($phase, $plan)",
                            cancellationOffer(
                                reason.code, plan, phase,
                                registrationFeePaidAt = fee, paused = false,
                            ),
                            cancellationOffer(
                                reason.code, plan, phase, registrationFeePaidAt = fee,
                            ),
                        )
                    }
                }
            }
        }
        // Named rather than implied, so the equality above cannot be satisfied
        // by both sides having moved together.
        val before = cancellationOffer("too_expensive", "pro")!!
        assertEquals(CancellationOfferAction.ChangePlan, before.action)
        assertEquals("Switch to Starter", before.actionLabel)
        assertTrue(
            cancellationOffer("seasonal", "pro")!!.body
                .contains("longer than that outruns the hold"),
        )
    }

    /**
     * A PAUSE FLAG IS STALE IN THE GRACE PHASE, so it is ignored there.
     *
     * `paused_at` outlives the subscription it belonged to: nothing clears it on
     * cancellation — the reconcile skips cancelled tenants, and
     * `claim_checkout_activation` clears it only on the way back in. So a
     * grace-phase caller reading a company row can hand this module a `true` for
     * a workspace whose pause died with its subscription and whose 30-day clock
     * is running right now. Honouring it would answer "nothing expires" to the
     * one reader for whom something is expiring, on a date the same card prints
     * two lines further down.
     */
    @Test
    fun `a stale pause flag is ignored in the grace phase, where the pause is over`() {
        listOf("seasonal", "too_expensive").forEach { reason ->
            assertEquals(
                "$reason in the grace phase must answer the cancelled workspace it " +
                    "is actually being read by, whatever `paused_at` still says",
                cancellationOffer(reason, "pro", CancellationOfferPhase.Grace),
                cancellationOffer(
                    reason, "pro", CancellationOfferPhase.Grace, paused = true,
                ),
            )
        }
        // And the grace answer still says the clock is running, which is the
        // sentence the stale flag would have replaced.
        val grace = cancellationOffer(
            "seasonal", "pro", CancellationOfferPhase.Grace, paused = true,
        )!!
        assertTrue(
            "the one reader whose number is genuinely on a clock must still be told " +
                "so: ${grace.body}",
            grace.body.contains("$CANCELLATION_GRACE_DAYS days from the day you cancelled"),
        )
    }

    /**
     * The support promise does not change because the plan is paused, for the
     * same reason it does not change between the two phases: it is a promise
     * about US answering, not about their subscription. Asserted as object
     * equality rather than clause by clause, because "identical" is the property.
     */
    @Test
    fun `the missing-feature answer is the same answer paused or not`() {
        CancellationOfferPhase.entries.forEach { phase ->
            assertEquals(
                cancellationOffer("missing_feature", "pro", phase),
                cancellationOffer("missing_feature", "pro", phase, paused = true),
            )
        }
    }

    /**
     * A pause invents nothing. There is still no plan below Starter, and a pause
     * still does not tell us what somebody switched to — so the answers that
     * were silence stay silence, which is the case a "the paused reader must be
     * answered somehow" instinct would quietly fill in.
     */
    @Test
    fun `a pause does not invent an answer for the reasons that have none`() {
        assertNull(
            "there is nothing below Starter, paused or not",
            cancellationOffer("too_expensive", "starter", paused = true),
        )
        assertNull(cancellationOffer("too_expensive", null, paused = true))
        listOf("switched", "not_using", "other").forEach { reason ->
            assertNull(
                "$reason must still render nothing for a paused workspace",
                cancellationOffer(reason, "pro", paused = true),
            )
        }
    }

    /**
     * THE PAUSED SENTENCES, PINNED AGAINST THE CATALOGUE THEY WERE PORTED FROM.
     *
     * This is the cross-language half applied to the new copy, and it is the
     * only thing standing between three hand-ported clients and three different
     * paragraphs about the same pause. The other pins in this file compare
     * NUMBERS; these compare the sentences, because that is what was ported.
     *
     * #228 MOVED THE SOURCE, not the guard's job. `cancellation-offers.ts` used
     * to hold these sentences and now names catalogue keys, so the English it
     * names lives in the web catalogue — which is the same vocabulary all three
     * clients look up. Reading the shared module for a sentence it no longer
     * contains is how this test went red on a correct change, and repointing it
     * is the fix rather than deleting it: this client still TYPES these
     * paragraphs out, so the drift it guards against is still available.
     *
     * When this client's cancel copy moves to keys too, this becomes a
     * catalogue-to-catalogue comparison and stops needing the normalisation
     * below at all.
     *
     * Compared after normalising the source's own seams — a string broken across
     * five lines with `+` between the pieces is one string at runtime, and a
     * guard reading raw source would see a sentence that ends mid-clause. The
     * two placeholders that survive into the text are resolved to the values
     * this client prints, which is exactly what makes a drift in either one fail
     * here.
     *
     * FAILS RATHER THAN SKIPS when the file cannot be read — [catalogueSource]
     * sees to that.
     */
    @Test
    fun `pins the paused sentences against the TypeScript they were ported from`() {
        val ts = catalogueCopy(catalogueSource())

        val seasonal = cancellationOffer("seasonal", "pro", paused = true)!!
        assertTrue(
            "the paused seasonal heading has drifted from the shared module: " +
                "`${seasonal.heading}`",
            ts.contains(seasonal.heading),
        )
        assertTrue(
            "the paused seasonal body has drifted from the shared module: " +
                "`${seasonal.body}`",
            ts.contains(seasonal.body),
        )

        // The fee sentence is shared by the paused and unpaused answers, and it
        // is a promise about money — so it is pinned as the difference the flag
        // makes rather than as a literal typed in twice.
        val withFee = cancellationOffer(
            "seasonal", "pro",
            registrationFeePaidAt = "2026-01-04T00:00:00Z", paused = true,
        )!!
        val fee = withFee.body.removePrefix(seasonal.body)
        assertTrue("the fee sentence must be appended, not folded in", fee.isNotBlank())
        assertTrue(
            "the registration-fee sentence has drifted from the shared module: `$fee`",
            ts.contains(fee),
        )

        // Both `too_expensive` bodies, split at the point they diverge: the
        // shared half is the price and the allowances, and each tail is the
        // answer's own. Pinning both is what says the paused branch was ADDED
        // rather than typed over the one that was already shipping.
        val running = cancellationOffer("too_expensive", "pro")!!.body
        val paused = cancellationOffer("too_expensive", "pro", paused = true)!!.body
        val shared = running.commonPrefixWith(paused)
        assertTrue(
            "the two answers must still open with the same price and allowances",
            shared.contains("\$29") && shared.contains("business number"),
        )
        listOf(
            "the unpaused" to running.removePrefix(shared),
            "the paused" to paused.removePrefix(shared),
        ).forEach { (which, tail) ->
            assertTrue("$which tail must not be empty", tail.isNotBlank())
            assertTrue(
                "$which too_expensive answer has drifted from the shared module: " +
                    "`$tail`",
                ts.contains(tail),
            )
        }
    }

    /**
     * The support promises are read from the one place that states them, so the
     * offer cannot promise something the help screen does not. A response time
     * typed in separately is a promise somebody made without knowing it.
     */
    @Test
    fun `the missing-feature answer quotes the support promises verbatim`() {
        val offer = cancellationOffer("missing_feature", "starter")!!
        assertTrue(offer.body.contains(SUPPORT_RESPONSE_TIME))
        assertTrue(offer.body.contains(SUPPORT_FIX_PROMISE))
        assertEquals(CancellationOfferAction.OpenHelp, offer.action)
        assertEquals("Get help", offer.actionLabel)
    }

    // -- the control each answer names ---------------------------------------

    /**
     * The action names a control the screen ALREADY HAS, and the two phases
     * name different ones: a live subscription can be switched, a cancelled one
     * can only be restarted. Naming the wrong one produces a button that cannot
     * do what it says.
     */
    @Test
    fun `each phase names a control that surface actually has`() {
        assertEquals(
            CancellationOfferAction.ChangePlan,
            cancellationOffer("too_expensive", "pro", CancellationOfferPhase.Before)!!.action,
        )
        assertEquals(
            "Switch to Starter",
            cancellationOffer("too_expensive", "pro", CancellationOfferPhase.Before)!!.actionLabel,
        )
        assertEquals(
            CancellationOfferAction.ResubscribeStarter,
            cancellationOffer("too_expensive", "pro", CancellationOfferPhase.Grace)!!.action,
        )
        assertEquals(
            "Come back on Starter",
            cancellationOffer("too_expensive", "pro", CancellationOfferPhase.Grace)!!.actionLabel,
        )
        // The seasonal answer is the whole answer. There is nothing to press,
        // and a button invented for it would have to do something.
        CancellationOfferPhase.entries.forEach { phase ->
            val offer = cancellationOffer("seasonal", "pro", phase)!!
            assertNull(offer.action)
            assertNull(offer.actionLabel)
        }
    }

    /** A null action must never arrive with a label, or a client will draw one. */
    @Test
    fun `no offer carries a label for a control it does not name`() {
        everyOffer().forEach { offer ->
            assertTrue(
                "${offer.reason}: action and label must appear and vanish together",
                (offer.action == null) == (offer.actionLabel == null),
            )
            assertTrue(
                "every offer must say something",
                offer.heading.isNotBlank() && offer.body.isNotBlank(),
            )
        }
    }

    // -- the clock -----------------------------------------------------------

    private val canceled = "2026-07-01T12:00:00Z"

    /**
     * THE CLOCK RUNS FROM `canceled_at`, which is what `runGraceJob` measures.
     * A card counting from the period end would name a later date than the one
     * the number actually dies on, and a deadline wrong in the customer's
     * favour is the expensive direction to be wrong in.
     */
    @Test
    fun `the release is thirty days after cancellation, not after the last period`() {
        assertEquals(30, CANCELLATION_GRACE_DAYS)
        assertEquals(
            Instant.parse("2026-07-31T12:00:00Z"),
            numberReleaseAt(canceled),
        )
        assertNull(numberReleaseAt(null))
        assertNull(numberReleaseAt("   "))
        assertNull(numberReleaseAt("not a date"))
    }

    /**
     * PostgREST sends `+00:00` offsets and the Workers send `Z`. A client that
     * understood only one would silently lose the deadline on half its reads.
     */
    @Test
    fun `both spellings of a server timestamp are understood`() {
        assertEquals(numberReleaseAt(canceled), numberReleaseAt("2026-07-01T12:00:00+00:00"))
        assertNotNull(numberReleaseAt("2026-07-01T07:00:00-05:00"))
    }

    /**
     * Past the release the number is back in carrier inventory and can be given
     * to another business (#413), so "resubscribe and keep your number" becomes
     * FALSE at exactly this boundary — and it is the sort of false that gets
     * discovered by the person it was promised to.
     */
    @Test
    fun `the window closes exactly when the job releases the number`() {
        assertTrue(isWithinCancellationGrace(canceled, Instant.parse("2026-07-30T23:59:59Z")))
        assertFalse(isWithinCancellationGrace(canceled, Instant.parse("2026-07-31T12:00:00Z")))
        assertFalse(isWithinCancellationGrace(canceled, Instant.parse("2026-08-05T00:00:00Z")))
        assertFalse("a workspace that never cancelled has no window", isWithinCancellationGrace(null))
    }

    /**
     * A dismissal belongs to ONE cancellation. Somebody who waves this away,
     * comes back, and leaves again next winter is asked once about the NEW
     * cancellation — which is why the column is a timestamp compared against
     * `canceled_at` rather than a boolean nothing would ever clear.
     */
    @Test
    fun `a dismissal silences the cancellation it was made about, and no later one`() {
        val now = Instant.parse("2026-07-10T00:00:00Z")
        assertTrue("nothing dismissed yet", shouldOfferWinback(canceled, null, now))
        assertFalse(
            "dismissed after this cancellation began",
            shouldOfferWinback(canceled, "2026-07-02T00:00:00Z", now),
        )
        assertTrue(
            "a dismissal older than this cancellation belongs to the previous one",
            shouldOfferWinback(canceled, "2025-11-02T00:00:00Z", now),
        )
        assertFalse(
            "outside the window there is nothing to offer, dismissed or not",
            shouldOfferWinback(canceled, null, Instant.parse("2026-09-01T00:00:00Z")),
        )
        assertFalse(
            "a stamp we cannot read still means somebody pressed the button",
            shouldOfferWinback(canceled, "whenever", now),
        )
    }

    // -- the wiring the constraint actually lives in -------------------------

    /**
     * THE CONSTRAINT THAT OUTRANKS EVERYTHING. Adding the offer must not add a
     * scroll past the button that leaves. Any content ABOVE the exit moves the
     * exit further down the moment a radio is tapped, which would mean
     * answering the question pushes the way out away from the thumb that was
     * about to press it.
     *
     * So the offer is rendered after the button, and this is the assertion that
     * keeps it there when somebody reasonably decides an answer belongs next to
     * the question it answers.
     */
    @Test
    fun `the offer is rendered after the button that leaves, never before it`() {
        val body = cancelCard()
        val note = body.indexOf("CancellationOfferNote(")
        val confirm = body.indexOf(ExitPath.EXIT_KEY)
        assertTrue("the cancel card must carry the offer at all", note > 0)
        assertTrue("the cancel card must still carry the button that leaves", confirm > 0)
        assertTrue(
            "the offer sits above the exit, so choosing a reason pushes the way out " +
                "further down the screen. It belongs after the button",
            note > confirm,
        )
    }

    /**
     * The offer decides for itself whether it has anything to say. If the CARD
     * decided, that decision would be a conditional statement standing between
     * the card opening and the exit — the shape
     * [CancellationFlowTest] exists to keep out of this card.
     */
    @Test
    fun `the card asks the offer unconditionally and the offer answers with nothing`() {
        val card = cancelCard()
        assertFalse(
            "the cancel card must not gate the offer itself; the offer renders nothing",
            Regex("if \\([^)]*\\)\\s*\\{?\\s*CancellationOfferNote").containsMatchIn(card),
        )
        val note = composable("CancellationOfferNote")
        assertTrue(
            "the offer must come from the shared decision, not from copy chosen here",
            note.contains("cancellationOffer("),
        )
        // The shape used to be `?: return` on one nullable answer. #277 added a
        // second — the pause — so the early return now has to cover both, and a
        // guard still looking for the old spelling would pass on a note that
        // rendered an empty paragraph for every reason that answers nothing.
        assertTrue(
            "and NEITHER answer having anything to say must render nothing rather " +
                "than a substitute or an empty heading",
            note.contains("if (pauseAnswer == null && offer == null) return"),
        )
    }

    /**
     * #481's card is for a business winding down and its docblock forbids
     * persuasion in as many words: "A screen that argues with them about
     * leaving… is the last thing they will remember about us." The win-back
     * goes beside Resubscribe instead.
     */
    @Test
    fun `no part of the win-back is inside the off-ramp card`() {
        val offRamp = composable("OffRampCard")
        listOf("cancellationOffer", "dismissWinback", "No thanks", "Resubscribe").forEach { word ->
            assertFalse(
                "`$word` in OffRampCard turns a wind-down message into a retention pitch",
                offRamp.contains(word),
            )
        }
    }

    /**
     * The canceled card used to say "we hold your number for 30 days after your
     * last period", which is a different date from the one the number dies on.
     */
    @Test
    fun `the canceled card names the release date the job will actually act on`() {
        val card = composable("CanceledSubscriptionCard")
        assertFalse(
            "the period end is not the clock the release job runs on",
            card.contains("after your last period") || card.contains("last period"),
        )
        assertTrue(
            "the deadline must come from the shared grace arithmetic",
            card.contains("releaseDate(canceledAt)"),
        )
        assertTrue(
            "and the offer must be gated on the window still being open",
            card.contains("shouldOfferWinback("),
        )
        assertTrue(
            "the grace phase is the one this card is in",
            card.contains("CancellationOfferPhase.Grace"),
        )
    }

    /**
     * "No thanks" has to survive the app being closed, or the grace emails walk
     * somebody back into a card they have already declined twice more.
     */
    @Test
    fun `declining the win-back is persisted rather than only remembered`() {
        val card = composable("CanceledSubscriptionCard")
        assertTrue("the dismissal must reach the API", card.contains("dismissWinback("))
        assertTrue(
            "and it must be fired on the process scope, like the reason record is",
            card.contains("appScope.launch"),
        )
        assertTrue(
            "a failed write must put the offer back rather than pretend it landed",
            card.contains("wavedAway = false"),
        )
    }

    /**
     * `detail` is what somebody wrote about us in their own words. Reading it
     * back to them on a win-back card would be quoting them at themselves, and
     * the route deliberately does not serve it — so the model must not invite
     * it either.
     */
    @Test
    fun `the reason read back never carries the free text`() {
        val src = readMainSource(models)
        val model = src.substringAfter("data class StatedCancellationReason(")
            .substringBefore(")")
        assertTrue("the model must exist", model.contains("val reason"))
        assertFalse(
            "the free text must never be modelled on the read-back path",
            model.contains("detail"),
        )
    }

    /**
     * THE PROPERTY BEHIND DEFECT 1, applied to the module AND to the screen.
     *
     * The offer module was fixed first and the composable was not, so for a
     * while this card said both things at once: the consequence line at the top
     * read "texting stops at the end of your billing period, and we hold your
     * number for 30 days", and the seasonal answer twenty dp below read "the 30
     * days run from the day you cancel". One reader, one card, two deadlines
     * about a month apart, and the wrong one is the reassuring one.
     *
     * A ban on the wrong shape was the obvious guard and is the weaker one: the
     * old sentences do not share a shape, and one of them ("we hold your number
     * for 30 days in case you come back") names no anchor at all, which no
     * ban can see. So this is the POSITIVE property — wherever the hold is
     * counted in days, the day it counts from is named next to it.
     */
    @Test
    fun `every mention of the hold in days names the day it counts from`() {
        val anchor = Regex("from the day (you|they) cancel(led)?")
        val surfaces = everyCopy() + copySurfaces().map { (name, source) ->
            "$name in $billingSection" to source
        }

        surfaces.forEach { (where, copy) ->
            Regex("\\b$CANCELLATION_GRACE_DAYS days\\b").findAll(copy).forEach { hit ->
                val window = copy.substring(
                    hit.range.first,
                    minOf(copy.length, hit.range.last + 120),
                )
                assertTrue(
                    "$where counts the hold in days without saying which day it " +
                        "starts on, so the reader adds it to the end of their billing " +
                        "period and counts about twice the real window: `$window`",
                    anchor.containsMatchIn(window),
                )
            }
        }
    }

    /**
     * DEFECT 4: the day-27 grace email prints "August 4, 2026" and links to
     * this exact screen, which printed "4 August".
     *
     * The branch that suffers is the expired one — "the hold ended on 3
     * September" is read, by definition, after the deadline has passed and
     * possibly a winter or a year later, by somebody whose only question is
     * whether that date is behind them. A bare day and month cannot answer it.
     *
     * Reads the pattern rather than the sentence, because the pattern is the
     * thing that would be edited.
     */
    @Test
    fun `the release date carries a year`() {
        val src = readMainSource(billingSection)
        val fn = declaration(src, "private fun releaseDate(")
        val pattern = Regex("ofPattern\\(\"([^\"]+)\"\\)").find(fn)?.groupValues?.get(1)
            ?: Regex("format\\((\\w+)\\)").find(fn)?.groupValues?.get(1)?.let { named ->
                Regex("$named = DateTimeFormatter\\.ofPattern\\(\"([^\"]+)\"\\)")
                    .find(src)?.groupValues?.get(1)
            }
        assertNotNull(
            "could not read the pattern releaseDate formats with. If it was " +
                "restructured, teach this guard the new shape rather than deleting it",
            pattern,
        )
        assertTrue(
            "the release date prints as `$pattern`, with no year in it. The email " +
                "that sends people to this screen prints one, and the expired branch " +
                "is read after the date has gone by",
            pattern!!.contains("yyyy") || pattern.contains("uuuu"),
        )
    }

    /**
     * DEFECT 5: the hold ends on a clock, the release happens on a cron.
     *
     * "has gone back to the phone company" flipped on the DEVICE clock the
     * instant `canceled_at + 30d` passed, but `runGraceJob` sweeps once a day
     * (`0 14 * * *`) and can fail and retry. For up to about a day we were
     * telling somebody their number was gone while it was in fact still
     * recoverable — and the win-back that could have recovered it disappears at
     * the same moment, so there is nothing on the screen to contradict us.
     *
     * What is true at exactly that boundary is about the HOLD, not about the
     * carrier.
     */
    /**
     * #228 moved this card's words into `SettingsStrings`, and the guard had to
     * follow them there rather than stay pointed at a file that no longer holds
     * a sentence.
     *
     * Reading the composable for the past tense would now pass on the empty set
     * — the card contains keys — which is the decorative-guard failure this repo
     * keeps re-learning. So the SOURCE is still checked for the wiring (the card
     * must reach the hold copy at all), and the CLAIM is checked where the claim
     * now lives: in both languages, because a French translator has the same
     * opportunity to promise a release that the daily cron has not performed.
     */
    @Test
    fun `the expired branch says the hold ended, not that the number is already gone`() {
        val card = readableCopy(composable("CanceledSubscriptionCard"))
        assertTrue(
            "the expired branch must still say the hold is over, or somebody reads " +
                "a canceled card with nothing on it about their number",
            card.contains("settings.holdEnded"),
        )

        val holdCopy = AppStrings.SECTIONS
            .flatMap { section -> section.en.entries + section.frCA.entries }
            .filter { it.key.startsWith("settings.hold") }
        assertTrue("the hold sentences are not in the catalogue", holdCopy.size >= 8)
        holdCopy.forEach { (key, sentence) ->
            assertFalse(
                "$key: the release runs on a daily cron, so the past tense is a claim " +
                    "the product has not necessarily carried out yet: $sentence",
                Regex(
                    "(has|have|is|are) (gone back|been released|been given)|" +
                        "(est|sont) (retourné|libéré|rendu)",
                ).containsMatchIn(sentence),
            )
        }
    }

    // -- helpers -------------------------------------------------------------

    /**
     * One input to [cancellationOffer] and what it answered.
     *
     * [inPause] rather than the raw flag, because they are not the same
     * question: the module honours a pause only in the `before` phase, since
     * `paused_at` outlives the subscription it belonged to and a grace-phase
     * `true` describes a workspace whose 30-day clock is running right now. The
     * copy guards below ask "is this reader IN a pause", which is [inPause], and
     * a guard reading the raw flag would license pause words in the one answer
     * that must never carry them.
     */
    private data class OfferCase(
        val label: String,
        val inPause: Boolean,
        val offer: CancellationOffer?,
    )

    /** Every offer this module can produce, across reasons, plans and phases. */
    private fun everyOffer(): List<CancellationOffer> = everyCase().mapNotNull { it.offer }

    /**
     * The same offers, each labelled with the input that produced it, as one
     * flat string per offer.
     *
     * A LIST OF PAIRS, NOT A MAP, and that is not a style preference. The first
     * version of the two property guards below keyed a map on `offer.reason`,
     * which silently collapsed thirty-odd offers into three: only the last
     * phase of each reason was ever read. It was caught by breaking the
     * before-phase seasonal body and watching the guard stay green — which is
     * the whole argument for breaking a guard rather than trusting it.
     *
     * The label carries the phase and plan for the same reason: a failure
     * message naming "the seasonal answer" when there are two of them sends the
     * reader to the wrong one.
     */
    private fun everyCopy(): List<Pair<String, String>> =
        everyCase().mapNotNull { case ->
            case.offer?.let { case.label to "${it.heading} ${it.body}" }
        }

    /**
     * THE PAUSE IS AN AXIS NOW, and adding it is half the value of this helper.
     *
     * Every property guard in this file runs over this list, so a paused answer
     * that quietly contradicted one of them — a deadline with no anchor, a
     * label on a null action, a promise made to a reader who cannot have it —
     * would ship without a guard being edited. The default (`paused` omitted) is
     * still in here as its own row, which is what pins the byte-for-byte
     * behaviour every other client's hand-port compares against.
     */
    private fun everyCase(): List<OfferCase> =
        CANCELLATION_REASONS.flatMap { reason ->
            CancellationOfferPhase.entries.flatMap { phase ->
                listOf(null, "starter", "pro").flatMap { plan ->
                    listOf(null, "2026-01-01T00:00:00Z").flatMap { fee ->
                        listOf(false, true).map { paused ->
                            val paid = if (fee == null) "unpaid" else "fee paid"
                            val state = if (paused) "paused" else "running"
                            OfferCase(
                                label = "the ${reason.code} answer " +
                                    "($phase, plan=$plan, $paid, $state)",
                                inPause = paused && phase == CancellationOfferPhase.Before,
                                offer = cancellationOffer(
                                    reason = reason.code,
                                    plan = plan,
                                    phase = phase,
                                    registrationFeePaidAt = fee,
                                    paused = paused,
                                ),
                            )
                        }
                    }
                }
            }
        }

    private fun cancelCard(): String = composable("CancelCard")

    /** A composable's source, from its signature to its closing brace. */
    private fun composable(name: String): String {
        val src = readMainSource(billingSection)
        val start = src.indexOf("private fun $name(")
        if (start < 0) fail("$name not found in $billingSection")
        val end = src.indexOf("\n}\n", start)
        if (end < 0) fail("$name has no closing brace at column 0")
        return src.substring(start, end)
    }

    /** A top-level declaration with an expression body, up to the blank line. */
    private fun declaration(source: String, marker: String): String {
        val start = source.indexOf(marker)
        if (start < 0) fail("`$marker` not found in $billingSection")
        val end = source.indexOf("\n\n", start)
        return if (end < 0) source.substring(start) else source.substring(start, end)
    }

    /**
     * A composable's source as the READER would see it.
     *
     * Three normalisations, and each one is the difference between a guard and
     * a decoration:
     *
     *   comments go   they quote the old copy in order to explain why it went,
     *                 and a scan that reads them fails on its own footnotes.
     *   seams close   this file wraps long copy as `"…for " + "30 days…"`, so a
     *                 guard reading raw source sees a sentence that ends
     *                 mid-clause and finds nothing wrong with it.
     *   the constant  the copy interpolates `CANCELLATION_GRACE_DAYS`, so a
     *   resolves      scan looking for a number never sees a digit at all.
     */
    private fun readableCopy(source: String): String = source
        .replace(Regex("(?m)^\\s*//.*$"), "")
        .replace(Regex("\"\\s*\\+\\s*\""), "")
        .replace("\${CANCELLATION_GRACE_DAYS}", CANCELLATION_GRACE_DAYS.toString())
        .replace("\$CANCELLATION_GRACE_DAYS", CANCELLATION_GRACE_DAYS.toString())

    /**
     * The composables that render cancellation copy of their own.
     *
     * `StatusNotices` is here because the scheduled-cancel banner it draws is
     * one of the three places the hold was counted from the wrong day — it is
     * the FIRST thing an owner reads on this screen once cancelling is
     * scheduled.
     */
    private fun copySurfaces(): Map<String, String> = listOf(
        "CancelCard",
        "CancellationOfferNote",
        "CanceledSubscriptionCard",
        "StatusNotices",
    ).associateWith { readableCopy(composable(it)) }

    /**
     * Only what a person can READ: every double-quoted literal in the source,
     * joined.
     *
     * The difference from [readableCopy] is identifiers. A composable that
     * threads a `pause` parameter through to a child contains the word "pause"
     * in its wiring, and a copy guard that cannot tell that from a sentence
     * would either fail on correct code or be softened until it catches
     * nothing. Escapes are stepped over so a `\"` inside copy does not look
     * like the end of the literal.
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
                // Comments go FIRST, and they are the reason this is a machine
                // rather than a regex: they quote the old copy in order to
                // explain why it went, so a scan that reads them fails on its
                // own footnotes.
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
     * A file from `packages/shared/src`, from wherever Gradle started.
     *
     * The three prefixes are [mainRoot]'s three candidate working directories,
     * walked back to the repository root.
     *
     * FAILS rather than skips when the file is not there. A cross-language
     * guard that quietly passes because it could not find the other language is
     * the worst kind: it reads as protection and provides none.
     */
    private fun sharedSource(relative: String): String {
        listOf("", "../../", "../../../").forEach { prefix ->
            val f = File("${prefix}packages/shared/src/$relative")
            if (f.exists()) return f.readText()
        }
        fail(
            "packages/shared/src/$relative not found from ${File(".").absolutePath}. " +
                "This guard compares the Kotlin hand-port against the TypeScript it " +
                "was ported from, so it fails rather than skipping",
        )
        error("unreachable")
    }

    /**
     * TypeScript source as the RUNTIME sees its strings.
     *
     * Four normalisations, and every one of them is the difference between a
     * cross-language pin and a guard that fails on correct code:
     *
     *   comments go        the shared module explains its copy at length and
     *                      quotes the wording it replaced, so a `contains` over
     *                      raw source could match a footnote instead of a string.
     *   seams close        `"…two steps in " + "this order…"` is ONE sentence at
     *                      runtime and two literals in the file.
     *   the interpolations the two that reach the reader are resolved to what
     *   resolve            this client prints — which is what makes a drift in
     *                      the grace window or the seat count fail here rather
     *                      than pass quietly.
     *   whitespace flattens a literal wrapped across five indented lines is one
     *                      run of spaces to a reader and five newlines on disk.
     */
    /**
     * The web catalogue, which is where the shared module's English now lives.
     *
     * Reached the same way [sharedSource] reaches `packages/shared`, and it
     * fails rather than skipping for the same reason: a cross-language pin that
     * quietly does nothing is worse than no pin, because the file it was
     * watching keeps being edited.
     */
    private fun catalogueSource(): String {
        listOf("", "../../", "../../../").forEach { prefix ->
            val f = File("${prefix}apps/web/src/i18n/sections/settings.ts")
            if (f.exists()) return f.readText()
        }
        fail(
            "apps/web/src/i18n/sections/settings.ts not found from " +
                "${File(".").absolutePath}. This guard compares the Kotlin " +
                "hand-port against the catalogue it was ported from, so it fails " +
                "rather than skipping",
        )
        error("unreachable")
    }

    /**
     * The catalogue's ENGLISH half, as the runtime sees its strings.
     *
     * Sliced to `settingsEn` before anything else. The French half holds the
     * same keys, and a `contains` over the whole file would be asking whether a
     * sentence appears in EITHER language — which is exactly the question this
     * guard must not answer yes to.
     */
    private fun catalogueCopy(source: String): String = source
        .substringAfter("export const settingsEn")
        .substringBefore("export const settingsFr")
        .replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
        .replace(Regex("(?m)//.*$"), "")
        .replace(Regex("[\"]\\s*\\+\\s*[\"]"), "")
        .replace("{days}", CANCELLATION_GRACE_DAYS.toString())
        .replace("{seats}", STARTER_SEATS.toString())
        .replace("{numbers}", STARTER_NUMBERS.toString())
        .replace(Regex("\\s+"), " ")

    private fun tsCopy(source: String): String = source
        .replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
        .replace(Regex("(?m)//.*$"), "")
        .replace(Regex("[`\"]\\s*\\+\\s*[`\"]"), "")
        .replace("\${CANCELLATION_GRACE_DAYS}", CANCELLATION_GRACE_DAYS.toString())
        .replace("\${PLAN_SEATS.starter}", STARTER_SEATS.toString())
        .replace(Regex("\\s+"), " ")

    /**
     * One exported declaration's text, up to the `};` that closes it.
     *
     * Fails on a missing declaration rather than returning the whole file, which
     * is what `substringAfter` does by default and would leave every assertion
     * built on it reading somebody else's numbers.
     */
    private fun tsBlock(source: String, declaration: String): String {
        val at = source.indexOf(declaration)
        if (at < 0) {
            fail("`$declaration` not found — was it renamed in packages/shared?")
        }
        return source.substring(at).substringBefore("};")
    }

    /**
     * The integer assigned to `key` in the first `{ … }` after `marker`.
     *
     * A regex over TypeScript rather than a parser, and that is a real limit:
     * it reads `starter: 2900` and would not survive the constant being
     * computed. The shared file states these as literals on purpose (the CAD
     * figures are DECIDED, not converted), so a literal reader is the right
     * shape — and it fails loudly rather than silently if that ever changes.
     */
    private fun tsNumber(source: String, marker: String, key: String): Int {
        val at = source.indexOf(marker)
        if (at < 0) fail("`$marker` not found in the shared source")
        val block = source.substring(at).substringBefore("}")
        val match = Regex("\\b$key:\\s*(\\d+)").find(block)
        if (match == null) fail("no `$key:` in the block after `$marker`")
        return match!!.groupValues[1].toInt()
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
