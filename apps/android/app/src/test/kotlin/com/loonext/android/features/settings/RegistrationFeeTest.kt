package com.loonext.android.features.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * #522 — the one-time US registration fee, on the button that authorises it.
 *
 * WHAT WAS WRONG. `RegistrationCard.kt` wrote "$29" into three sentences: the
 * button, the read-only line for everybody who is not the owner, and the body
 * of the confirm dialog. That card is drawn for `country == "CA" &&
 * !us_texting_enabled` and nothing else, so every reader of it is Canadian —
 * and `api_create_company` sets `billing_currency` to 'cad' for a Canadian
 * workspace against a `not null default 'usd'` column. The figure charged is
 * `US_REGISTRATION_FEE_CENTS.cad`, CA$39. Every single person who read that
 * sentence was quoted a price ten dollars under the one their card took, on the
 * one screen whose entire purpose is consent to that charge.
 *
 * WHAT THIS FILE PINS, in three parts that catch three different failures.
 *
 * The CROSS-LANGUAGE pin is the only assertion here that a change made in
 * TypeScript can fail. It reads `packages/shared/src/billing-currency.ts` and
 * compares the two integers this client hand-ported against the two in the
 * shared file. Without it, a repricing ships to the web and this client goes on
 * quoting last quarter's figure with every Kotlin test still green — the trap
 * this feature has already been caught by once, because an assertion written in
 * Kotlin against a Kotlin literal a few hundred lines away is a spelling check
 * and nothing more.
 *
 * The RESOLUTION half is Kotlin against Kotlin and knows it. What saves it from
 * being decoration is that USD and CAD differ: a single hardcoded figure cannot
 * satisfy both currencies, and `one figure cannot satisfy both currencies`
 * states that as a property rather than leaving it to luck.
 *
 * The WIRING half is a source scan, because a unit test cannot render a
 * composable. It proves no dollar-and-digit literal survives anywhere in the
 * card and that each of the three sentences interpolates the resolved value.
 *
 * WHAT THIS FILE DOES NOT PIN, said plainly so nobody reads more into it:
 *
 *   not Stripe        that the shared constant is what Stripe will actually
 *                     collect is `stripe-catalog-currency.test.ts`, in the API.
 *                     If the live catalog and the shared table disagree,
 *                     everything here stays green.
 *   not the render    the wiring half reads source text. It cannot say Compose
 *                     draws the string, only that the string is built from the
 *                     resolved fee rather than typed.
 *   not the siblings  it says nothing about iOS or the web. Each client
 *                     hand-ports separately and each needs its own pin.
 *   not a computed    [tsNumber] reads a literal with a regex. A shared table
 *   TypeScript        that started computing its figures would fail here
 *                     loudly rather than be understood, which is the correct
 *                     direction but is a limit worth knowing.
 */
class RegistrationFeeTest {

    private val card = "features/settings/RegistrationCard.kt"

    // -- the half TypeScript can break ---------------------------------------

    /**
     * THE DRIFT GUARD. Fails when `US_REGISTRATION_FEE_CENTS` moves in
     * `packages/shared` and this hand-port does not follow it.
     *
     * Fails rather than skips when the file or the declaration cannot be found
     * — see [sharedSource] and [feeBlock]. A cross-language guard that quietly
     * passes because it could not locate the other language reads as protection
     * in the file and provides none.
     */
    @Test
    fun `pins the registration fee against the TypeScript it was ported from`() {
        val block = feeBlock()
        mapOf(BillingCurrency.USD to "usd", BillingCurrency.CAD to "cad")
            .forEach { (currency, key) ->
                assertEquals(
                    "US_REGISTRATION_FEE_CENTS[$currency] has drifted from " +
                        "packages/shared/src/billing-currency.ts. The fee the API " +
                        "charges has moved and this client is still naming the old " +
                        "one on the button that authorises the charge",
                    tsNumber(block, key),
                    US_REGISTRATION_FEE_CENTS.getValue(currency),
                )
            }
    }

