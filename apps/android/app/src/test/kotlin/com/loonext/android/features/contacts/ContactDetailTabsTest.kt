package com.loonext.android.features.contacts

import com.loonext.android.core.model.Contact
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #740: the contact screen is a header and a segmented control. A tab shows one
 * list; empty detail fields sit behind "Add details"; every section stays one
 * or two taps away. The web twin is `contact-tabs.ts`.
 */
class ContactDetailTabsTest {
    private fun contact(
        business: String? = null,
        address: String? = null,
        email: String? = null,
        notes: String? = null,
    ) = Contact(
        id = "c-1",
        phone_e164 = "+12125550123",
        business_name = business,
        address = address,
        email = email,
        notes = notes,
        created_at = "2026-07-01T00:00:00Z",
        updated_at = "2026-07-01T00:00:00Z",
    )

    @Test
    fun `a tab puts exactly one list on screen`() {
        for (tab in ContactTab.entries) {
            for (pane in ContactActivityPane.entries) {
                // blockOnScreen returns one block by construction; pin that
                // Details and Files ignore the pane.
                val block = blockOnScreen(tab, pane)
                if (tab == ContactTab.Details) assertEquals(ContactBlock.Details, block)
                if (tab == ContactTab.Files) assertEquals(ContactBlock.Files, block)
            }
        }
        assertEquals(
            ContactBlock.Calls,
            blockOnScreen(ContactTab.Activity, ContactActivityPane.Calls),
        )
    }

    @Test
    fun `every section is reachable from some tab`() {
        val reachable = ContactTab.entries.flatMap { tab ->
            ContactActivityPane.entries.map { pane -> blockOnScreen(tab, pane) }
        }.toSet()
        assertEquals(ContactBlock.entries.toSet(), reachable)
    }

    @Test
    fun `empty detail fields are hidden until Add details`() {
        val empty = emptyDetailFields(contact())
        assertEquals(ContactDetailField.entries.toList(), empty)
        assertEquals(
            ContactDetailField.entries.toSet(),
            hiddenDetailFields(empty, empty, adding = false),
        )
        assertTrue(hiddenDetailFields(empty, empty, adding = true).isEmpty())
    }

    @Test
    fun `filled fields are never hidden`() {
        val filled = contact(
            business = "Maple Property Group",
            address = "12 Elm St",
            email = "dana@example.com",
            notes = "Gate code 4411",
        )
        assertTrue(emptyDetailFields(filled).isEmpty())
        assertEquals(listOf(ContactDetailField.Email), emptyDetailFields(filled.copy(email = "  ")))
    }

    @Test
    fun `a field cleared while typing stays on screen`() {
        val initiallyEmpty = emptyDetailFields(contact(notes = "x"))
        // Notes were filled when the screen opened, then cleared: not in the
        // initial list, so it is not folded away under the cursor.
        val emptyNow = emptyDetailFields(contact())
        assertTrue(ContactDetailField.Notes !in hiddenDetailFields(initiallyEmpty, emptyNow, false))
    }

    @Test
    fun `a field somebody else fills in appears`() {
        val initiallyEmpty = emptyDetailFields(contact())
        val emptyNow = emptyDetailFields(contact(email = "dana@example.com"))
        assertTrue(ContactDetailField.Email !in hiddenDetailFields(initiallyEmpty, emptyNow, false))
    }

    @Test
    fun `long lists are capped until Show all`() {
        val rows = (1..12).toList()
        assertEquals(CONTACT_LIST_CAP, cappedRows(rows, showAll = false).size)
        assertEquals(12, cappedRows(rows, showAll = true).size)
        assertEquals(3, cappedRows(listOf(1, 2, 3), showAll = false).size)
    }
}
