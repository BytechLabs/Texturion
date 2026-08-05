package com.loonext.android.features.settings

import com.loonext.android.core.model.ChangePlanResult
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.HeldNumber
import com.loonext.android.core.model.HeldNumberReason
import com.loonext.android.core.model.HeldNumbers
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.model.SubscriptionStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * #523 — what this client says about a number its plan does not cover.
 *
 * THE DEFECT. `POST /v1/billing/checkout` counts no numbers, and its completion
 * handler used to un-suspend every suspended row with no plan term, so a Pro
 * workspace holding two numbers could press the #277 win-back's "Come back on
 * Starter" and land on Starter holding two. The API now restores what the plan
 * covers and HOLDS the rest — which leaves this client with a state it had never
 * had to describe: a number that is neither working nor gone.
 *
 * WHAT THIS FILE PINS, in six parts that fail for six different reasons.
 *
 *   the note        that the payment-method sentence is gone from the
 *                   over-allowance case and still there for the failed payment.
 *                   One sentence used to serve four causes and was false for
 *                   three of them.
 *   the gate        that a cancellation-era suspension is offered no purchase.
 *                   `CanceledSubscriptionCard` already owns that state, and the
 *                   route refuses the buy outright.
 *   the figures     that the allowance, the cap and the price come from the
 *                   RESPONSE. Fixtures use values no Kotlin constant in this
 *                   repository holds — 4, 9, 700 cents — so no assertion can be
 *                   satisfied by a hand-ported literal.
 *   the currency    that a USD-priced extra shown to a CAD-billed workspace
 *                   reads "US$", never a bare "$". #522 verbatim.
 *   the tracker     that the port card beside a held line stops calling it
 *                   "Ported". This is the one part pinning damage THIS work did:
 *                   admitting suspended rows to the card filter gave a held
 *                   ported line a card saying it cannot send, next to a tracker
 *                   still reporting an all-clear.
 *   the wiring      source scans, because a unit test cannot render a
 *                   composable. They prove the old sentence is gone and the new
 *                   functions are called with the fields they switch on.
 *
 * WHAT IT DOES NOT PIN, said plainly: not that Compose draws any of it, not that
 * Stripe charges what the route quoted, and nothing at all about iOS or the web
 * — each client hand-ports separately and needs its own file.
 */
class HeldNumbersTest {

    // -- fixtures ------------------------------------------------------------

    private val heldId = "held-1"

    /**
     * AN ALLOWANCE OF FOUR, A CAP OF NINE, A PRICE OF SEVEN DOLLARS, on purpose.
     *
     * None of those three integers appears anywhere in this client's constants:
     * Starter includes 1 number and Pro 2, Starter's hard cap is 2, and the
     * extra-number mirror holds 500 and 400 cents. So every assertion below that
     * names one of them is proof the value travelled from the response, and
     * cannot be satisfied by a hand-port the way an assertion about "1" or "$5"
     * silently could.
     */
    private fun held(
        reason: String? = HeldNumberReason.OVER_PLAN_ALLOWANCE,
        numbers: List<String?> = listOf("+14155550102"),
        included: Int? = 1,
        paidExtras: Int = 0,
        allowance: Int? = 4,
        maxTotal: Int? = 9,
        cents: Int? = 700,
        currency: String? = "usd",
        canReinstate: Boolean = true,
        canUpgrade: Boolean = true,
        plan: String = "starter",
    ) = HeldNumbers(
        plan = plan,
        included = included,
        paid_extras = paidExtras,
        allowance = allowance,
        max_total = maxTotal,
        reason = reason,
        held = numbers.mapIndexed { i, e164 ->
            HeldNumber(id = if (i == 0) heldId else "held-${i + 1}", number_e164 = e164)
        },
        extra_number_cents = cents,
        extra_number_currency = currency,
        can_reinstate = canReinstate,
        can_upgrade = canUpgrade,
    )

    /**
     * The number a transfer delivered — the port row's `phone_e164` and the
     * `phone_numbers` row's `number_e164` are the same digits after cutover, and
     * that is the only thing joining the tracker to the card beside it.
     */
    private val portedE164 = "+14155550102"

    private fun numberRow(
        status: String,
        id: String = "n-ported",
        e164: String? = portedE164,
    ) = PhoneNumberSummary(
        id = id,
        status = status,
        country = "CA",
        number_e164 = e164,
        // A ported row carries no requested_area_code — a transfer buys no
        // inventory (`claim_port_slot`).
        requested_area_code = null,
        source = "ported",
        created_at = "2026-01-01T00:00:00Z",
    )

    private fun company(currency: String? = "cad", country: String = "CA") = CompanyView(
        id = "c1",
        name = "Northside Plumbing",
        country = country,
        us_texting_enabled = false,
        requested_area_code = "416",
        timezone = "America/Toronto",
        subscription_status = SubscriptionStatus.ACTIVE,
        plan = "starter",
        billing_currency = currency,
        created_at = "2026-01-01T00:00:00Z",
        updated_at = "2026-01-01T00:00:00Z",
    )

    // -- the note every role reads -------------------------------------------

    /**
     * THE SENTENCE THAT WAS FALSE. Every suspended number used to read "This
     * number is suspended. Update your payment method under Settings › Billing
     * to bring it back." For the #523 hold that is wrong twice over: the card on
     * file is fine, and the billing portal it sends you to cannot fix an
     * allowance. It asked somebody to re-enter card details to solve a problem
     * card details have nothing to do with.
     */
    @Test
    fun `an over-allowance hold is never blamed on the payment method`() {
        val note = suspendedNumberNote(SubscriptionStatus.ACTIVE, canManageBilling = true)
        assertFalse(
            "the subscription is live and paid; blaming the card is the shipped " +
                "defect: $note",
            note.contains("payment", ignoreCase = true),
        )
        assertTrue("got: $note", note.contains("covers fewer numbers"))
    }

