package com.loonext.android.core.i18n

import com.loonext.android.core.model.MessageLocale
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #228 — the completeness guarantee Kotlin cannot express in its type system.
 *
 * Web types the French as the English's exact shape, so a forgotten key fails
 * `tsc` in the file that forgot it. There is no equivalent here, so it is
 * asserted instead — and asserted in BOTH directions, because the two failures
 * are different and both are real:
 *
 *   IN EN, NOT IN FR   a French reader is shown an English sentence.
 *   IN FR, NOT IN EN   a translation of a string that no longer exists, which
 *                      is how a catalogue rots into something nobody trusts.
 */
class AppStringsTest {
    @Test
    fun `every section has the same keys in both languages`() {
        for (section in AppStrings.SECTIONS) {
            val name = section::class.simpleName
            assertEquals(
                "$name: keys in English with no French",
                emptySet<String>(),
                section.en.keys - section.frCA.keys,
            )
            assertEquals(
                "$name: keys in French with no English",
                emptySet<String>(),
                section.frCA.keys - section.en.keys,
            )
        }
    }

    @Test
    fun `no two sections claim the same key`() {
        // The merge in AppStrings is a fold of maps, so a duplicate key would
        // be silently won by whichever section is registered last — and the
        // loser's screen would start saying somebody else's sentence.
        val seen = mutableMapOf<String, String>()
        for (section in AppStrings.SECTIONS) {
            val name = section::class.simpleName ?: "?"
            for (key in section.en.keys) {
                val previous = seen.put(key, name)
                assertEquals("$key is claimed by $previous and $name", null, previous)
            }
        }
    }

    @Test
    fun `a section that is not registered is unreachable, so all of them are`() {
        // A guard against the one mistake this arrangement invites: writing a
        // section file and forgetting the line in SECTIONS. It would compile,
        // its tests would pass, and every screen reading it would render bare
        // keys.
        assertTrue(AppStrings.SECTIONS.contains(CommonStrings))
        assertTrue(AppStrings.SECTIONS.contains(PaymentsStrings))
        assertTrue(AppStrings.en.isNotEmpty())
    }

    @Test
    fun `an unknown locale reads English rather than failing`() {
        assertEquals("Cancel", AppStrings.translate("de", "common.cancel"))
        assertEquals("Cancel", AppStrings.translate(null, "common.cancel"))
        assertEquals("Annuler", AppStrings.translate(MessageLocale.FR_CA, "common.cancel"))
    }

    @Test
    fun `a missing key falls back to English and then to itself`() {
        // The key rather than a blank, deliberately: an English sentence is a
        // lost translation, a blank is a lost product.
        assertEquals("nope.missing", AppStrings.translate("fr-CA", "nope.missing"))
    }

    @Test
    fun `interpolation substitutes what it is given and leaves what it is not`() {
        assertEquals(
            "Ask for \$250",
            AppStrings.translate("en", "payments.askFor", mapOf("amount" to "\$250")),
        )
        // An unknown token stays visible rather than becoming an empty gap: a
        // sentence with a hole in it is a bug report; "{amount}" on screen is
        // the same bug, reported by the screen.
        assertEquals(
            "Ask for {amount}",
            AppStrings.translate("en", "payments.askFor", mapOf("other" to "x")),
        )
    }

    @Test
    fun `the interpolation pattern really matches, which a backspace would not`() {
        // This repo has lost two guards to a Kotlin string's backslash-b being
        // a BACKSPACE rather than a word boundary — one of them a check on a
        // legal claim, passing on the empty set for months. A regex here that
        // matched nothing would leave "{amount}" on screen in front of a
        // paying customer, so it is asserted positively rather than trusted.
        val out = AppStrings.translate("en", "payments.asked", mapOf("amount" to "\$40"))
        assertEquals("Asked for \$40.", out)
        assertTrue("the token was not substituted at all", !out.contains("{"))
    }

