package com.loonext.android.features.settings

import com.loonext.android.core.model.RejectionDomain
import com.loonext.android.core.model.explainRejection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * #319 — a rejected transfer reads like a sentence, not like a carrier token.
 *
 * The translation (core/model/RejectionGuidance.kt) and the notice that renders
 * it (features/settings/RejectionNotice.kt) both shipped with #352 and were
 * wired to the REGISTRATION card only. A rejected port kept printing the
 * carrier's own string — "LOA_MISMATCH" — beside a nine-field form.
 *
 * These are source lints in the [com.loonext.android.ImeContractLintTest]
 * idiom, because the wiring lives in composables a unit test cannot raise. The
 * one that earns its place is the last: it binds the field names the shared
 * catalogue routes to against the focus keys the port form actually registers.
 * A rename on either side turns "Take me to it" into a button that does
 * nothing, silently, on the one screen where somebody is already stuck.
 */
class PortRejectionWiringTest {

    private val portCards = "features/settings/PortCards.kt"

    /** The carrier reasons we know how to translate, and the field each fixes. */
    private val routedReasons = mapOf(
        "Invalid account number on record" to "account_number",
        "LOA_MISMATCH" to "auth_person_name",
        "CUSTOMER_NAME_MISMATCH" to "entity_name",
        "SERVICE_ADDRESS_MISMATCH" to "service_street",
        "PORT_OUT_PIN_INVALID" to "account_number",
    )

    @Test
    fun `both port surfaces raise the notice for the port domain`() {
        val src = readMainSource(portCards)
        // The tracker card (above "Fix and resubmit") and the fix dialog
        // (above the form) were the two places the raw string was printed.
        assertEquals(
            "PortCards.kt must raise RejectionNotice on BOTH the tracker card " +
                "and the fix dialog - the dialog covers the card, so a notice " +
                "only on the card is invisible while they retype",
            2,
            Regex("RejectionNotice\\(").findAll(src).count(),
        )
        assertEquals(
            "every RejectionNotice here is the port catalogue, not registration",
            2,
            Regex("domain = RejectionDomain\\.PORT").findAll(src).count(),
        )
    }

    @Test
    fun `the carrier's raw reason is handed to the notice, never printed alone`() {
        val src = readMainSource(portCards)
        assertTrue(
            "the notice needs the raw reason - it is what the fallback shows " +
                "when the catalogue does not recognise it",
            src.contains("reason = port.rejection_reason"),
        )
        assertTrue(
            "the notice needs the attempt count, or the second rejection never " +
                "offers a person and they resubmit blind a third time",
            src.contains("submissionCount = port.submission_count"),
        )
        for (dead in listOf("Your current carrier rejected the transfer", "Rejection reason: ")) {
            assertFalse(
                "PortCards.kt still prints the carrier's reason itself (\"$dead\") " +
                    "- that copy belongs to RejectionNotice now (#319)",
                src.contains(dead),
            )
        }
    }

    @Test
    fun `the card's jump opens the dialog the field lives in`() {
        val src = readMainSource(portCards)
        // Registration can focus in place; here the form is behind a dialog, so
        // a jump that only sets the field would land on a closed dialog.
        assertTrue(
            "the card's onGoToField must open the fix dialog as well as name " +
                "the field",
            src.contains("focusField = field") && src.contains("fixing = true"),
        )
        assertTrue(
            "the fix dialog must take the field through and hand it to the form",
            src.contains("focusField = focusField,") && src.contains("focusField = focus,"),
        )
    }

    @Test
    fun `every field the catalogue routes to is reachable in the port form`() {
        val src = readMainSource(portCards)
        for ((reason, expected) in routedReasons) {
            val guidance = explainRejection(RejectionDomain.PORT, reason)
            assertNotNull("the catalogue stopped recognising \"$reason\"", guidance)
            assertEquals("\"$reason\" routes somewhere new", expected, guidance!!.field)
            assertTrue(
                "the port form registers no focus key \"$expected\", so the " +
                    "\"Take me to it\" for \"$reason\" does nothing",
                src.contains("key = \"$expected\""),
            )
        }
    }

    @Test
    fun `a reason we cannot translate still reaches the customer`() {
        // Null is the honest answer, and it is the whole reason the raw string
        // stays wired through: it is then all the customer has.
        assertNull(explainRejection(RejectionDomain.PORT, "ERR_9471_VENDOR_SPECIFIC"))
        assertNull(explainRejection(RejectionDomain.PORT, null))
    }

    // ------------------------------------------------------------- plumbing

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