    /**
     * THE HALF SOMEBODY COULD PLAN A BUSINESS AROUND BEING WRONG ABOUT, in every
     * branch.
     *
     * A held number still receives. The owner who reads "on hold" and concludes
     * the line is dead tells customers to use a different number, or starts a
     * port they did not need. What is actually true — still ours, still ringing,
     * history intact — has to be in the words, not implied by the absence of the
     * word "released".
     */
    @Test
    fun `every cause says what has NOT happened`() {
        listOf(
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.UNPAID,
            SubscriptionStatus.CANCELED,
            "incomplete",
        ).forEach { status ->
            listOf(true, false).forEach { canManage ->
                val note = suspendedNumberNote(status, canManage)
                assertTrue(
                    "$status/$canManage must say it has not been given up: $note",
                    note.contains("hasn't been given up"),
                )
                assertTrue(
                    "$status/$canManage must say it still receives: $note",
                    note.contains("texts and calls still reach it"),
                )
                assertFalse(
                    "nothing was released and no branch may say so: $note",
                    note.contains("released") || note.contains("given back"),
                )
            }
        }
    }

    /** ...and where the card IS the cause, the sentence still says so. */
    @Test
    fun `a failed payment is still called a failed payment`() {
        listOf(SubscriptionStatus.PAST_DUE, SubscriptionStatus.UNPAID).forEach { status ->
            val note = suspendedNumberNote(status, canManageBilling = true)
            assertTrue(
                "$status must still name the payment: $note",
                note.contains("payment didn't go through"),
            )
            assertTrue("got: $note", note.contains("Update it under Settings › Billing"))
        }
    }

    /** A cancelled workspace resubscribes; it does not buy an extra number. */
    @Test
    fun `a cancelled subscription is answered by resubscribing`() {
        val note = suspendedNumberNote(SubscriptionStatus.CANCELED, canManageBilling = true)
        assertTrue("got: $note", note.contains("subscription is canceled"))
        assertTrue("got: $note", note.contains("Resubscribe"))
    }

    /**
     * An owner on a live subscription is pointed NOWHERE by the note, because
     * the routes and the button render directly under it from the server's own
     * answer. A pointer to Billing beside a button that does the thing here
     * would be the screen contradicting itself.
     */
    @Test
    fun `an owner reading the live-subscription note is not sent somewhere else`() {
        val note = suspendedNumberNote(SubscriptionStatus.ACTIVE, canManageBilling = true)
        assertFalse(
            "the routes render under this note; pointing at another screen as " +
                "well is the card arguing with itself: $note",
            note.contains("Billing"),
        )
    }

    /**
     * A member cannot reach any /v1/billing route, so nothing renders under the
     * note for them — which makes the note the only thing they get, and it has
     * to name who can act.
     */
    @Test
    fun `somebody who cannot change billing is told who to ask, in every state`() {
        listOf(
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.UNPAID,
            SubscriptionStatus.CANCELED,
            "incomplete",
        ).forEach { status ->
            val note = suspendedNumberNote(status, canManageBilling = false)
            assertTrue(
                "$status leaves a member with a dead line and nobody to ask: $note",
                note.contains("Ask an owner or admin"),
            )
        }
    }

    /** An unknown status states what is true and guesses at no cause. */
    @Test
    fun `an unrecognised subscription state claims no cause`() {
        val note = suspendedNumberNote("incomplete", canManageBilling = true)
        assertFalse("got: $note", note.contains("payment", ignoreCase = true))
        assertFalse("got: $note", note.contains("canceled"))
        assertFalse("got: $note", note.contains("covers fewer"))
    }

    // -- the gate ------------------------------------------------------------

    /**
     * The grace-window suspension is NOT offered a purchase.
     *
     * `CanceledSubscriptionCard` already owns it, in more detail, with the
     * release date and the win-back on it — and the reinstate route refuses a
     * cancelled subscription outright, so a button here would be the only
     * pressable path to a 409 on the screen.
     */
    @Test
    fun `a suspension that belongs to the cancellation offers nothing to buy`() {
        val state = held(reason = HeldNumberReason.SUBSCRIPTION_INACTIVE)
        assertNull(heldNumberRoutes(state, heldId, "US\$7/mo"))
        assertFalse(canBringBack(state, heldId, "US\$7/mo"))
    }

    /** A number the response does not list is not this response's business. */
    @Test
    fun `a number the server did not name is left alone`() {
        assertNull(heldNumberRoutes(held(), "some-other-number", "US\$7/mo"))
        assertFalse(canBringBack(held(), "some-other-number", "US\$7/mo"))
    }

    /**
     * The reason strings are the API's, spelled the API's way.
     *
     * The only assertion in this file a change made in TypeScript can fail. The
     * gate above is worth nothing if this client's idea of `over_plan_allowance`
     * and the route's have drifted: everything would fall through to null, and a
     * workspace paying rent on a held number would be offered nothing at all,
     * with every Kotlin test still green.
     */
    @Test
    fun `the reason values are pinned against the route that serves them`() {
        val route = apiSource("routes/billing.ts")
        listOf(
            HeldNumberReason.OVER_PLAN_ALLOWANCE,
            HeldNumberReason.SUBSCRIPTION_INACTIVE,
        ).forEach { value ->
            assertTrue(
                "`$value` is not in apps/api/src/routes/billing.ts. HeldNumberReason " +
                    "has drifted from the route that serves it, and this screen now " +
                    "silently offers nothing to a workspace being held",
                route.contains("\"$value\""),
            )
        }
        assertTrue(
            "the route decides the reason from subscription_status; if it has " +
                "started switching on something else, suspendedNumberNote() is " +
                "switching on the wrong field too",
            route.contains("company.subscription_status === \"active\""),
        )
    }

