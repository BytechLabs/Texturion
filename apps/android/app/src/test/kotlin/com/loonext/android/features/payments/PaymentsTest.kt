package com.loonext.android.features.payments

import com.loonext.android.features.settings.BillingCurrency
import com.loonext.android.features.settings.formatMoney
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #224 — the halves of the port the generated vectors deliberately do not
 * cover.
 *
 * `scripts/generate-parity-vectors.mjs` pins the RULES (state, bounds,
 * readiness) and excludes copy and presentation on purpose. What is left is
 * still where a hand-port goes wrong, and each test below names the failure it
 * exists to prevent rather than the function it calls.
 */
class PaymentsTest {

    private val usd = BillingCurrency.USD
    private val cad = BillingCurrency.CAD

    // --- parseAmountToCents -------------------------------------------------

    @Test
    fun `a typed amount becomes cents through integers`() {
        assertEquals(25_000, Payments.parseAmountToCents("250"))
        assertEquals(25_050, Payments.parseAmountToCents("250.50"))
        // One decimal place means TENTHS of a dollar, not cents. "250.5" is
        // $250.50, and a port that read the fraction as-is would bill $250.05.
        assertEquals(25_050, Payments.parseAmountToCents("250.5"))
        assertEquals(100, Payments.parseAmountToCents("1"))
        assertEquals(1, Payments.parseAmountToCents("0.01"))
    }

    @Test
    fun `19 dollars 99 is exactly 1999 cents`() {
        // THE case the arithmetic exists for. 19.99 as a double times 100 is
        // 1998.9999999999998, and rounding that is a coin-flip nobody should
        // take with somebody's bill.
        assertEquals(1999, Payments.parseAmountToCents("19.99"))
        // Escaped, because a bare `$` opens a string template in Kotlin — the
        // same class of hand-port trap as `\b` being a backspace here.
        assertEquals(1999, Payments.parseAmountToCents("\$19.99"))
    }

    @Test
    fun `decoration a thumb adds is forgiven`() {
        // A dollar sign and a thousands separator are what somebody types
        // without thinking. Refusing them would be pedantry at the one keyboard
        // this feature is used from.
        assertEquals(120_000, Payments.parseAmountToCents("\$1,200"))
        assertEquals(25_000, Payments.parseAmountToCents(" 250 "))
    }

    @Test
    fun `anything that is not a number is refused rather than guessed`() {
        // A silently-misread amount is the one error this feature cannot afford,
        // so the shape is strict even though the decoration is not.
        for (input in listOf("", "   ", "abc", "25.999", "1.2.3", "-50", "1e3", ".5", "250-")) {
            assertNull("'$input' should not parse", Payments.parseAmountToCents(input))
        }
    }

    @Test
    fun `a fat-fingered number never wraps into a small one`() {
        // The overflow guard is load-bearing, not defensive: a value that
        // wrapped and happened to land between the floor and the ceiling would
        // be a bill for a figure nobody typed. Refusing is the only safe answer,
        // and the ceiling check downstream never sees it.
        assertNull(Payments.parseAmountToCents("999999999999999999999999999999"))
        assertNull(Payments.parseAmountToCents("99999999"))
        // Still a number, still refused — but by the CEILING, with a sentence.
        assertEquals(Payments.MAX_CENTS + 100, Payments.parseAmountToCents("25001"))
        assertEquals(
            PaymentAmountProblem.TOO_LARGE,
            Payments.amountProblem(Payments.parseAmountToCents("25001")!!),
        )
    }

    @Test
    fun `a fraction of a cent cannot be typed at all`() {
        // Why the Int-typed [Payments.amountProblem] can never answer NOT_WHOLE
        // on this client: the parse refuses a third decimal place before
        // anything downstream sees it.
        assertNull(Payments.parseAmountToCents("1.234"))
        assertNull(Payments.parseAmountToCents("10.005"))
    }

