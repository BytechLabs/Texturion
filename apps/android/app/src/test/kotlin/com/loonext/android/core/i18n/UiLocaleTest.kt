package com.loonext.android.core.i18n

import com.loonext.android.core.model.MessageLocale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #228 — the hand-port of `resolveUiLocale` / `normalizeDeviceLocale`, held to
 * the same vectors as `packages/shared/src/locale.ts`.
 *
 * A hand-ported rule that compiles is not a hand-ported rule that works: this
 * repo has shipped a Kotlin guard that matched nothing for months because a
 * backslash-b is a backspace here. So every branch is asserted POSITIVELY —
 * each of the four steps of the chain is shown actually deciding the answer,
 * rather than the chain being shown not to crash.
 */
class UiLocaleTest {
    @Test
    fun `the member's own setting wins over everything else`() {
        assertEquals(
            MessageLocale.EN,
            UiLocale.resolve(MessageLocale.EN, "fr-CA", MessageLocale.FR_CA),
        )
        assertEquals(
            MessageLocale.FR_CA,
            UiLocale.resolve(MessageLocale.FR_CA, "en-US", MessageLocale.EN),
        )
    }

    @Test
    fun `the device outranks the workspace, which is the bilingual shop`() {
        // The owner runs the business in French and employs a tech whose phone
        // is in English. Neither has to argue with the other's setting.
        assertEquals(
            MessageLocale.EN,
            UiLocale.resolve(null, "en-CA", MessageLocale.FR_CA),
        )
        assertEquals(
            MessageLocale.FR_CA,
            UiLocale.resolve(null, "fr-CA", MessageLocale.EN),
        )
    }

    @Test
    fun `a device we cannot read falls through to the workspace`() {
        assertEquals(
            MessageLocale.FR_CA,
            UiLocale.resolve(null, "es-MX", MessageLocale.FR_CA),
        )
        assertEquals(MessageLocale.EN, UiLocale.resolve(null, "es-MX", MessageLocale.EN))
    }

    @Test
    fun `nothing known at all reads English`() {
        assertEquals(MessageLocale.EN, UiLocale.resolve(null, "es-MX", null))
        assertEquals(MessageLocale.EN, UiLocale.resolve(null, null, null))
        // A value no build of this app recognises is not a statement. It must
        // NOT be handed back as the locale: `AppStrings.table` would read it as
        // "not French" and the app would be English anyway, but a company row
        // carrying it would then silently outrank a device that said fr.
        assertEquals(MessageLocale.FR_CA, UiLocale.resolve("de", "fr-FR", null))
    }

    @Test
    fun `every shape a platform hands a tag over in`() {
        assertEquals(MessageLocale.FR_CA, UiLocale.normalizeDevice("fr-CA"))
        assertEquals(MessageLocale.FR_CA, UiLocale.normalizeDevice("fr_CA"))
        assertEquals(MessageLocale.FR_CA, UiLocale.normalizeDevice("fr"))
        // France, deliberately: fr-CA is the only French this product has, and
        // Quebec French beats English for a French reader.
        assertEquals(MessageLocale.FR_CA, UiLocale.normalizeDevice("fr-FR"))
        assertEquals(MessageLocale.EN, UiLocale.normalizeDevice("en"))
        assertEquals(MessageLocale.EN, UiLocale.normalizeDevice("en-US"))
        assertEquals(MessageLocale.EN, UiLocale.normalizeDevice("EN-GB"))
    }

    @Test
    fun `an unrecognised tag is null rather than English`() {
        // Null is what lets the workspace have its turn. English here would
        // quietly override a French business's own setting with a default.
        assertNull(UiLocale.normalizeDevice("es-MX"))
        assertNull(UiLocale.normalizeDevice("und"))
        assertNull(UiLocale.normalizeDevice(""))
        assertNull(UiLocale.normalizeDevice(null))
    }

    @Test
    fun `the resolved locale is one the catalogue can actually read`() {
        // The whole point of the chain is to hand AppStrings something it will
        // recognise. Asserted through the catalogue rather than by comparing
        // strings, so a rename on either side fails here.
        val locale = UiLocale.resolve(null, "fr-CA", null)
        assertEquals("Annuler", AppStrings.translate(locale, "common.cancel"))
    }
}