    // -- the currency ---------------------------------------------------------

    /**
     * #522, ON THE BUTTON THAT TAKES THE MONEY. The extra-number book is filed in
     * USD only, so a Canadian workspace bringing a held number back is charged
     * US$7 — and "$7" to that reader means CA$7, a figure their card will never
     * take.
     *
     * Seven dollars, again, because 500 and 400 are the mirror's own values: an
     * implementation that quoted [EXTRA_NUMBER_MONTHLY_CENTS] instead of the
     * served cents would produce "US$5/mo" and fail here.
     */
    @Test
    fun `a USD-priced extra is quoted as USD to a workspace billed in CAD`() {
        assertEquals("US\$7/mo", heldNumberPrice(held(cents = 700), company(currency = "cad")))
    }

    /** Its own audience reads a bare dollar sign; "US$7" to a US workspace is noise. */
    @Test
    fun `a workspace billed in USD reads a bare dollar sign`() {
        assertEquals(
            "\$7/mo",
            heldNumberPrice(held(cents = 700), company(currency = "usd", country = "US")),
        )
    }

    /**
     * The property that stops a hardcode satisfying both tests above. "$7/mo"
     * answers the US case perfectly and is exactly the defect.
     */
    @Test
    fun `one string cannot satisfy both audiences`() {
        assertTrue(
            "if both audiences read the same string, the currency half of this " +
                "file is satisfied by the bare-dollar hardcode it exists to catch",
            heldNumberPrice(held(), company(currency = "usd", country = "US")) !=
                heldNumberPrice(held(), company(currency = "cad")),
        )
    }

    /**
     * A price we cannot denominate is a price we do not print — and, downstream,
     * a purchase we do not offer. The alternative is a button that charges an
     * amount we declined to name.
     */
    @Test
    fun `an unpriced or undenominated extra yields no figure and no button`() {
        assertNull(heldNumberPrice(held(cents = null), company()))
        assertNull(heldNumberPrice(held(currency = null), company()))
        assertNull(heldNumberPrice(held(currency = "eur"), company()))
        assertFalse(canBringBack(held(), heldId, price = null))
    }

    // -- the routes back ------------------------------------------------------

    /**
     * EVERY BRANCH ENDS IN SOMETHING TO DO. A hold we pay $1.10/mo of carrier
     * rent on, that the owner cannot end from the product, is worse than the
     * defect it replaced. Iterated over the whole cross-product rather than
     * spot-checked, because the branch that would come back empty is by
     * definition the one nobody thought about.
     */
    @Test
    fun `no combination of answers produces a hold with no way out`() {
        listOf(true, false).forEach { canReinstate ->
            listOf(true, false).forEach { canUpgrade ->
                listOf("US\$7/mo", null).forEach { price ->
                    listOf(9, null).forEach { cap ->
                        listOf(1, null).forEach { included ->
                            val routes = heldNumberRoutes(
                                held(
                                    canReinstate = canReinstate,
                                    canUpgrade = canUpgrade,
                                    maxTotal = cap,
                                    included = included,
                                ),
                                heldId,
                                price,
                            )
                            assertTrue(
                                "reinstate=$canReinstate upgrade=$canUpgrade " +
                                    "price=$price cap=$cap included=$included left the " +
                                    "reader with nothing to do: `$routes`",
                                (routes?.length ?: 0) > 30,
                            )
                        }
                    }
                }
            }
        }
    }

    /** Starter has two ways back and both are named, with the price on the paid one. */
    @Test
    fun `a Starter workspace is offered both routes, and the paid one carries its price`() {
        val routes = heldNumberRoutes(held(), heldId, "US\$7/mo")!!
        assertTrue("got: $routes", routes.contains("paid extra number for US\$7/mo"))
        assertTrue("got: $routes", routes.contains("move to Pro"))
        assertTrue(canBringBack(held(), heldId, "US\$7/mo"))
    }

    /** Pro has no plan above it, so it is never told to move to one. */
    @Test
    fun `a Pro workspace is offered the paid route only`() {
        val routes = heldNumberRoutes(
            held(plan = "pro", canUpgrade = false, maxTotal = null),
            heldId,
            "US\$7/mo",
        )!!
        assertTrue("got: $routes", routes.contains("paid extra number for US\$7/mo"))
        assertFalse(
            "there is no plan above Pro to move to: $routes",
            routes.contains("Pro"),
        )
    }

    /**
     * AT THE HARD CAP, PRO IS THE ONLY ANSWER — and the cap is worked out from
     * three SERVED figures rather than from `STARTER_MAX_TOTAL_NUMBERS`.
     *
     * Nine is the point of the fixture: this client's own cap is 2, so an
     * implementation reaching for a Kotlin constant would print "2 numbers" here
     * and fail.
     */
    @Test
    fun `Starter at its cap names the cap the server sent`() {
        val routes = heldNumberRoutes(
            held(canReinstate = false, included = 3, paidExtras = 6, maxTotal = 9),
            heldId,
            "US\$7/mo",
        )!!
        assertTrue("the served cap must be named: $routes", routes.contains("9 numbers"))
        assertFalse(
            "no paid route may be offered when the server has refused it: $routes",
            routes.contains("US\$7/mo"),
        )
    }