    // --- the copy that carries money ---------------------------------------

    @Test
    fun `a refusal names the bound in the reader's own money`() {
        // Not a typed price. A Canadian workspace's Stripe account settles in
        // CAD, and "$1" typed as a literal would be the #522 defect on the one
        // sentence that tells somebody what they may charge.
        assertEquals(
            "The smallest payment we can take is ${formatMoney(Payments.MIN_CENTS, cad)}.",
            Payments.amountProblemCopy(PaymentAmountProblem.TOO_SMALL, cad),
        )
        assertEquals(
            "The largest payment we can take by text is " +
                "${formatMoney(Payments.MAX_CENTS, usd)}.",
            Payments.amountProblemCopy(PaymentAmountProblem.TOO_LARGE, usd),
        )
    }

    @Test
    fun `every amount problem has a sentence, and none of it is a code`() {
        for (problem in PaymentAmountProblem.entries) {
            val copy = Payments.amountProblemCopy(problem, usd)
            assertTrue("$problem has no copy", copy.length > 20)
            assertTrue("$problem reads like a code", copy.contains(" "))
            assertEquals(copy.trim(), copy)
        }
    }

    @Test
    fun `every state has exactly one word`() {
        for (state in PaymentState.entries) {
            val label = Payments.label(state)
            assertTrue("$state has no label", label.isNotBlank())
            assertFalse("$state's label is a sentence", label.contains(" "))
        }
    }

    // --- the SMS ------------------------------------------------------------

    @Test
    fun `the text names the business first and the link last`() {
        val text = Payments.requestSms(
            businessName = "  Maple Plumbing  ",
            amountCents = 25_000,
            currency = cad,
            description = "  Deposit  ",
            url = "https://app.loonext.com/pay/abc123",
        )
        assertEquals(
            "Maple Plumbing: ${formatMoney(25_000, cad)} for Deposit.\n" +
                "Pay securely here:\nhttps://app.loonext.com/pay/abc123",
            text,
        )
        // A payment link from an unnamed sender is a phishing text, and the
        // customer is right to think so.
        assertTrue(text.startsWith("Maple Plumbing:"))
        // On its own line, so every phone linkifies all of it.
        assertTrue(text.endsWith("\nhttps://app.loonext.com/pay/abc123"))
        // Not what a carrier's spam filter is looking for.
        assertFalse(text.lowercase().contains("click here"))
        assertFalse(text.contains("!"))
    }

    // --- Stripe requirements ------------------------------------------------

    @Test
    fun `a Stripe requirement identifier becomes something a plumber can read`() {
        assertEquals(
            "Photo ID for the business owner",
            Payments.requirementCopy("individual.verification.document"),
        )
        assertEquals("Your bank account details", Payments.requirementCopy("external_account"))
    }

    @Test
    fun `an identifier nobody wrote copy for is still shown`() {
        // Dropping it would leave an owner with an outstanding requirement they
        // cannot see, which is the state where somebody concludes the product is
        // broken. The fallback strips whose-document-is-it and the separators.
        assertEquals(
            "Political exposure",
            Payments.requirementCopy("individual.political_exposure"),
        )
        assertEquals("Ownership declaration", Payments.requirementCopy("ownership_declaration"))
        // Only a LEADING owner prefix goes; one in the middle is part of the name.
        assertEquals(
            "Directors individual name",
            Payments.requirementCopy("directors.individual.name"),
        )
    }

    @Test
    fun `an empty identifier does not crash the settings card`() {
        assertEquals("", Payments.requirementCopy(""))
    }

    // --- what the strip shows ----------------------------------------------

    @Test
    fun `a live request is always worth showing`() {
        // However old. A request nobody has paid is the whole point of the strip.
        val ancient = Instant.parse("2020-01-01T00:00:00Z").toString()
        assertTrue(
            Payments.isWorthShowing(PaymentState.REQUESTED, ancient, null, NOW),
        )
    }

