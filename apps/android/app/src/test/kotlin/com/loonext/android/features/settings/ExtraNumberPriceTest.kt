package com.loonext.android.features.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * #523 rule 2 / #522 — what one extra phone number costs, on the two surfaces
 * that ask for consent to that charge.
 *
 * WHAT WAS WRONG. `NumbersSection.kt` read
 * `val extraPrice = if (company.plan == "pro") "$4/mo" else "$5/mo"` and wrote
 * it into the description of the card whose only control buys a number. Two
 * failures in one line. The figures were typed rather than mirrored, so a
 * repricing in `apps/api/src/billing/extra-numbers.ts` would ship to the API and
 * leave this client quoting the old one with every Kotlin test green. And they
 * carried no currency: the extra-number price book is filed in USD only — there
 * is no CAD amount in Stripe to collect — so a Canadian workspace read "$5",
 * which to that reader means CA$5, for a line their card takes US$5 for.
 *
 * THE HELD-NUMBERS CARD DOES NOT READ THIS MIRROR, and the split is deliberate.
 * `GET /v1/billing/held-numbers` serves `extra_number_cents` with
 * `extra_number_currency` beside it, and a served figure beats a hand-port every
 * time — that route quotes the amount it is about to charge. The mirror exists
 * for the add-a-number card, which opens a picker before any route has been
 * asked anything. [HeldNumbersTest] pins the served path; this file pins the
 * mirrored one.
 */
class ExtraNumberPriceTest {

    // -- the half TypeScript can break ---------------------------------------

    /**
     * THE DRIFT GUARD. Fails when `EXTRA_NUMBER_MONTHLY_CENTS` moves in the API
     * and this hand-port does not follow it.
     *
     * Fails rather than skips when the file or the declaration cannot be found:
     * a cross-language guard that quietly passes because it could not locate the
     * other language reads as protection and provides none.
     */
    @Test
    fun `pins the extra-number price against the TypeScript it was ported from`() {
        val block = centsBlock()
        listOf("starter", "pro").forEach { plan ->
            assertEquals(
                "EXTRA_NUMBER_MONTHLY_CENTS[$plan] has drifted from " +
                    "apps/api/src/billing/extra-numbers.ts. The price Stripe bills has " +
                    "moved and this client is still naming the old one on the card " +
                    "that sells the number",
                tsNumber(block, plan),
                EXTRA_NUMBER_MONTHLY_CENTS.getValue(plan),
            )
        }
    }

    /**
     * The block being read is the price table's own declaration.
     *
     * Without this, `substringBefore` on a renamed or moved constant would leave
     * the pin above comparing these two integers against whichever numbers
     * happened to come first in the file — and `extra-numbers.ts` is full of
     * quantities, limits and idempotency windows for it to find.
     */
    @Test
    fun `the pin reads the price table's own declaration`() {
        val block = centsBlock()
        assertTrue(
            "the block must be the price table's own declaration",
            block.contains("EXTRA_NUMBER_MONTHLY_CENTS"),
        )
        assertFalse(
            "`PLAN_LIMITS` inside the block means the pin is reading the number " +
                "ALLOWANCE table, whose values are small integers that would satisfy " +
                "no assertion here for the right reason",
            block.contains("PLAN_LIMITS"),
        )
    }

    /**
     * ...AND SO IS THE CURRENCY. This is the half that decides whether a
     * Canadian owner reads "US$5" or "$5", and it is a one-word change in
     * TypeScript away from being wrong in a way no figure comparison would
     * notice.
     */
    @Test
    fun `pins the currency that price book is denominated in`() {
        val ts = apiSource("billing/extra-numbers.ts")
        val declared = Regex("EXTRA_NUMBER_PRICE_CURRENCY: BillingCurrency = \"(\\w+)\"")
            .find(ts)
            ?: run {
                fail(
                    "`EXTRA_NUMBER_PRICE_CURRENCY` not found in " +
                        "apps/api/src/billing/extra-numbers.ts — was it renamed? Point " +
                        "this guard at the new name rather than removing it",
                )
                error("unreachable")
            }
        assertEquals(
            "the extra-number book has changed currency and this client has not " +
                "followed it, so every quote on both surfaces is now in the wrong money",
            declared.groupValues[1],
            EXTRA_NUMBER_PRICE_CURRENCY.name.lowercase(),
        )
    }

    // -- which money the card is quoting --------------------------------------

    /**
     * The CAD case is the one that was broken, and it is a real workspace:
     * `api_create_company` sets `billing_currency` to 'cad' for a Canadian
     * company, and `checkout-currency.ts` still bills it in USD because the
     * Stripe catalog has no CAD extra-number price to collect.
     */
    @Test
    fun `a Canadian workspace is told the extra number is priced in US dollars`() {
        assertEquals("US\$5/mo", extraNumberMonthly("starter", "cad", "CA"))
        assertEquals("US\$4/mo", extraNumberMonthly("pro", "cad", "CA"))
    }