    /**
     * BELOW THE CAP AND STILL REFUSED, the client says it does not know why.
     *
     * `can_reinstate` is false for several reasons this response cannot show — a
     * paused plan, a scheduled plan change, an environment with no extra-number
     * price — and the plan switch is refused for the first two as well. Naming
     * Pro here would draw the only pressable route to a 409 on the whole screen,
     * which is the objection the cancellation offer already records for its own
     * paused branch.
     *
     * FOUR HELD AGAINST A CAP OF NINE, and the pair of numbers is the assertion.
     * A first version of this used 1 and 9, which every wrong cap predicate also
     * satisfies — an implementation testing `included + paid_extras >= 2`
     * (Starter's real cap, hardcoded) passed it while claiming "tops out at 9"
     * for any workspace holding two. Four is over that literal and under the
     * served figure, so only a predicate reading `max_total` gets here.
     */
    @Test
    fun `a refusal we cannot explain names the screen rather than a route`() {
        val routes = heldNumberRoutes(
            held(canReinstate = false, included = 3, paidExtras = 1, maxTotal = 9),
            heldId,
            "US\$7/mo",
        )!!
        assertTrue("got: $routes", routes.contains("under Settings › Billing"))
        assertFalse("no route may be promised: $routes", routes.contains("Pro"))
        assertFalse("and no price: $routes", routes.contains("US\$7/mo"))
    }

    /**
     * A price the server did not name closes the paid route, even when the
     * server said the route is open. Both halves are required: a button reading
     * "Bring it back · null" is not a control.
     */
    @Test
    fun `no price means no paid route, whatever can_reinstate says`() {
        val routes = heldNumberRoutes(held(canReinstate = true), heldId, price = null)!!
        assertFalse("got: $routes", routes.contains("paid extra"))
        assertFalse(canBringBack(held(canReinstate = true), heldId, price = null))
    }

    // -- the upgrade's own sentence -------------------------------------------

    /**
     * An upgrade is one of the two routes out of a hold, so it has to REPORT.
     *
     * Somebody who pays the Pro difference specifically to get their second line
     * working used to read "You're on Pro now." and had to go to another screen
     * to find out whether it had worked.
     */
    @Test
    fun `an upgrade that freed a number names it`() {
        val message = changePlanMessage(
            ChangePlanResult(
                plan = "pro",
                effective = "now",
                reinstated = listOf(HeldNumber(id = "n0", number_e164 = "+14155550102")),
            ),
        )
        assertEquals("You're on Pro now, and (415) 555-0102 is back.", message)
    }

    /** An ordinary upgrade freed nothing and says nothing extra about it. */
    @Test
    fun `an ordinary upgrade says only that it happened`() {
        assertEquals(
            "You're on Pro now.",
            changePlanMessage(ChangePlanResult(plan = "pro", effective = "now")),
        )
    }

    /** A scheduled downgrade is a different sentence and is not about numbers. */
    @Test
    fun `a scheduled switch keeps its own sentence`() {
        assertEquals(
            "Switch to Starter scheduled for the end of this period.",
            changePlanMessage(ChangePlanResult(plan = "starter", effective = "period_end")),
        )
    }

    /**
     * A row that came back without a name is still counted. Naming only the
     * spellable ones would under-report what the owner just paid for.
     */
    @Test
    fun `unnamed reinstatements are counted rather than dropped`() {
        val message = changePlanMessage(
            ChangePlanResult(
                plan = "pro",
                effective = "now",
                reinstated = listOf(
                    HeldNumber(id = "n0", number_e164 = "+14155550102"),
                    HeldNumber(id = "n1", number_e164 = null),
                ),
            ),
        )
        assertTrue("got: $message", message.contains("2 held numbers are back"))
    }

    // -- the wiring, which no unit test can render ----------------------------

    /**
     * The old sentence is GONE from the numbers screen, the note is asked with
     * the field the server's own reason switches on, and the routes are drawn.
     *
     * A source scan because a unit test cannot render Compose. It says nothing
     * about what is painted — only that the composable calls the functions this
     * file spent thirty assertions on, rather than a fourth copy of the copy.
     */
    @Test
    fun `the numbers screen asks these functions rather than guessing`() {
        val src = readMainSource("features/settings/NumbersSection.kt")
        assertFalse(
            "the payment-method sentence is still on the numbers screen. It is " +
                "false for the #523 hold and sends the owner to a portal that " +
                "cannot fix an allowance",
            src.contains("Update your payment method under"),
        )
        assertTrue(
            "the suspended branch must call suspendedNumberNote(subscription_status, …)",
            src.contains("suspendedNumberNote(") && src.contains("company.subscription_status"),
        )
        assertTrue(
            "…and draw the routes and the buy-back button under it",
            src.contains("HeldNumberActions(scope, company, number, held, onChanged)"),
        )
        assertTrue(
            "the read must be gated on a suspended row existing — a workspace " +
                "holding nothing must never pay for the round trip",
            src.contains("company.numbers.count { it.status == NumberStatus.SUSPENDED }"),
        )
    }

    /**
     * A HELD PORTED LINE HAS TO RENDER AT ALL.
     *
     * The card filter admitted `source == "provisioned"` or `status == active`.
     * A ported number that goes on hold is neither, so it fell through both arms
     * and appeared nowhere — no card, and the port tracker below only covers a
     * port still in flight. The oldest-first restore makes this the likely case
     * rather than a corner: the number a workspace ported in most recently is
     * exactly the one held.
     */
    @Test
    fun `a suspended number renders whatever its source`() {
        // THE FILTER BLOCK IS EXTRACTED rather than the file searched, and that
        // is this guard's second draft. Scanning the whole file for the status
        // name proved nothing: `NumberStatus.SUSPENDED` also appears in the
        // `when` arm that draws the note and in the read gate above, so a
        // mutation that took the arm out of the FILTER left the phrase in the
        // file twice over and the assertion passed. A guard that cannot see
        // which occurrence it found is a spelling check.
        val src = readMainSource("features/settings/NumbersSection.kt")
        val marker = "val cards = data.numbers.filter { number ->"
        assertTrue("the card filter was renamed; point this guard at it", src.contains(marker))
        val filter = src.substringAfter(marker).substringBefore("}")
        assertTrue(
            "the card filter must admit a suspended row regardless of source, or a " +
                "held ported line is invisible in this app — no card, and the port " +
                "tracker below only covers a port still in flight. Filter was: $filter",
            filter.contains("NumberStatus.SUSPENDED"),
        )
    }