    /**
     * THE COLLISION THIS FEATURE CANNOT SEPARATE BY FIXTURE, named rather than
     * hoped past.
     *
     * The registration fee and the Starter monthly are the SAME two integers
     * today — 2900 and 3900 in both currencies — so no assertion about a value
     * anywhere in this file can tell "read the fee" apart from "read the
     * Starter plan price". A guard that scanned the shared file for `cad: 3900`
     * would keep passing through a repricing of the fee alone.
     *
     * What separates them is structural: the pin above reads THIS declaration's
     * own block, and this test is what says so. The equality at the end is not
     * decoration — it is the proof that the hazard is a live fact about this
     * repository rather than a hypothetical somebody imagined.
     */
    @Test
    fun `the pin reads the fee's own declaration and not the plan price book`() {
        val block = feeBlock()
        assertTrue(
            "the block must be the fee's own declaration",
            block.contains("US_REGISTRATION_FEE_CENTS"),
        )
        listOf("starter", "pro:").forEach { planKey ->
            assertFalse(
                "`$planKey` inside the block this pin reads means it is reading " +
                    "PLAN_PRICE_CENTS, whose figures happen to be identical today — " +
                    "so it would stay green through a repricing of the fee alone",
                block.contains(planKey),
            )
        }
        assertEquals(
            "the fee and the Starter monthly are the same integer, which is why " +
                "the separation above has to be structural rather than a value",
            PLAN_PRICE_CENTS.getValue(BillingCurrency.CAD).getValue("starter"),
            US_REGISTRATION_FEE_CENTS.getValue(BillingCurrency.CAD),
        )
    }

    // -- which money the card is quoting -------------------------------------

    /**
     * The figure named is the one this workspace's card is charged. CAD is the
     * case that was broken and is the only one that is ever read in practice;
     * USD is here so the assertion is about the resolution rather than about
     * one branch.
     */
    @Test
    fun `the fee is quoted in the currency the workspace is actually charged`() {
        assertEquals("\$39", usRegistrationFee("cad", "CA"))
        assertEquals("\$29", usRegistrationFee("usd", "US"))
    }

    /**
     * The property that keeps the two assertions above from being satisfied by
     * a constant. A hardcoded "$29" answers the USD case perfectly and is
     * exactly the shipped defect; it cannot also answer the CAD one.
     */
    @Test
    fun `one figure cannot satisfy both currencies`() {
        assertNotEquals(
            "if the two currencies quote the same string, this whole file is " +
                "satisfied by the hardcode it exists to catch",
            usRegistrationFee("usd", null),
            usRegistrationFee("cad", null),
        )
    }

    /**
     * The quoted string is the fee table's own entry run through the shared
     * formatter — asserted without naming a figure, so this one stays true
     * across a repricing and the cross-language pin is what decides whether the
     * repricing was followed.
     */
    @Test
    fun `the quoted fee is the fee table's own entry, formatted`() {
        BillingCurrency.entries.forEach { currency ->
            assertEquals(
                "the card must quote US_REGISTRATION_FEE_CENTS[$currency] rather " +
                    "than a figure resolved some other way",
                formatMoney(US_REGISTRATION_FEE_CENTS.getValue(currency), currency),
                usRegistrationFee(currency.name.lowercase(), null),
            )
        }
    }

    /**
     * `checkout-currency.ts` bills a Canadian workspace in USD whenever the
     * Stripe catalog cannot honour CAD, so the country is NOT a stand-in for
     * the stored currency — and on this card the country is always "CA", which
     * makes reading it first the more tempting mistake and the worse one.
     *
     * The same rule [planFacts] follows, deliberately: both figures are read on
     * the same Settings screen by the same person.
     */
    @Test
    fun `the stored currency beats the country, and the country is only a fallback`() {
        assertEquals(
            "a CA workspace grandfathered onto USD billing pays the US figure",
            "\$29",
            usRegistrationFee("usd", "CA"),
        )
        assertEquals(
            "with no stored currency the country decides",
            "\$39",
            usRegistrationFee(null, "CA"),
        )
        assertEquals(
            "anything we do not bill in is not a currency; fall back rather than " +
                "asking the table for a key it does not have",
            "\$39",
            usRegistrationFee("eur", "CA"),
        )
        assertEquals("\$29", usRegistrationFee(null, null))
    }

    // -- the card itself, which no unit test can render ----------------------

    /**
     * NO MONEY IS TYPED INTO THIS CARD, anywhere.
     *
     * Scanned over the whole file rather than over one composable, because the
     * defect was one figure written into three sentences and the next one would
     * be a fourth sentence somebody added without thinking about currency.
     *
     * Comments are stepped over — the docblocks explain the defect and quote
     * the figure that caused it, and a scan that read its own footnotes would
     * fail on correct code. Escapes are NOT stepped over, which is the
     * difference between this walker and the prose-reading one in
     * [CancellationOfferTest]: `\$29` is precisely the shape being hunted, and a
     * walker that skipped the backslash would be handed "29" and find nothing
     * wrong with it.
     */
    @Test
    fun `no dollar figure is typed into the registration card`() {
        stringLiterals(readMainSource(card)).forEach { literal ->
            assertFalse(
                "a price is typed into $card: \"$literal\". Every figure this " +
                    "card prints has to come from usRegistrationFee(), resolved " +
                    "through the workspace's billing_currency — a literal here is " +
                    "the USD price shown to a reader who is Canadian by construction",
                dollarBeforeDigit(literal),
            )
        }
    }

