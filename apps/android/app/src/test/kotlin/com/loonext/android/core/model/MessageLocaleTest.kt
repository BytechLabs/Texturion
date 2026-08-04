package com.loonext.android.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #228: the language rules, hand-ported from packages/shared/src/locale.ts.
 *
 * The port is the reason this exists. Two of the three clients read that
 * TypeScript; this one keeps its own copy, and nothing but a test notices when
 * the two stop agreeing. The cases below are the ones where being wrong is
 * visible to a customer rather than to a developer: a contact silently pinned
 * to English, and a picker that names a language the server does not know.
 */
class MessageLocaleTest {

    // -- resolution: the load-bearing null ------------------------------------

    @Test
    fun `a contact who has said nothing follows the workspace`() {
        // NOT English. This single case is the whole feature: a Montreal crew
        // working in French texts a contact with no setting of their own in
        // French, and always has.
        assertEquals(MessageLocale.FR_CA, MessageLocale.resolve(null, MessageLocale.FR_CA))
    }

    @Test
    fun `a contact's own language beats the workspace`() {
        assertEquals(MessageLocale.EN, MessageLocale.resolve(MessageLocale.EN, MessageLocale.FR_CA))
        assertEquals(MessageLocale.FR_CA, MessageLocale.resolve(MessageLocale.FR_CA, MessageLocale.EN))
    }

    @Test
    fun `switching the workspace moves everyone nobody has said otherwise about`() {
        // The reason a contact stores null rather than a resolved language: if
        // these rows held "en", the owner would change the workspace and watch
        // nothing happen to the customers they added last year.
        val contacts = listOf(null, MessageLocale.FR_CA, MessageLocale.EN)
        assertEquals(
            listOf(MessageLocale.EN, MessageLocale.FR_CA, MessageLocale.EN),
            contacts.map { MessageLocale.resolve(it, MessageLocale.EN) },
        )
        assertEquals(
            listOf(MessageLocale.FR_CA, MessageLocale.FR_CA, MessageLocale.EN),
            contacts.map { MessageLocale.resolve(it, MessageLocale.FR_CA) },
        )
    }

    @Test
    fun `a language this build has not heard of falls back rather than throwing`() {
        // A row could carry a locale a later release added. This decides which
        // words a customer receives, so an unknown value has to degrade to the
        // product default; refusing would be a text that never arrives.
        assertEquals(MessageLocale.EN, MessageLocale.resolve("es-MX", null))
        assertEquals(
            MessageLocale.FR_CA,
            MessageLocale.resolve("es-MX", MessageLocale.FR_CA),
        )
        assertEquals(MessageLocale.EN, MessageLocale.resolve(null, "es-MX"))
    }

    // -- labels ---------------------------------------------------------------

    @Test
    fun `labels are the ones packages_shared publishes`() {
        // Pinned on purpose. These are a cross-client contract, not this
        // client's wording: LOCALE_LABELS in packages/shared spells it
        // "Francais" without the cedilla, and a phone that quietly improved the
        // spelling would name a different thing from the same setting on the web.
        assertEquals("English", MessageLocale.label(MessageLocale.EN))
        assertEquals("Francais (Canada)", MessageLocale.label(MessageLocale.FR_CA))
    }

    @Test
    fun `an unknown language renders as its own code`() {
        // Nothing readable to show, so show the truth rather than pick a
        // language on the owner's behalf.
        assertEquals("es-MX", MessageLocale.label("es-MX"))
    }

    @Test
    fun `the inherit choice names the language it inherits`() {
        // A contact control that only offered the two languages could not put
        // somebody back to following the workspace, and one that said "Default"
        // would not say what the default currently is.
        assertEquals(
            "Same as workspace (English)",
            MessageLocale.inheritLabel(MessageLocale.EN),
        )
        assertEquals(
            "Same as workspace (Francais (Canada))",
            MessageLocale.inheritLabel(MessageLocale.FR_CA),
        )
    }

    @Test
    fun `the offer order puts the product default first`() {
        assertEquals(listOf(MessageLocale.EN, MessageLocale.FR_CA), MessageLocale.ALL)
        assertEquals(MessageLocale.EN, MessageLocale.DEFAULT)
    }

    @Test
    fun `the inherit option never names a language it is only guessing`() {
        // An unrecognised value is the shape a later locale reaching an older
        // build takes. Rendering its raw code reads as a bug; naming English
        // instead states a fact we do not have, to a workspace that may not be
        // English. The bare sentence still means "whatever the workspace uses".
        //
        // Web and iOS degrade identically, which is the point: three clients
        // showing three different answers to the same unknown is the drift this
        // control was added to remove.
        assertEquals("Same as workspace", MessageLocale.inheritLabel("de"))
        assertEquals("Same as workspace", MessageLocale.inheritLabel(null))
    }
}