    /**
     * The billing screen reports what an upgrade brought back — and, deliberately,
     * still adds no card of its own.
     *
     * `PauseOfferTest` holds the standing rule that nothing new renders between
     * landing on that screen and the button that leaves. A held-number card
     * carrying "move to Pro" and "buy an extra number" is exactly the shape that
     * rule forbids, which is why the CONTROLS live on the numbers screen. This
     * assertion is here so that reason is recorded where somebody tempted to add
     * one will read it — and it survived #523 giving that screen something to
     * say, because what was added is a line on the plan card, not a card.
     */
    @Test
    fun `the billing screen reports the upgrade and grows no card`() {
        val src = readMainSource("features/settings/BillingSection.kt")
        assertTrue(
            "the plan-change toast must report what the upgrade brought back",
            src.contains("changePlanMessage(result)"),
        )
        assertFalse(
            "a held-numbers card on the billing screen is height between a thumb " +
                "and the exit — see PauseOfferTest. The controls belong on the " +
                "numbers screen",
            src.contains("HeldNumbersCard"),
        )
    }

    // -- #523 follow-up: the screen the notice actually points at -------------

    /**
     * THE DEFECT. `noticeHeldNumbers` mails and pushes `/settings/billing`, and
     * the push body is "Open Loonext to see which number, and how to bring it
     * back" — so this is the screen an owner arrives on with exactly one
     * question. It had nothing to say. The plan card listed an allowance and
     * never mentioned that the workspace was over it, and the only surface that
     * explained the hold was a screen the reader had not been sent to.
     */
    @Test
    fun `the plan note names which line is down`() {
        val note = heldNumbersPlanNote(listOf("+14155550102"))!!
        assertTrue("the number has to be named: $note", note.contains("(415) 555-0102"))
        assertTrue("and the cause: $note", note.contains("covers fewer numbers"))
    }

    /**
     * The reassurance half, in BOTH grammars, because this screen is the one
     * that can be about three numbers at once.
     *
     * A held number still receives. An owner who reads "on hold" and concludes
     * the line is dead tells customers to use a different number, or starts a
     * port they did not need — and the words that stop that are the same words
     * the numbers screen uses, from [heldNumberKept], so the two screens cannot
     * drift into describing one state two ways.
     */
    @Test
    fun `the plan note says what has NOT happened, however many are held`() {
        val one = heldNumbersPlanNote(listOf("+14155550102"))!!
        assertTrue("got: $one", one.contains("hasn't been given up"))
        assertTrue("got: $one", one.contains("texts and calls still reach it"))
        assertTrue("got: $one", one.contains("is on hold"))

        val two = heldNumbersPlanNote(listOf("+14155550102", "+14155550103"))!!
        assertTrue("got: $two", two.contains("haven't been given up"))
        assertTrue("got: $two", two.contains("texts and calls still reach them"))
        assertTrue("got: $two", two.contains("are on hold"))

        listOf(one, two).forEach { note ->
            assertFalse(
                "nothing was released and neither grammar may say so: $note",
                note.contains("released") || note.contains("given back"),
            )
        }
    }

    /**
     * Named where we can spell them, counted where we cannot — the same
     * judgement the upgrade's own sentence makes, from the same function.
     * Naming only the spellable ones would under-report the state to the one
     * person who has to act on it.
     */
    @Test
    fun `the plan note names every held number it can, and counts the rest`() {
        val both = heldNumbersPlanNote(listOf("+14155550102", "+14155550103"))!!
        assertTrue("both spellable rows must be named: $both", both.contains("(415) 555-0102 and (415) 555-0103"))
        val partial = heldNumbersPlanNote(listOf("+14155550102", null))!!
        assertTrue(
            "a row with no digits is still a number on hold. Naming only the one we " +
                "can spell would tell the owner ONE line is down when two are: $partial",
            partial.contains("2 held numbers"),
        )
        assertTrue(
            "a single row with no digits still has to be described",
            heldNumbersPlanNote(listOf(null))!!.contains("One of your numbers"),
        )
    }

    /**
     * IT SELLS NOTHING, and that is the property that keeps it a line rather
     * than the card `PauseOfferTest` forbids.
     *
     * The buy-back is a per-number consent surface with a price on the button and
     * it already exists on the number's own card; a second one here would be a
     * money control above the exit. The upgrade needs no words either — "Upgrade
     * to Pro" is the control directly under this sentence, and naming a plan the
     * server may refuse (a pause, a scheduled change) would draw the only
     * pressable route on the screen to a 409.
     */
    @Test
    fun `the plan note quotes no price and promises no plan`() {
        listOf(
            heldNumbersPlanNote(listOf("+14155550102"))!!,
            heldNumbersPlanNote(listOf("+14155550102", "+14155550103"))!!,
        ).forEach { note ->
            assertTrue(
                "the billing screen has not asked what an extra number costs, so it " +
                    "may not name a figure: $note",
                Regex("\\$[0-9]").find(note) == null,
            )
            assertFalse(
                "naming Pro here promises a switch the server refuses for a paused " +
                    "or scheduled workspace — the control on this card is already " +
                    "gated on the pause read: $note",
                note.contains("Pro"),
            )
            assertTrue(
                "and it must say where the controls are, because unlike the numbers " +
                    "screen they do not render underneath it: $note",
                note.contains("Numbers screen"),
            )
        }
    }

    /** Nothing held is the answer on almost every load, and it draws nothing. */
    @Test
    fun `a workspace holding nothing gets no note`() {
        assertNull(heldNumbersPlanNote(emptyList()))
    }

