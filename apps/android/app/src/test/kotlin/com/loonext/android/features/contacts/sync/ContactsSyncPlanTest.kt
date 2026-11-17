package com.loonext.android.features.contacts.sync

import com.loonext.android.core.model.MessageLocale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ContactsSyncPlanTest {
    private val pkg = "com.loonext.android"

    @Test
    fun `custom MIME types derive from the application id`() {
        assertEquals("vnd.android.cursor.item/vnd.com.loonext.android.call", callMimeType(pkg))
        assertEquals("vnd.android.cursor.item/vnd.com.loonext.android.text", textMimeType(pkg))
    }

    @Test
    fun `a dialable number only adds actions linked to its original raw contact`() {
        val plan = buildSyncRawContacts(pkg, listOf(SyncPhoneRow(1, 10, "(416) 555-0123")))
        val raw = plan.single()
        assertEquals(10L, raw.sourceRawContactId)
        assertEquals(
            listOf(
                SyncDataRow(callMimeType(pkg), "+14165550123", "Call with Loonext", "(416) 555-0123"),
                SyncDataRow(textMimeType(pkg), "+14165550123", "Text with Loonext", "(416) 555-0123"),
            ),
            raw.dataRows,
        )
    }

    @Test
    fun `connected action rows follow the system Contacts locale`() {
        val plan = buildSyncRawContacts(
            pkg,
            listOf(SyncPhoneRow(1, 10, "(416) 555-0123")),
            MessageLocale.FR_CA,
        )

        assertEquals("Appeler avec Loonext", plan.single().dataRows[0].summary)
        assertEquals("Envoyer un texto avec Loonext", plan.single().dataRows[1].summary)
    }

    @Test
    fun `non-dialable numbers are skipped`() {
        val plan = buildSyncRawContacts(pkg, listOf(SyncPhoneRow(1, 10, "+44 20 7946 0958")))
        assertTrue(plan.isEmpty())
    }

    @Test
    fun `shared numbers only dedupe within the same aggregate contact`() {
        val plan = buildSyncRawContacts(
            pkg,
            listOf(
                SyncPhoneRow(1, 10, "416-555-0123"),
                SyncPhoneRow(1, 11, "(416) 555-0123"),
                SyncPhoneRow(2, 20, "(416) 555-0123"),
            ),
        )
        assertEquals(listOf(10L, 20L), plan.map { it.sourceRawContactId })
    }

    @Test
    fun `contactsActionKind maps our MIME types and rejects others`() {
        assertEquals(ContactsActionKind.CALL, contactsActionKind(callMimeType(pkg), pkg))
        assertEquals(ContactsActionKind.TEXT, contactsActionKind(textMimeType(pkg), pkg))
        assertNull(contactsActionKind("vnd.android.cursor.item/phone_v2", pkg))
        assertNull(contactsActionKind(null, pkg))
        assertNull(contactsActionKind("vnd.android.cursor.item/vnd.other.app.call", pkg))
    }
}