    @Test
    fun `a settled request drops off after a week`() {
        val sixDays = Instant.ofEpochMilli(NOW - 6L * DAY).toString()
        val eightDays = Instant.ofEpochMilli(NOW - 8L * DAY).toString()
        assertTrue(Payments.isWorthShowing(PaymentState.PAID, sixDays, sixDays, NOW))
        assertFalse(Payments.isWorthShowing(PaymentState.PAID, eightDays, eightDays, NOW))
        // Dated from when it was PAID, not from when it was asked for: a deposit
        // requested in March and paid yesterday is yesterday's news.
        assertTrue(Payments.isWorthShowing(PaymentState.PAID, eightDays, sixDays, NOW))
    }

    @Test
    fun `a row we cannot date is shown rather than hidden`() {
        // The rows that can be settled include DISPUTED, and a chargeback the
        // crew never sees is the one failure this strip exists to prevent.
        assertTrue(Payments.isWorthShowing(PaymentState.DISPUTED, "not-a-date", null, NOW))
        assertTrue(Payments.isWorthShowing(PaymentState.PAID, null, null, NOW))
    }

    // --- the account model --------------------------------------------------

    @Test
    fun `a readiness this build has never heard of falls back to the booleans`() {
        // Both constants would be wrong in a way that costs somebody money:
        // NOT_CONNECTED hides the ask from a workspace that can charge, READY
        // offers it to one that cannot and turns every send into a 409.
        val account = PayoutAccount(
            connected = true,
            readiness = "awaiting_something_invented_next_quarter",
            charges_enabled = true,
            details_submitted = true,
        )
        assertEquals(PayoutReadiness.READY, account.state)
        assertTrue(account.canCharge)

        val notYet = account.copy(charges_enabled = false)
        assertEquals(PayoutReadiness.PENDING_VERIFICATION, notYet.state)
        assertFalse(notYet.canCharge)
    }

    @Test
    fun `the server's own readiness is used when we recognise it`() {
        val account = PayoutAccount(
            connected = true,
            readiness = PayoutReadiness.RESTRICTED.wire,
            charges_enabled = false,
            details_submitted = true,
            disabled_reason = "requirements.past_due",
        )
        assertEquals(PayoutReadiness.RESTRICTED, account.state)
    }

    @Test
    fun `the amount is quoted in what the account settles in`() {
        // Stripe's default_currency first, the account's COUNTRY second, never a
        // platform default. A Canadian account quoted in USD would settle at
        // Stripe's conversion rate and the business would receive less than the
        // number they typed.
        assertEquals(
            BillingCurrency.CAD,
            PayoutAccount(connected = true, currency = "cad", country = "US").billingCurrency,
        )
        assertEquals(
            BillingCurrency.CAD,
            PayoutAccount(connected = true, currency = null, country = "CA").billingCurrency,
        )
        assertEquals(
            BillingCurrency.USD,
            PayoutAccount(connected = true, currency = null, country = null).billingCurrency,
        )
    }

    @Test
    fun `a request derives its own state from its own timestamps`() {
        // Derived rather than decoded from the wire `state`, so a row painted
        // from the process cache before any fetch says the same word the API
        // would. THE case: cancelled, then paid anyway.
        val row = PaymentRequest(
            id = "1",
            status = PaymentStatus.CANCELLED,
            paid_at = "2026-08-01T00:00:00Z",
            amount_cents = 25_000,
            currency = "cad",
        )
        assertEquals(PaymentState.PAID, row.state)
        assertFalse(Payments.cancellable(row.state))
        assertEquals(BillingCurrency.CAD, row.money)
    }

    private companion object {
        const val DAY = 24L * 60 * 60 * 1000
        /** A fixed instant: a test that computes its window from the wall clock
         *  is a test that starts failing on a date nobody chose. */
        val NOW = Instant.parse("2026-08-10T12:00:00Z").toEpochMilli()
    }
}
