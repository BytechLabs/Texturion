package com.loonext.android.features.compose

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #415 — the meter and the preview must measure one string.
 *
 * The composer showed a segment count for the RAW draft and, one line below, a
 * preview of the SUBSTITUTED text that actually sends. Merge fields make those
 * different, so the only pre-send cost disclosure this product has was
 * answering about a string the customer never receives.
 *
 * It never overbilled — server-side metering measures the real sent text — but
 * it misinformed, silently and repeatedly. An owner who builds a saved reply
 * around {business_name} sees the same wrong number every time they send.
 *
 * Same assertion table as the web and iOS suites, deliberately: the estimator
 * and the substituter are hand-ported to three languages, so a case that only
 * one of them gets right is the failure mode #376 warns about.
 */
class MergedSegmentsTest {

    /** What the composer now meters. */
    private fun meter(draft: String, contactName: String?, businessName: String?) =
        segmentMeter(MergeFields.applyMergeFields(draft, contactName, businessName), false)

    /** #393: what it meters when this send will be SIGNED. */
    private fun signedMeter(
        draft: String,
        contactName: String? = null,
        businessName: String? = null,
        signature: String? = SIGNATURE,
    ) = segmentMeter(
        Signature.append(
            MergeFields.applyMergeFields(draft, contactName, businessName),
            signature,
        ),
        false,
    )

    @Test
    fun `crosses the boundary that business_name hides`() {
        // "{business_name}" is 15 characters. The real one is 34.
        //
        // Worth knowing while reading this: `{` and `}` are GSM-7 EXTENDED
        // characters costing TWO septets each, so the token is 17 septets
        // rather than 15 — one more way the raw draft is not the message.
        val business = "Wilson & Sons Plumbing and Heating"
        val draft = "Hi, this is {business_name}. " + "x".repeat(120)

        assertEquals("raw draft is one part", 1, estimateSegments(draft).segments)
        assertEquals(
            "the merged message is two",
            2,
            meter(draft, null, business).segments,
        )
    }

    @Test
    fun `catches the encoding flip a name can cause`() {
        // THE CASE THAT IS NOT A ROUNDING ERROR. One character outside GSM-7
        // flips the WHOLE message to UCS-2 and per-part capacity falls from 160
        // to 70, so a draft the meter called one part sends as three.
        val business = "O’Brien Heating" // typographic apostrophe
        val draft = "Hi, this is {business_name}. " + "x".repeat(120)

        assertEquals("GSM-7", estimateSegments(draft).encoding)
        val metered = meter(draft, null, business)
        assertEquals("UCS-2", metered.encoding)
        assertTrue("more than one part", metered.segments > 1)
    }

    @Test
    fun `pins which names flip, because the rule is not guessable`() {
        // GSM-7 carries plenty of accents, so #415's own example does not flip.
        // Lowercase ç is GSM-7 and uppercase Ç is not; lowercase á is GSM-7 and
        // uppercase Á is not. Nobody would predict that, so it is asserted.
        fun flips(business: String) =
            meter("Hi from {business_name}", null, business).encoding

        assertEquals("GSM-7", flips("Ménard Plomberie"))
        assertEquals("GSM-7", flips("Café Ståhl"))
        assertEquals("UCS-2", flips("O’Brien Heating"))
        assertEquals("UCS-2", flips("Çelik Isıtma"))
        assertEquals("UCS-2", flips("Ángel Fontanería"))
    }

    @Test
    fun `leaves a draft with no merge fields exactly as it was`() {
        // The fix must not move the number for the ordinary case, which is
        // most messages.
        val draft = "On our way, about twenty minutes out."
        assertEquals(
            segmentMeter(draft, false).segments,
            meter(draft, null, "Anything").segments,
        )
    }

    @Test
    fun `counts a dropped token as the shorter message it becomes`() {
        // Substitution can SHORTEN too: an unresolvable token is dropped
        // cleanly, so the raw count is not even a reliable floor. Metering the
        // merged text is the only thing right in both directions.
        val draft = "Hi {first_name}, " + "x".repeat(150)
        assertEquals(2, estimateSegments(draft).segments)
        assertEquals(1, meter(draft, null, null).segments)
    }

    // ---------------------------------------------------------------------
    // #393 — the signature is part of what sends, so the meter counts it.
    //
    // Same argument as #415 above through a different door: the first text to
    // a new customer can be signed server-side, and a meter ignoring it would
    // under-report the one message type where the product ADDS text the user
    // never typed. Same assertion table as the web and iOS suites.
    // ---------------------------------------------------------------------

    @Test
    fun `the signature can push a first text into a second part`() {
        val draft = "x".repeat(150)
        assertEquals("unsigned is one part", 1, meter(draft, null, null).segments)
        assertEquals("signed is two", 2, signedMeter(draft).segments)
    }

    @Test
    fun `the signature stays GSM-7 so it costs one part and not two`() {
        // An em dash here would flip the message to UCS-2 and cost THREE parts
        // (D4). Pinned on every client, because this is the surface a customer
        // would see the wrong number on.
        val metered = signedMeter("x".repeat(150))
        assertEquals("GSM-7", metered.encoding)
        assertEquals(2, metered.segments)
    }

    @Test
    fun `an unsigned send is metered exactly as before`() {
        val draft = "x".repeat(150)
        assertEquals(
            meter(draft, null, null).segments,
            signedMeter(draft, signature = null).segments,
        )
    }

    @Test
    fun `merge fields and the signature both count, in the send path order`() {
        val business = "Wilson & Sons Plumbing and Heating"
        val draft = "Hi, this is {business_name}. " + "x".repeat(100)
        assertEquals(
            "merged alone is one part",
            1,
            meter(draft, null, business).segments,
        )
        assertEquals(
            "merged then signed is two",
            2,
            signedMeter(draft, businessName = business).segments,
        )
    }

    @Test
    fun `an owner who already typed the signature is not counted twice`() {
        val draft = "On my way" + SIGNATURE
        assertEquals(
            meter(draft, null, null).segments,
            signedMeter(draft).segments,
        )
    }

    @Test
    fun `the signature applies once per customer`() {
        val suffix = " - Acme. Reply STOP to opt out"
        // Signing off: never, whatever the customer's history.
        assertEquals(null, Signature.pending(null, null))
        assertEquals(null, Signature.pending("  ", null))
        // On, and never signed to — including a raw number, which has no
        // contact row and so passes null.
        assertEquals(suffix, Signature.pending(suffix, null))
        // On, but they have already been told who we are.
        assertEquals(null, Signature.pending(suffix, "2026-07-20T10:00:00Z"))
    }

    @Test
    fun `the signature is appended once and only once`() {
        val suffix = " - Acme. Reply STOP to opt out"
        assertEquals("On my way$suffix", Signature.append("On my way", suffix))
        assertEquals("On my way", Signature.append("On my way", null))
        assertEquals("On my way", Signature.append("On my way", "   "))
        val once = Signature.append("On my way", suffix)
        assertEquals(once, Signature.append(once, suffix))
        // Trailing whitespace must not defeat the guard.
        assertEquals("$once  ", Signature.append("$once  ", suffix))
    }

    private companion object {
        /** The server-resolved signature, as the API would hand it over. */
        const val SIGNATURE = " - Acme Plumbing. Reply STOP to opt out"
    }
}