    /**
     * The wiring, which no unit test can render: the note is asked with the
     * SUSPENDED rows off the company view, and only where the cause is the
     * allowance.
     *
     * `subscriptionActive` is the field the route splits `over_plan_allowance`
     * from `subscription_inactive` on, so this is the server's own split rather
     * than a second opinion about it. Without it a past-due workspace — every
     * number suspended, the amber banner at the top already saying why — would be
     * told a second, invented cause on the same screen.
     */
    @Test
    fun `the billing screen asks the note with the rows and the right cause`() {
        val src = readMainSource("features/settings/BillingSection.kt")
        assertTrue(
            "the plan card must draw the note from the company view's own rows — a " +
                "read here would be a round trip for something already in hand, and " +
                "one that could disagree with the numbers screen",
            src.contains("heldNumbersPlanNote(") &&
                src.contains("it.status == NumberStatus.SUSPENDED"),
        )
        assertTrue(
            "the note must be gated on the subscription being live, or a failed " +
                "payment gets blamed on the allowance",
            src.contains("if (canManage && company.subscriptionActive)"),
        )
        assertTrue(
            "and the reader must be able to reach the controls, which are a section " +
                "away: a pointer somebody has to navigate to by hand is most of the " +
                "way back to the defect",
            src.contains("onOpenNumbers?.let"),
        )
    }

    /** ...and the host is the only thing that moves between sections (#200). */
    @Test
    fun `the host wires the numbers route, because a section cannot`() {
        val src = readMainSource("features/settings/SettingsHome.kt")
        assertTrue(
            "BillingSection takes onOpenNumbers and only SettingsHome can supply it",
            src.contains("onOpenNumbers = { onOpenSection(SettingsSection.Numbers) }"),
        )
    }

    // -- #523 follow-up: giving a held number up ------------------------------

    /**
     * THE DEFECT. The whole action row was gated on `status == ACTIVE`, so
     * Release never rendered for a held number and a mobile-only owner could
     * neither use the line nor end it. Releasing it is the only way to stop us
     * paying its carrier rent, the only way to free the Starter slot, and the
     * only way to satisfy the Pro-to-Starter downgrade gate.
     *
     * `DELETE /v1/numbers/:id` has always allowed it — it refuses only a row that
     * is already released — so this was a control withheld for a reason the API
     * never had.
     */
    @Test
    fun `a held number can be given up`() {
        // THE MESSAGE BELONGS ON THIS ASSERTION, and it was on the next one. The
        // load-bearing half of this test is the SUSPENDED case — the half that
        // did not work — and breaking the gate failed it with a bare
        // AssertionError and no text, leaving whoever broke it to work out from
        // a line number which of the two properties they had lost. A silent
        // failure on the assertion that matters is half a guard.
        assertTrue(
            "a held number could not be given up from this phone at all: releasing " +
                "it is the only way to stop us paying its carrier rent, the only way " +
                "to free the Starter slot, and the only way to satisfy the " +
                "Pro-to-Starter downgrade gate",
            mayReleaseNumber(NumberStatus.SUSPENDED, "+14155550102", subscriptionActive = true),
        )
        assertTrue(
            "and a working one still can, which is the case that already worked",
            mayReleaseNumber(NumberStatus.ACTIVE, "+14155550102", subscriptionActive = true),
        )
    }

    /**
     * THE SUBSCRIPTION TERM IS ABOUT HELD ROWS ONLY, which is the half of the
     * agreed rule the other two clients are most likely to copy wrongly — a
     * blanket `subscriptionActive` gate reads as tidier and takes the control
     * away from an owner whose line is still working.
     *
     * `suspendCompanyNumbers` suspends the active rows when a subscription
     * lapses, so this is the window between the lapse and that write. The line
     * works; giving it up is the owner's call, and nothing about a payment makes
     * that press less informed.
     */
    @Test
    fun `a working line is releasable whatever the subscription is doing`() {
        assertTrue(
            "the subscription term guards the SUSPENDED arm and nothing else; " +
                "applying it to a working number withholds a control for a reason " +
                "that is not about that number",
            mayReleaseNumber(NumberStatus.ACTIVE, "+14155550102", subscriptionActive = false),
        )
    }

    /**
     * ...BUT NOT WHILE THE PAYMENT IS THE PROBLEM.
     *
     * A past-due workspace has every number suspended for a cause the card fixes.
     * Putting an irreversible "give it up for good" in front of somebody whose
     * real problem is a declined payment is a press made in a panic that nothing
     * can undo — and `subscriptionActive` is the same field the server splits
     * `over_plan_allowance` from `subscription_inactive` on, so this admits
     * exactly the #523 hold and nothing else.
     */
    @Test
    fun `a suspension that belongs to the payment offers no release`() {
        assertFalse(
            "a past-due workspace has every number suspended, and the fix is the " +
                "card. Offering to give one up for good as the way out of a declined " +
                "payment is a press made in a panic that nothing can undo",
            mayReleaseNumber(NumberStatus.SUSPENDED, "+14155550102", subscriptionActive = false),
        )
    }

    /** Nothing else is releasable, including a row with no digits to type back. */
    @Test
    fun `nothing else is offered a release`() {
        listOf(
            NumberStatus.RELEASED,
            NumberStatus.PROVISIONING,
            NumberStatus.PROVISION_FAILED,
        ).forEach { status ->
            assertFalse(
                "$status must not be releasable",
                mayReleaseNumber(status, "+14155550102", subscriptionActive = true),
            )
        }
        assertFalse(
            "the dialog asks the reader to type the number back, which nobody can " +
                "do for a row that has none",
            mayReleaseNumber(NumberStatus.ACTIVE, null, subscriptionActive = true),
        )
    }