    /**
     * A dollar sign immediately followed by a digit, anywhere in the literal.
     *
     * Written as a walk rather than a regex because the pattern needs both a
     * backslash and a dollar sign, and spelling that in Kotlin costs four
     * levels of escaping and reads as line noise. `\$29` reaches here with its
     * escape intact and so contains `$` then `2`; `$fee` is `$` then `f` and is
     * exactly what this card should be full of.
     *
     * A figure written as `${'$'}29` would slip past. That is a known and
     * accepted hole: nobody reaches for that spelling except to defeat this
     * guard, and a guard that tried to parse arbitrary template expressions
     * would fail on correct code long before it caught anybody.
     */
    private fun dollarBeforeDigit(literal: String): Boolean = literal.indices.any { i ->
        literal[i] == '$' && i + 1 < literal.length && literal[i + 1].isDigit()
    }

    /**
     * ...AND ALL THREE SENTENCES USE THE RESOLVED ONE.
     *
     * The ban above is satisfied by a card that names no price at all, which
     * would be a different and worse failure: a button that charges money
     * without saying how much. So each of the three surfaces is named here.
     *
     * They are matched as phrases rather than counted, because a count becomes
     * a ceiling the moment a fourth sentence is added for an unrelated reason.
     */
    @Test
    fun `each sentence on the enable-US card names the resolved fee`() {
        val literals = stringLiterals(readMainSource(card))
        listOf(
            "the button the owner presses" to "Enable US texting: \$fee one-time",
            "the read-only line everybody else reads" to "\$fee carrier registration",
            "the confirm dialog above the button" to
                "A one-time \$fee registration fee is charged",
        ).forEach { (where, phrase) ->
            assertTrue(
                "$where no longer quotes the resolved fee (looked for `$phrase`). " +
                    "If the copy was rewritten, teach this guard the new sentence " +
                    "rather than deleting it — an unpriced consent button is the " +
                    "failure this half exists for",
                literals.any { it.contains(phrase) },
            )
        }
    }

    /**
     * The card resolves the fee from the COMPANY, and from both halves of the
     * question.
     *
     * `billing_currency` alone would fall back to USD for a workspace whose row
     * predates the column, and `country` alone would print CAD to a Canadian
     * workspace `checkout-currency.ts` had to bill in US dollars. The pair is
     * the answer, and it is the same pair the plan card passes.
     */
    @Test
    fun `the fee is resolved from the company, through the shared resolver`() {
        val src = readMainSource(card)
        assertTrue(
            "the enable-US card must resolve the fee through usRegistrationFee() " +
                "with the company's stored currency AND its country",
            src.contains("usRegistrationFee(company.billing_currency, company.country)"),
        )
    }

    // -- reading the other language ------------------------------------------

    /**
     * The `US_REGISTRATION_FEE_CENTS` declaration in the shared module, from
     * `export const` to the `};` that closes it.
     *
     * Fails on a missing declaration rather than returning the whole file,
     * which is what a naive `substringAfter` does and would leave the pin above
     * comparing this client's fee against whichever integers happened to come
     * first in `billing-currency.ts`.
     */
    private fun feeBlock(): String {
        val ts = sharedSource("billing-currency.ts")
        val at = ts.indexOf("export const US_REGISTRATION_FEE_CENTS")
        if (at < 0) {
            fail(
                "`export const US_REGISTRATION_FEE_CENTS` not found in " +
                    "packages/shared/src/billing-currency.ts — was it renamed? Point " +
                    "this guard at the new name rather than removing it",
            )
        }
        return ts.substring(at).substringBefore("};")
    }

    /** The integer assigned to `key` inside an already-scoped TypeScript block. */
    private fun tsNumber(block: String, key: String): Int {
        val match = Regex("\\b$key:\\s*(\\d+)").find(block)
        if (match == null) {
            fail("no `$key:` in the US_REGISTRATION_FEE_CENTS block: `$block`")
        }
        return match!!.groupValues[1].toInt()
    }

    /**
     * A file from `packages/shared/src`, from wherever Gradle started.
     *
     * FAILS rather than skips when it is not there, for the reason the class
     * docblock gives: a cross-language guard that cannot find the other
     * language must say so.
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

    // -- reading this language -----------------------------------------------

    /**
     * Every double-quoted literal in the source, with its escapes INTACT.
     *
     * The escape rule is the whole point and is the one way this differs from
     * the prose walker in [CancellationOfferTest]: a Kotlin string writes a
     * literal dollar as `\$`, so a walker that steps over the backslash — the
     * right behaviour when you are reading sentences — hands a money scan "29"
     * and it passes.
     *
     * Comments are stepped over so the guard does not fail on the docblocks
     * that quote the defect. Assumes plain literals: this card has no raw
     * strings and no character literals, and a future one that did would need
     * this taught about them rather than the guard relaxed.
     */
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