    /** Its own audience reads a bare dollar sign — "US$5" to a US workspace is noise. */
    @Test
    fun `a US workspace reads a bare dollar sign`() {
        assertEquals("\$5/mo", extraNumberMonthly("starter", "usd", "US"))
        assertEquals("\$4/mo", extraNumberMonthly("pro", "usd", "US"))
    }

    /**
     * The property that stops a hardcode satisfying both tests above. `"$5/mo"`
     * answers the US case perfectly and is precisely the shipped defect; it
     * cannot also answer the Canadian one.
     */
    @Test
    fun `one string cannot satisfy both audiences`() {
        assertNotEquals(
            "if both audiences read the same string, this whole file is satisfied " +
                "by the literal it exists to catch",
            extraNumberMonthly("starter", "usd", "US"),
            extraNumberMonthly("starter", "cad", "CA"),
        )
    }

    /**
     * The stored currency beats the country, and the country is only consulted
     * when there is none.
     *
     * The same rule [planFacts] and [usRegistrationFee] follow, deliberately
     * rather than a second one: all three figures are read on the same Settings
     * screen by the same person, and a screen quoting two currencies at one
     * reader is the #328 defect itself.
     */
    @Test
    fun `the stored currency beats the country`() {
        assertEquals(
            "a CA workspace grandfathered onto USD billing is its own audience",
            "\$5/mo",
            extraNumberMonthly("starter", "usd", "CA"),
        )
        assertEquals(
            "with no stored currency the country decides",
            "US\$5/mo",
            extraNumberMonthly("starter", null, "CA"),
        )
        assertEquals("\$5/mo", extraNumberMonthly("starter", null, "US"))
    }

    /**
     * A plan we do not sell extras on gets NO figure rather than Starter's.
     *
     * A workspace with `plan == null` has never checked out, so quoting it the
     * Starter extra price would name an amount for a purchase that cannot
     * happen. The add-a-number card renders the unpriced sentence instead.
     */
    @Test
    fun `an unknown plan is quoted nothing at all`() {
        assertNull(extraNumberMonthly(null, "usd", "US"))
        assertNull(extraNumberMonthly("enterprise", "usd", "US"))
    }

    /**
     * The quoted string is the mirror's own entry run through the shared
     * formatter — asserted without naming a figure, so this stays true across a
     * repricing and the cross-language pin above is what decides whether the
     * repricing was followed.
     */
    @Test
    fun `the quote is the price table's own entry, formatted`() {
        listOf("starter", "pro").forEach { plan ->
            assertEquals(
                formatMoney(
                    EXTRA_NUMBER_MONTHLY_CENTS.getValue(plan),
                    EXTRA_NUMBER_PRICE_CURRENCY,
                    BillingCurrency.CAD,
                ) + "/mo",
                extraNumberMonthly(plan, "cad", "CA"),
            )
        }
    }

    // -- formatMoney's audience rule ------------------------------------------

    /**
     * [formatMoney] gained the [BillingCurrency] audience argument for this
     * feature, and the default must stay "my own currency" — every existing call
     * site passes two arguments and prints a plan price to the workspace that
     * pays it.
     */
    @Test
    fun `formatMoney defaults to the reader being their own audience`() {
        assertEquals("\$29", formatMoney(2900, BillingCurrency.USD))
        assertEquals("\$39", formatMoney(3900, BillingCurrency.CAD))
        assertEquals("US\$29", formatMoney(2900, BillingCurrency.USD, BillingCurrency.CAD))
        assertEquals("CA\$39", formatMoney(3900, BillingCurrency.CAD, BillingCurrency.USD))
    }

    /** Cents survive the prefix. A price of $4.50 must not become "US$4". */
    @Test
    fun `a fractional amount keeps its cents in both forms`() {
        assertEquals("\$4.50", formatMoney(450, BillingCurrency.USD))
        assertEquals("US\$4.50", formatMoney(450, BillingCurrency.USD, BillingCurrency.CAD))
    }

    // -- the card itself, which no unit test can render ------------------------

    /**
     * NO MONEY IS TYPED INTO THE NUMBERS SCREEN, anywhere.
     *
     * Scanned over the whole file rather than one composable, because the next
     * defect is a sentence somebody adds to a different card without thinking
     * about currency — which is exactly how the two figures this file exists for
     * got there.
     *
     * Comments are stepped over; escapes are NOT. `\$5` is precisely the shape
     * being hunted, and a walker that skipped the backslash would be handed "5"
     * and find nothing wrong with it. Same walker, same reasoning, as
     * `RegistrationFeeTest`.
     */
    @Test
    fun `no dollar figure is typed into the numbers screen`() {
        stringLiterals(readMainSource("features/settings/NumbersSection.kt")).forEach { literal ->
            assertFalse(
                "a price is typed into NumbersSection.kt: \"$literal\". Every figure " +
                    "this screen prints has to come from extraNumberMonthly(), " +
                    "resolved through the workspace's billing_currency — a literal " +
                    "here is a USD price shown to a reader who may be billed in CAD",
                dollarBeforeDigit(literal),
            )
        }
    }

