package com.loonext.android.features.thread

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.ConversationDetail
import com.loonext.android.core.model.ConversationDetailContact
import com.loonext.android.core.model.Page
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #726: an unanswered source reads as unanswered, a chosen one as chosen, and
 * one thread's answer never shows up on another.
 */
class LeadSourceChoiceTest {

    private fun detail(id: String, sourceId: String?, origin: String? = null) = ConversationDetail(
        id = id,
        company_id = "co1",
        contact_id = "ct1",
        phone_number_id = "pn1",
        status = "open",
        is_spam = false,
        last_message_at = "2026-11-10T10:00:00Z",
        created_at = "2026-07-01T00:00:00Z",
        updated_at = "2026-07-01T00:00:00Z",
        contact = ConversationDetailContact(id = "ct1", phone_e164 = "+15555550100"),
        messages = Page(data = emptyList()),
        lead_source_id = sourceId,
        lead_source_origin = origin,
    )

    /** What the chip row draws: which of the offered sources reads as chosen. */
    private fun chosenChips(offered: List<String>, choice: LeadSourceChoice) =
        offered.filter { it == choice.sourceId }

    @Test
    fun `an unasked source says it was not asked and no chip reads as chosen`() {
        val choice = LeadSourceChoice.of(detail("c1", null))
        assertEquals(LeadSourceView.Unasked, leadSourceView(null, choice.origin))
        // The lone source is a choice on offer, not the answer.
        assertEquals(emptyList<String>(), chosenChips(listOf("truck"), choice))
    }

    @Test
    fun `the copy of the empty state is the one the web says`() {
        assertEquals(
            "Not asked yet. Ask them how they heard about you.",
            AppStrings.translate(null, "thread.leadAsk"),
        )
        assertEquals(
            "Pas encore demandé. Demandez-lui comment il vous a connu.",
            AppStrings.translate("fr-CA", "thread.leadAsk"),
        )
        assertEquals("Add a source", AppStrings.translate(null, "thread.addLeadSource"))
        assertEquals("Ajouter une source", AppStrings.translate("fr-CA", "thread.addLeadSource"))
    }

    @Test
    fun `a chosen source is named and its chip is the chosen one`() {
        val choice = LeadSourceChoice.of(detail("c1", "truck", origin = "manual"))
        assertEquals(LeadSourceView.Chosen("Truck", fromNumber = false), leadSourceView("Truck", choice.origin))
        assertEquals(listOf("truck"), chosenChips(listOf("truck", "sign"), choice))
    }

    @Test
    fun `a source the line named says so`() {
        val choice = LeadSourceChoice.of(detail("c1", "truck", origin = "number"))
        assertEquals(LeadSourceView.Chosen("Truck", fromNumber = true), leadSourceView("Truck", choice.origin))
    }

    @Test
    fun `switching from a thread with a source to one without selects nothing`() {
        val first = LeadSourceChoice.of(detail("c1", "truck", origin = "manual"))
        assertEquals(listOf("truck"), chosenChips(listOf("truck"), first))

        // The panel holds one choice per conversation id: a different thread is
        // built from its own server value, never from the one just left.
        val second = LeadSourceChoice.of(detail("c2", null))
        assertNull(second.sourceId)
        assertEquals(emptyList<String>(), chosenChips(listOf("truck"), second))
        assertEquals(LeadSourceView.Unasked, leadSourceView(null, second.origin))

        // And what was picked on the first thread stays on the first.
        first.sourceId = null
        assertNull(second.sourceId)
    }

    @Test
    fun `only someone who can manage settings is offered Add a source`() {
        assertTrue(canAddLeadSource("owner"))
        assertFalse(canAddLeadSource("member"))
        assertFalse(canAddLeadSource(null))
    }
}
