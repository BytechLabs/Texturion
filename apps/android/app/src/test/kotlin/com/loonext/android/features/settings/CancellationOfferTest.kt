package com.loonext.android.features.settings

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
     * THERE IS NO PAUSE FEATURE. The seasonal answer is about the 30-day hold
     * that already exists and nothing more, and a heading like "Pause your
     * plan" would be a feature promise made by a copy edit.
     *
     * READS THE COMPOSABLES TOO, and that is the half that was missing. This
     * guard used to walk [everyOffer] and stop there, so it proved something
     * only about `SettingsLogic.kt` — a "Pause your plan for the winter"
     * written straight into [CancellationOfferNote] renders on the same card,
     * in the same paragraph position, and passed this file untouched. The
     * module is where the copy SHOULD live, not where a reader can tell it
     * came from.
     *
     * The three composables are the ones that render cancellation copy.
     * `StatusNotices` is deliberately not among them: it says "Sending is
     * paused until your payment method is updated", which is true, is about an
     * unpaid subscription rather than a plan the owner chose to park, and
     * banning the word there would be banning a fact.
     */
    @Test
    fun `no offer claims a pause feature exists`() {
        val banned = listOf("paus", "freeze", "frozen", "suspend your", "put it on ice")
        val surfaces = everyCopy() + cancellationComposables().map { (name, source) ->
            "$name in $billingSection" to source
        }

        surfaces.forEach { (where, text) ->
            val lower = text.lowercase()
            banned.forEach { word ->
                assertFalse(
                    "\"$word\" in $where promises a feature that does not exist. " +
                        "There is no pause, freeze or park-my-plan control in this " +
                        "product, and copy implying one sends somebody looking for a " +
                        "button that is not there",
                    lower.contains(word),
                )
            }
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
        val confirm = body.indexOf("Continue to cancel")
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
        assertTrue(
            "and a null answer must render nothing rather than a substitute",
            note.contains("?: return"),
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
    @Test
    fun `the expired branch says the hold ended, not that the number is already gone`() {
        val card = readableCopy(composable("CanceledSubscriptionCard"))
        assertFalse(
            "the release runs on a daily cron, so the past tense is a claim the " +
                "product has not necessarily carried out yet: $card",
            Regex("(has|have|is|are) (gone back|been released|been given)")
                .containsMatchIn(card),
        )
        assertTrue(
            "the expired branch must still say the hold is over, or somebody reads " +
                "a canceled card with nothing on it about their number",
            card.contains("hold on your number"),
        )
    }

    // -- helpers -------------------------------------------------------------

    /** Every offer this module can produce, across reasons, plans and phases. */
    private fun everyOffer(): List<CancellationOffer> =
        everyInput().mapNotNull { (_, offer) -> offer }

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
        everyInput().mapNotNull { (label, offer) ->
            offer?.let { label to "${it.heading} ${it.body}" }
        }

    private fun everyInput(): List<Pair<String, CancellationOffer?>> =
        CANCELLATION_REASONS.flatMap { reason ->
            CancellationOfferPhase.entries.flatMap { phase ->
                listOf(null, "starter", "pro").flatMap { plan ->
                    listOf(null, "2026-01-01T00:00:00Z").map { fee ->
                        val paid = if (fee == null) "unpaid" else "fee paid"
                        "the ${reason.code} answer ($phase, plan=$plan, $paid)" to
                            cancellationOffer(
                                reason = reason.code,
                                plan = plan,
                                phase = phase,
                                registrationFeePaidAt = fee,
                            )
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
     * The three composables a pause promise could hide in.
     *
     * Not `StatusNotices`: it says "Sending is paused until your payment method
     * is updated", which is true, is about an unpaid subscription rather than a
     * plan somebody chose to park, and banning the word there would be banning
     * a fact.
     */
    private fun cancellationComposables(): Map<String, String> = listOf(
        "CancelCard",
        "CancellationOfferNote",
        "CanceledSubscriptionCard",
    ).associateWith { composable(it) }

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