    /**
     * THE SENTENCE THAT WOULD HAVE COST SOMEBODY A NUMBER.
     *
     * The shipped body ends "a number is included, so you can set up a new one
     * here afterward". A workspace on hold is over its allowance by definition,
     * so releasing brings it back TO the allowance and no further — somebody who
     * believed that would give up the number they had and then be charged for an
     * extra, or refused outright at the Starter cap.
     */
    @Test
    fun `the held release never promises a free replacement`() {
        val held = releaseNumberBody(heldOverAllowance = true)
        assertFalse(
            "releasing a held number does not leave an included number to claim: $held",
            held.contains("set up a new one"),
        )
        assertTrue(
            "and the reader must be told this is not the only way out, in front of " +
                "the irreversible press: $held",
            held.contains("rather than by bringing it back"),
        )
        assertTrue("the permanence still has to be said: $held", held.contains("can't get the same number back"))

        // The working-number body is untouched, which is the half that was right.
        val working = releaseNumberBody(heldOverAllowance = false)
        assertTrue(working.contains("set up a new one here afterward"))
        assertTrue(
            "the two bodies must actually differ, or the branch is decoration",
            working != held,
        )
    }

    /**
     * The wiring: the row is no longer gated as a whole, and the dialog is TOLD
     * which state it is confirming rather than deciding again.
     *
     * The one thing worse than no Release button on a held number is one whose
     * confirmation describes a different number.
     */
    @Test
    fun `the numbers screen asks the gate rather than testing the status itself`() {
        val src = readMainSource("features/settings/NumbersSection.kt")
        assertTrue(
            "the release control must be gated by mayReleaseNumber",
            src.contains("mayReleaseNumber(number.status, number.number_e164"),
        )
        assertTrue(
            "and drawn from it, not from the active-only row gate",
            src.contains("if (releasable && canRelease)"),
        )
        assertTrue(
            "the dialog must be told which state it is confirming",
            src.contains("heldOverAllowance = heldOverAllowance"),
        )
        assertTrue(
            "and its words must come from the shared copy, which is where the false " +
                "sentence was fixed",
            src.contains("body = releaseNumberBody(heldOverAllowance)"),
        )
    }

    // -- #523 follow-up: the tracker beside the card --------------------------

    /**
     * THIS IS DAMAGE #523 DID, not a gap it left, which is why it is pinned
     * hardest.
     *
     * Admitting SUSPENDED rows to the card filter (above) gave a held ported line
     * a card saying it cannot send. The tracker beside it was left alone, and a
     * completed transfer drew "Ported" in the POSITIVE tone over a filled
     * stepper. One screen then said both "this line is on hold and cannot send"
     * and "Ported, all done" about one number. Before that change there was one
     * wrong story; two contradicting ones are worse — the reader cannot tell
     * which half to act on, and the cheerful half is the easier one to believe.
     */
    @Test
    fun `a held line is not called Ported by the tracker beside it`() {
        val (label, tone) = portPill(PortStatus.PORTED, heldLine = true)
        assertEquals(
            "the card above says this line cannot send; the tracker may not answer " +
                "the same question with 'Ported'",
            "On hold",
            label,
        )
        assertEquals(
            "and a positive pill is the loudest claim on the card — it reads as an " +
                "all-clear over a number that cannot send",
            PillTone.Warn,
            tone,
        )
    }

    /**
     * THE PROPERTY, not the one case. Whatever the transfer is doing, a line that
     * cannot send may not be reported as good news — the held branch has to come
     * FIRST, and a later branch that overtakes it is exactly how this defect
     * shipped.
     */
    @Test
    fun `no transfer state reports success over a line that cannot send`() {
        listOf(
            PortStatus.DRAFT,
            PortStatus.SUBMITTED,
            PortStatus.IN_PROCESS,
            PortStatus.EXCEPTION,
            PortStatus.FOC_DATE_CONFIRMED,
            PortStatus.ACTIVATION_IN_PROGRESS,
            PortStatus.PORTED,
            PortStatus.CANCEL_PENDING,
            "some-status-telnyx-added-later",
        ).forEach { status ->
            val (label, tone) = portPill(status, heldLine = true)
            assertTrue(
                "$status drew a positive pill over a held line",
                tone != PillTone.Positive,
            )
            assertEquals("$status must defer to the hold", "On hold", label)
        }
    }

    /** ...and an ordinary transfer still reports itself, or the fix is a blackout. */
    @Test
    fun `a transfer whose line works keeps its own pill`() {
        assertEquals("Ported" to PillTone.Positive, portPill(PortStatus.PORTED, false))
        assertEquals("Needs attention" to PillTone.Warn, portPill(PortStatus.EXCEPTION, false))
        assertEquals("Cancelling" to PillTone.Neutral, portPill(PortStatus.CANCEL_PENDING, false))
        assertEquals(
            "an in-flight transfer names the step it has reached",
            "Submitted" to PillTone.Warn,
            portPill(PortStatus.SUBMITTED, false),
        )
    }

    /**
     * The hold is read off the row the transfer DELIVERED, matched on the E.164 —
     * the one identifier both rows are guaranteed to agree on after cutover.
     */
    @Test
    fun `the tracker reads the hold from the line its transfer delivered`() {
        assertTrue(
            "a suspended row for this transfer's number IS the hold the card above " +
                "is describing",
            portLineIsHeld(portedE164, listOf(numberRow(NumberStatus.SUSPENDED))),
        )
        assertFalse(
            "a working line is not on hold, and saying so would invent the very " +
                "contradiction this closes",
            portLineIsHeld(portedE164, listOf(numberRow(NumberStatus.ACTIVE))),
        )
        assertFalse(
            "a transfer still with the carrier has delivered no row: claim_port_slot " +
                "inserts it with no number_e164 and P6 writes the number at cutover",
            portLineIsHeld(portedE164, emptyList()),
        )
        assertFalse(
            "some other number's hold is not this transfer's story",
            portLineIsHeld("+14165550111", listOf(numberRow(NumberStatus.SUSPENDED))),
        )
    }

