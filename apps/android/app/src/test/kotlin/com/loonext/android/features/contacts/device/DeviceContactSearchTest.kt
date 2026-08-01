package com.loonext.android.features.contacts.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #459 — searching the phone's own address book.
 *
 * The vitest twin lives in packages/shared/src/device-contacts.test.ts and the
 * XCTest twin in DeviceContactSearchTests.swift. All three must agree, or the
 * same query finds different people on different phones.
 */
class DeviceContactSearchTest {

    private fun row(name: String, number: String = "+14165550123") =
        DeviceContactListRow(id = name, name = name, number = number)

    @Test
    fun `shows everything for an empty query`() {
        assertTrue(deviceContactMatches(row("Dana Smith"), ""))
        assertTrue(deviceContactMatches(row("Dana Smith"), "   "))
    }

    @Test
    fun `matches a first name, case-insensitively`() {
        assertTrue(deviceContactMatches(row("Dana Smith"), "dan"))
        assertTrue(deviceContactMatches(row("Dana Smith"), "DAN"))
    }

    @Test
    fun `matches a surname, because that is how people are found`() {
        assertTrue(deviceContactMatches(row("Dana Smith"), "smi"))
        assertTrue(deviceContactMatches(row("Alaska Roofing"), "roof"))
    }

    @Test
    fun `does not match mid-word`() {
        // "Kasm" contains "sm". A list that returns names nobody typed is one
        // people stop reading.
        assertFalse(deviceContactMatches(row("Kasm Roofing"), "sm"))
    }

    @Test
    fun `treats punctuation as a word break`() {
        assertTrue(deviceContactMatches(row("Smith-Jones"), "jones"))
        assertTrue(deviceContactMatches(row("O'Brien"), "brien"))
    }

    @Test
    fun `handles a query exactly as long as the name`() {
        // Trivial here, a runtime trap in the Swift port: `1...0` is not an
        // empty range in Swift. Asserted in all three so the case cannot be
        // dropped from one of them.
        assertTrue(deviceContactMatches(row("Dana"), "dana"))
        assertFalse(deviceContactMatches(row("Dana"), "zzzz"))
    }

    @Test
    fun `reads a digits-only query as a number search, never a name one`() {
        // A number with no "1" anywhere in it, so the only way "1" could match
        // is through the name.
        assertFalse(deviceContactMatches(row("A1 Plumbing", "+14045550999"), "1"))
        assertTrue(deviceContactMatches(row("A1 Plumbing", "+14045550999"), "5550"))
    }

    @Test
    fun `matches a number however it was written down`() {
        assertTrue(deviceContactMatches(row("Dana", "+14165550123"), "5550123"))
        assertTrue(deviceContactMatches(row("Dana", "(416) 555-0123"), "4165550123"))
    }

    @Test
    fun `says when the cap hid rows rather than cutting the list silently`() {
        val many = (0 until MAX_DEVICE_CONTACT_ROWS + 5).map {
            DeviceContactListRow(id = "id-$it", name = "Person $it", number = "+1416555" + (1000 + it))
        }
        val page = filterDeviceContacts(many, "")
        assertEquals(MAX_DEVICE_CONTACT_ROWS, page.rows.size)
        assertTrue(page.truncated)
    }

    @Test
    fun `is not truncated when everything fits`() {
        val page = filterDeviceContacts(listOf(row("Dana Smith")), "dana")
        assertEquals(1, page.rows.size)
        assertFalse(page.truncated)
    }

    @Test
    fun `shows one row per contact, on its first number`() {
        // One row per contact rather than one per number: showing the same
        // person three times because their phone stored a mobile, a work and a
        // home number is a directory nobody can scan.
        val rows = deviceContactRows(
            listOf(
                DeviceContact(
                    lookupKey = "k1",
                    displayName = "Dana Smith",
                    numbers = listOf(
                        DevicePhoneNumber(raw = "(416) 555-0123", e164 = "+14165550123"),
                        DevicePhoneNumber(raw = "(416) 555-0999", e164 = "+14165550999"),
                    ),
                ),
            ),
        )
        assertEquals(1, rows.size)
        assertEquals("+14165550123", rows[0].number)
    }
}