    /**
     * ...AND THE CARD STILL NAMES ONE.
     *
     * The ban above is satisfied by a card that quotes no price at all, which is
     * a different and worse failure: a control that buys a phone number without
     * saying what it costs. Matched as a phrase rather than counted, because a
     * count becomes a ceiling the moment a second sentence is added.
     */
    @Test
    fun `the add-a-number card still quotes the resolved price`() {
        val src = readMainSource("features/settings/NumbersSection.kt")
        assertTrue(
            "the add-a-number card must resolve the price through " +
                "extraNumberMonthly() with the company's stored currency AND country",
            src.contains(
                "extraNumberMonthly(company.plan, company.billing_currency, company.country)",
            ),
        )
        // #228 MOVED THE SENTENCE, NOT THE RULE. The card's words now live in
        // `SettingsMoreStrings`, so a guard that looked for the English in this
        // file would pass forever on a card that had stopped naming a price —
        // which is the ceiling this whole file exists to avoid.
        //
        // So it is checked in the two places it can now break: the card has to
        // HAND the resolved price to the sentence, and the sentence has to have
        // somewhere to put it. A key with no `{price}` drops the figure
        // silently, and `AppStringsTest` only checks that the two languages
        // agree — it cannot know this one is about money.
        assertTrue(
            "an unpriced buy button is the failure this half exists for: the card " +
                "must pass extraPrice into the priced sentence",
            src.contains("\"price\" to extraPrice"),
        )
        val catalogue = readMainSource("core/i18n/SettingsMoreStrings.kt")
        val priced = catalogue.substringAfter("\"settingsMore.addNumberPriced\" to")
        assertTrue(
            "settingsMore.addNumberPriced must interpolate {price}, or the figure " +
                "the card resolved never reaches the reader",
            priced.substringBefore("\"settingsMore.").contains("{price}"),
        )
    }

    // -- reading the other language -------------------------------------------

    /** The `EXTRA_NUMBER_MONTHLY_CENTS` declaration, from `export const` to `};`. */
    private fun centsBlock(): String {
        val ts = apiSource("billing/extra-numbers.ts")
        val at = ts.indexOf("export const EXTRA_NUMBER_MONTHLY_CENTS")
        if (at < 0) {
            fail(
                "`export const EXTRA_NUMBER_MONTHLY_CENTS` not found in " +
                    "apps/api/src/billing/extra-numbers.ts — was it renamed? Point this " +
                    "guard at the new name rather than removing it",
            )
        }
        return ts.substring(at).substringBefore("};")
    }

    /** The integer assigned to `key` inside an already-scoped TypeScript block. */
    private fun tsNumber(block: String, key: String): Int {
        val match = Regex("\\b$key:\\s*(\\d+)").find(block)
        if (match == null) {
            fail("no `$key:` in the EXTRA_NUMBER_MONTHLY_CENTS block: `$block`")
        }
        return match!!.groupValues[1].toInt()
    }

    private fun apiSource(relative: String): String {
        listOf("", "../../", "../../../").forEach { prefix ->
            val f = File("${prefix}apps/api/src/$relative")
            if (f.exists()) return f.readText()
        }
        fail(
            "apps/api/src/$relative not found from ${File(".").absolutePath}. This " +
                "guard compares the Kotlin hand-port against the TypeScript it was " +
                "ported from, so it fails rather than skipping",
        )
        error("unreachable")
    }

    // -- reading this language -------------------------------------------------

    private fun dollarBeforeDigit(literal: String): Boolean = literal.indices.any { i ->
        literal[i] == '$' && i + 1 < literal.length && literal[i + 1].isDigit()
    }

    /** Every double-quoted literal in the source, with its escapes INTACT. */
    private fun stringLiterals(source: String): List<String> {
        val out = mutableListOf<String>()
        val current = StringBuilder()
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

                inString -> when {
                    ch == '\\' -> {
                        current.append(ch)
                        if (i + 1 < source.length) current.append(source[i + 1])
                        i++
                    }

                    ch == '"' -> {
                        inString = false
                        out += current.toString()
                        current.clear()
                    }

                    else -> current.append(ch)
                }

                ch == '/' && i + 1 < source.length && source[i + 1] == '/' -> inLineComment = true
                ch == '/' && i + 1 < source.length && source[i + 1] == '*' -> inBlockComment = true
                ch == '"' -> inString = true
            }
            i++
        }
        return out
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
}