    /**
     * A RELEASED ROW IS NOT A HOLD, in both directions.
     *
     * A number that was given up has been given up; a hold note on it would be a
     * note about a number nobody holds. And a workspace that released a line and
     * later transferred the same one back has two rows carrying one E.164 — the
     * dead one must not mask the live one, or the tracker goes back to claiming
     * "Ported" over a held line.
     */
    @Test
    fun `a released row is neither the hold nor a mask for it`() {
        assertFalse(
            "a released number is gone, not held",
            portLineIsHeld(portedE164, listOf(numberRow(NumberStatus.RELEASED))),
        )
        assertTrue(
            "the released row must be skipped, not matched first",
            portLineIsHeld(
                portedE164,
                listOf(
                    numberRow(NumberStatus.RELEASED, id = "the-old-one"),
                    numberRow(NumberStatus.SUSPENDED, id = "the-one-they-hold"),
                ),
            ),
        )
    }

    /**
     * The note settles the contradiction instead of joining it: the transfer
     * finished AND the line is held, in that order, with no second opinion about
     * why.
     */
    @Test
    fun `the tracker's note keeps the true half and drops the false one`() {
        val note = portHoldNote()
        assertTrue(
            "the stepper above is still full and correct — the note has to say what " +
                "that means, or the card looks like it is arguing with itself: $note",
            note.contains("transfer finished"),
        )
        assertTrue(
            "and it must stop the reader concluding the transfer failed, which is " +
                "the moment somebody calls their old carrier back: $note",
            note.contains("not a transfer one"),
        )
        assertTrue(
            "the reassurance has to be the SHARED clause; a second copy is a second " +
                "chance to lose the 'still reach it' half in an edit: $note",
            note.contains(heldNumberKept(many = false)),
        )
        assertTrue(
            "and it must point at the card that carries the ways back, because this " +
                "one carries none: $note",
            note.contains("Its own card"),
        )
    }

    /**
     * The tracker names NO cause and NO price. Both belong to the number's own
     * card, where the server has actually been asked; a second account of one
     * hold, derived beside it, is the drift that produced this defect.
     */
    @Test
    fun `the tracker's note asserts no cause of its own`() {
        val note = portHoldNote()
        assertFalse(
            "the allowance is suspendedNumberNote's answer, from the server's own " +
                "reason: $note",
            note.contains("covers fewer numbers"),
        )
        assertFalse(
            "and blaming the card here is the sentence #523 spent a file removing: " +
                "$note",
            note.contains("payment method"),
        )
        assertTrue(
            "a figure the tracker never asked for is a figure it may not print: $note",
            Regex("\\$[0-9]").find(note) == null,
        )
    }

    /**
     * The wiring, which no unit test can render: the composable asks these
     * functions rather than testing the port row itself, and the unconditional
     * positive pill is gone from the file.
     */
    @Test
    fun `the tracker asks the gate rather than trusting the transfer`() {
        val src = readMainSource("features/settings/PortCards.kt")
        assertFalse(
            "the unconditional positive pill IS the defect: a completed transfer " +
                "said 'Ported' whatever had since become of the line it delivered",
            src.contains("StatusPill(\"Ported\", PillTone.Positive)"),
        )
        assertTrue(
            "the pill must be decided by portPill(status, heldLine)",
            src.contains("portPill(port.status, heldLine)"),
        )
        assertTrue(
            "the hold must be resolved from the numbers list, not from the port row",
            src.contains("portLineIsHeld(port.phone_e164, numbers)"),
        )
        assertTrue(
            "and the note must be drawn, or the pill changes and nothing explains it",
            src.contains("portHoldNote()"),
        )
    }

    /**
     * ...and the trackers are handed the SAME rows the cards above were built
     * from. Two reads of the numbers list can land a moment apart, and a card and
     * a tracker disagreeing about one line is the whole defect.
     */
    @Test
    fun `the numbers screen hands the trackers the rows the cards were built from`() {
        val src = readMainSource("features/settings/NumbersSection.kt")
        assertTrue(
            "PortsBlock must be given data.numbers — the list the cards render from",
            src.contains("PortsBlock(scope, company, data.ports, data.numbers"),
        )
    }

    // -- reading the other language -------------------------------------------

    /**
     * A file from `apps/api/src`, from wherever Gradle started.
     *
     * FAILS rather than skips when it is not there. A cross-language guard that
     * quietly passes because it could not find the other language reads as
     * protection in the file and provides none.
     */
    private fun apiSource(relative: String): String {
        listOf("", "../../", "../../../").forEach { prefix ->
            val f = File("${prefix}apps/api/src/$relative")
            if (f.exists()) return f.readText()
        }
        fail(
            "apps/api/src/$relative not found from ${File(".").absolutePath}. This " +
                "guard compares the Kotlin client against the route it renders, so it " +
                "fails rather than skipping",
        )
        error("unreachable")
    }

    private fun readMainSource(relative: String): String {
        listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        ).forEach { base ->
            val f = File(base, relative)
            if (f.exists()) return f.readText()
        }
        fail("source not found: $relative (cwd=${File(".").absolutePath})")
        error("unreachable")
    }

    /**
     * Guards the fixtures above: a response from a Worker that predates the route
     * must decode to "nothing to say" rather than failing the numbers screen.
     */
    @Test
    fun `the payload decodes with everything absent`() {
        val empty = HeldNumbers()
        assertNull(empty.reason)
        assertTrue(empty.held.isEmpty())
        assertFalse(empty.can_reinstate)
        assertNull(heldNumberRoutes(empty, heldId, "US\$7/mo"))
        assertNotNull(heldNumberRoutes(held(), heldId, "US\$7/mo"))
    }
}