    @Test
    fun `turning off an add-on never promises a credit unconditionally`() {
        /*
         * A false BILLING promise, not a wording preference.
         *
         * POST /v1/billing/modules disables a module with
         *   if (existingItem) { stripe.subscriptionItems.del(..) }
         * and no else. A grandfathered module was seeded free by migrations
         * with no Stripe line item, so it reaches that branch with nothing to
         * delete: no Stripe call, no charge ever existed, no credit. And
         * GET /v1/billing/modules does not say which cohort a workspace is
         * in, so the only sentence true for both makes the credit
         * CONDITIONAL on the add-on being billed.
         *
         * The web has said "if this add-on is on your bill" since #45. Both
         * phones said it flatly until #228 came through here, which is how a
         * sentence typed out three times drifts on the one client nobody
         * re-read.
         */
        for (locale in listOf(MessageLocale.EN, MessageLocale.FR_CA)) {
            val body = AppStrings.translate(locale, "settings.moduleRemoveBody")
            assertTrue(
                "$locale: the key did not resolve",
                !body.contains("settings."),
            )
            assertTrue(
                "$locale: the credit is promised unconditionally: $body",
                body.contains(if (locale == MessageLocale.FR_CA) "Si ce module" else "If this add-on"),
            )
            // And the other half a person needs before they press it: the
            // thing stops working now, not at the end of the period.
            assertTrue(
                "$locale: does not say the turn-off is immediate: $body",
                body.contains(if (locale == MessageLocale.FR_CA) "immédiatement" else "immediately"),
            )
        }
    }

    @Test
    fun `the two languages agree about which keys interpolate`() {
        // A French sentence that drops {amount} shows a bill with no figure on
        // it. Cheap to check, and invisible to every other test here.
        val token = Regex("""\{([A-Za-z0-9_]+)\}""")
        for (section in AppStrings.SECTIONS) {
            for ((key, english) in section.en) {
                val french = section.frCA[key] ?: continue
                assertEquals(
                    "$key: the two languages interpolate different tokens",
                    token.findAll(english).map { it.value }.toSortedSet(),
                    token.findAll(french).map { it.value }.toSortedSet(),
                )
            }
        }
    }

    @Test
    fun `a task row's delete confirmation has no placeholder left to fill`() {
        for (locale in listOf(MessageLocale.EN, MessageLocale.FR_CA)) {
            val body = AppStrings.translate(locale, "recordMenu.taskDeleteBody")
            assertTrue("$locale: the key did not resolve", !body.contains("recordMenu."))
            assertTrue("$locale: a token is left on screen: $body", !body.contains("{"))
        }
        // A row has no notes or files to name, so the menu must not read the detail screen's {what} sentence.
        val menu = mainSource("features/tasks/TaskRecordMenu.kt").readText()
        assertTrue("the list menu does not read recordMenu.taskDeleteBody", menu.contains("t(\"recordMenu.taskDeleteBody\")"))
        assertTrue("the list menu reads the {what} sentence", !menu.contains("\"contactsTasks.deleteTaskBody\""))
    }

    @Test
    fun `the delete refusal does not promise the creator can delete`() {
        // Since #691 a member is refused even on a task they created; only an admin or the owner deletes.
        val english = AppStrings.translate(MessageLocale.EN, "contactsTasks.deleteForbidden")
        val french = AppStrings.translate(MessageLocale.FR_CA, "contactsTasks.deleteForbidden")
        assertTrue("EN still names the creator: $english", !english.contains("creator"))
        assertTrue("EN does not name the admin: $english", english.contains("admin"))
        assertTrue("FR still names the creator: $french", !french.contains("créateur"))
        assertTrue("FR does not name the admin: $french", french.contains("administrateur"))
    }

    private fun mainSource(path: String): File {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val file = File(dir, "apps/android/app/src/main/kotlin/com/loonext/android/$path")
            if (file.isFile) return file
            dir = dir.parentFile
        }
        throw AssertionError("$path not found from ${File("").absolutePath}")
    }
}
