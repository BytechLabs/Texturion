package com.loonext.android.features.contacts.sync

import com.loonext.android.features.contacts.device.DeviceContact
import com.loonext.android.features.contacts.device.DevicePhoneNumber
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #183 part 3: the pure DeviceContact → ContactsContract row plan. */
class ContactsSyncPlanTest {

    private val pkg = "com.loonext.android"

    private fun phone(raw: String, e164: String?) =
        DevicePhoneNumber(raw = raw, e164 = e164, label = "Mobile")

    private fun contact(key: String, name: String, vararg numbers: DevicePhoneNumber) =
        DeviceContact(lookupKey = key, displayName = name, numbers = numbers.toList())

    @Test
    fun `custom MIME types derive from the application id`() {
        assertEquals("vnd.android.cursor.item/vnd.com.loonext.android.call", callMimeType(pkg))
        assertEquals("vnd.android.cursor.item/vnd.com.loonext.android.text", textMimeType(pkg))
    }

    @Test
    fun `each dialable number becomes a raw contact with phone, call, and text rows`() {
        val plan = buildSyncRawContacts(
            pkg,
            listOf(contact("a", "Ada", phone("(416) 555-0123", "+14165550123"))),
        )
        val raw = plan.single()
        assertEquals("+14165550123", raw.e164)
        assertEquals("Ada", raw.displayName)

        assertEquals(
            listOf(MIME_PHONE, callMimeType(pkg), textMimeType(pkg)),
            raw.dataRows.map { it.mimeType },
        )
        // Every row carries the E.164 as DATA1 (the number the action dials/texts).
        assertTrue(raw.dataRows.all { it.data1 == "+14165550123" })

        val call = raw.dataRows[1]
        assertEquals(CALL_ACTION_LABEL, call.summary)
        assertEquals("(416) 555-0123", call.detail)
        val text = raw.dataRows[2]
        assertEquals(TEXT_ACTION_LABEL, text.summary)
    }

    @Test
    fun `non-dialable numbers are skipped`() {
        val plan = buildSyncRawContacts(
            pkg,
            listOf(
                contact(
                    "a", "Intl",
                    phone("+44 20 7946 0958", null), // not US/CA -> no e164 -> skipped
                    phone("416-555-0123", "+14165550123"),
                ),
            ),
        )
        // Only the dialable number produced a raw contact.
        assertEquals(1, plan.size)
        assertEquals("+14165550123", plan.single().e164)
    }

    @Test
    fun `a contact with no dialable number produces nothing`() {
        val plan = buildSyncRawContacts(
            pkg,
            listOf(contact("a", "Intl", phone("+44 20 7946 0958", null))),
        )
        assertTrue(plan.isEmpty())
    }

    @Test
    fun `the same number across contacts yields a single raw contact`() {
        val plan = buildSyncRawContacts(
            pkg,
            listOf(
                contact("a", "Ada", phone("416-555-0123", "+14165550123")),
                contact("b", "Bob", phone("(416) 555-0123", "+14165550123")),
            ),
        )
        assertEquals(1, plan.size)
        // First-seen contact owns the shared number.
        assertEquals("Ada", plan.single().displayName)
    }

    @Test
    fun `contactsActionKind maps our MIME types and rejects others`() {
        assertEquals(ContactsActionKind.CALL, contactsActionKind(callMimeType(pkg), pkg))
        assertEquals(ContactsActionKind.TEXT, contactsActionKind(textMimeType(pkg), pkg))
        assertNull(contactsActionKind(MIME_PHONE, pkg))
        assertNull(contactsActionKind(null, pkg))
        assertNull(contactsActionKind("vnd.android.cursor.item/vnd.other.app.call", pkg))
    }
}
