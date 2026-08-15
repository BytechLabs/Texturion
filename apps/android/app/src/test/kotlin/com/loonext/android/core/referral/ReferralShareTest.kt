package com.loonext.android.core.referral

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #288 — the share draft, and that this phone offers the same words the laptop does.
 *
 * Two halves. The behaviour tests assert the arithmetic and the one rule that
 * matters (an edited message keeps its link); the parity tests read
 * `packages/shared/src/referral-share.ts`, because this is a hand-port and
 * nothing about Kotlin says the original stayed put.
 *
 * A draft that reads differently on the phone than on the laptop is a draft an
 * owner stops trusting to say what they meant — and this is the one message in
 * the product a customer sends to somebody who has never heard of us.
 */
class ReferralShareTest {

    @Test
    fun `the link goes on the end, so an edited message keeps it`() {
        assertEquals(
            "Come try this\n\nhttps://loonext.com/?ref=ABCD2345",
            ReferralShare.shareText("Come try this", "https://loonext.com/?ref=ABCD2345", "ABCD2345"),
        )
    }

    @Test
    fun `an owner who deletes every word still sends something usable`() {
        // The whole reason the link is not inside the editable field.
        assertEquals(
            "https://loonext.com/?ref=ABCD2345",
            ReferralShare.shareText("   ", "https://loonext.com/?ref=ABCD2345", "ABCD2345"),
        )
    }

    @Test
    fun `with no link configured the code carries the referral`() {
        assertEquals(
            "Have a look\n\nUse my code ABCD2345 when you sign up.",
            ReferralShare.shareText("Have a look", null, "ABCD2345"),
        )
    }

    @Test
    fun `the draft trims rather than sending trailing whitespace`() {
        assertEquals(
            "Look\n\nhttps://x.test/?ref=A",
            ReferralShare.shareText("Look  \n\n", "https://x.test/?ref=A", "A"),
        )
    }

    @Test
    fun `the headline does not say 1 customers`() {
        assertEquals("You replied to 1 customer this month.", ReferralShare.askHeadline(1))
        assertEquals("You replied to 37 customers this month.", ReferralShare.askHeadline(37))
    }

    @Test
    fun `a stage this build does not know reads as itself rather than crashing`() {
        // A server ahead of this app. One unfamiliar row on a settings card is
        // recoverable; a crash where the card used to be is not.
        assertEquals("Up and running", ReferralShare.stageLabel("signed_up"))
        assertEquals("kaleidoscope", ReferralShare.stageLabel("kaleidoscope"))
    }

    @Test
    fun `the default draft promises nothing the product does not do`() {
        // A crew can run several numbers, so "one number" is not ours to claim.
        assertFalse(ReferralShare.NOTE.contains("one number", ignoreCase = true))
        // And it carries no link of its own: shareText appends it, and a URL in
        // here would be a second place for the link to come from.
        assertFalse(ReferralShare.NOTE.contains("http"))
    }

    // ---------------------------------------------------- against the original

    private fun repoFile(relative: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.exists()) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found from ${File("").absolutePath}")
    }

    private fun shared(): String = repoFile("packages/shared/src/referral-share.ts")

    /**
     * The web catalogue's ENGLISH half, which is where the shared module's
     * sentences went.
     *
     * #228 moved `referral-share.ts` from holding sentences to naming keys, so
     * a `contains` against that file asks whether it holds a paragraph it no
     * longer holds. The guard's job is unchanged — this client must not drift
     * from the shared vocabulary — so it follows the words rather than being
     * deleted.
     *
     * Sliced to the English half: the French holds the same keys, and a
     * `contains` over the whole file would be asking whether a sentence
     * appears in EITHER language.
     */
    private fun catalogue(): String =
        repoFile("apps/web/src/i18n/sections/domain.ts")
            .substringAfter("export const domainEn")
            .substringBefore("export const domainFr")

    @Test
    fun `every sentence a crew might send matches the shared module`() {
        val source = catalogue()
        for (copy in listOf(
            ReferralShare.NOTE,
            ReferralShare.TITLE,
            ReferralShare.ACTION,
            ReferralShare.COPY,
            ReferralShare.COPIED,
            ReferralShare.DRAFT_LABEL,
            ReferralShare.LINK_NOTE,
            ReferralShare.REWARD_LINE,
            ReferralShare.ASK_BODY,
            ReferralShare.ASK_ACTION,
            ReferralShare.ASK_DISMISS,
        )) {
            // Long strings wrap across lines with `+` in both files, so the
            // comparison is against the source with those joins collapsed
            // rather than against the raw text.
            assertTrue(
                "this copy has drifted from the shared module: $copy",
                joined(source).contains(copy),
            )
        }
    }

    @Test
    fun `the stage labels match the shared module, all five`() {
        /*
         * #228: the shared module maps each stage to a KEY, and the catalogue
         * says what the key means. Pinning the whole chain rather than half of
         * it — a stage pointed at the wrong key and a key with the wrong words
         * are different bugs and this catches both.
         */
        val declared = Regex("""REFERRAL_STAGE_LABELS[^=]*= \{([^}]+)\}""")
            .find(joined(shared()))
            ?.groupValues
            ?.get(1)
            ?: throw AssertionError("REFERRAL_STAGE_LABELS is no longer an object literal")
        val pairs = Regex("""(\w+): "(domain\.\w+)"""").findAll(declared)
            .associate { it.groupValues[1] to it.groupValues[2] }
        assertEquals(5, pairs.size)

        val words = catalogue()
        for ((stage, key) in pairs) {
            val label = ReferralShare.stageLabel(stage)
            assertTrue(
                "the label for '$stage' has drifted from the catalogue: `$label`",
                joined(words).contains(label),
            )
            assertTrue(
                "'$stage' names $key, which the catalogue does not answer",
                words.contains(key.removePrefix("domain.") + ":"),
            )
        }
    }

    @Test
    fun `the fallback sentence for a missing link matches too`() {
        // Built by interpolation on both sides, so it is compared as its shape
        // rather than as a whole string.
        assertTrue(joined(shared()).contains("Use my code \${code} when you sign up."))
    }

    /**
     * The TypeScript source with its multi-line string concatenations joined.
     *
     * `"a " +\n  "b"` in the file is the single string `"a b"` at runtime, and a
     * literal `contains` against the raw text would fail on every sentence long
     * enough to wrap — which is most of them here.
     */
    private fun joined(source: String): String =
        source.replace(Regex(""""\s*\+\s*\n\s*""""), "")
}
