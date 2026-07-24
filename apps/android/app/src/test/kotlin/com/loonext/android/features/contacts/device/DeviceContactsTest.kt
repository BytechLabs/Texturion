package com.loonext.android.features.contacts.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #183 part 1: the pure ContactsContract-row → DeviceContact fold. */
class DeviceContactsTest {

    private fun row(
        key: String = "k1",
        name: String? = "Ada Lovelace",
        number: String? = "(416) 555-0123",
        label: String? = "Mobile",
    ) = DeviceContactRow(lookupKey = key, displayName = name, rawNumber = number, label = label)

    @Test
    fun `folds rows by lookup key preserving first-seen order`() {
        val contacts = aggregateDeviceContacts(
            listOf(
                row(key = "b", name = "Bob", number = "416-555-0100"),
                row(key = "a", name = "Ada", number = "416-555-0123"),
                row(key = "b", name = "Bob", number = "416-555-0101"),
            ),
        )
        assertEquals(listOf("b", "a"), contacts.map { it.lookupKey })
        // Bob's two distinct numbers both attach, in order.
        assertEquals(2, contacts.first().numbers.size)
        assertEquals(listOf("Bob", "Ada"), contacts.map { it.displayName })
    }

    @Test
    fun `normalizes NANP numbers to plus-1 E164 across input formats`() {
        val forms = listOf(
            "(416) 555-0123",
            "416-555-0123",
            "1 416 555 0123",
            "+14165550123",
            "4165550123",
        )
        forms.forEach { raw ->
            val c = aggregateDeviceContacts(listOf(row(number = raw))).single()
            assertEquals("normalize($raw)", "+14165550123", c.numbers.single().e164)
        }
    }

    @Test
    fun `keeps digits but leaves E164 null for non-US-CA numbers`() {
        // 999 is not an assigned NANP area code; a UK number is not NANP at all.
        val c = aggregateDeviceContacts(
            listOf(
                row(key = "x", name = "Intl", number = "+44 20 7946 0958"),
                row(key = "y", name = "BadNpa", number = "999-555-0123"),
            ),
        )
        assertNull(c[0].numbers.single().e164)
        assertTrue(c[0].numbers.single().digits.isNotEmpty())
        assertNull(c[1].numbers.single().e164)
    }

    @Test
    fun `dedupes numbers within a contact by digit string`() {
        val c = aggregateDeviceContacts(
            listOf(
                row(number = "(416) 555-0123", label = "Mobile"),
                row(number = "416-555-0123", label = "Work"), // same digits
                row(number = "416-555-0199", label = "Home"),
            ),
        ).single()
        assertEquals(2, c.numbers.size)
        // First-seen wins (Mobile, original formatting retained).
        assertEquals("(416) 555-0123", c.numbers.first().raw)
    }

    @Test
    fun `drops rows with no dialable digits and contacts left empty`() {
        val contacts = aggregateDeviceContacts(
            listOf(
                row(key = "blankNum", number = ""),
                row(key = "nullNum", number = null),
                row(key = "spaces", number = "   "),
                row(key = "ok", number = "416-555-0123"),
            ),
        )
        assertEquals(listOf("ok"), contacts.map { it.lookupKey })
    }

    @Test
    fun `drops rows with a blank lookup key`() {
        val contacts = aggregateDeviceContacts(listOf(row(key = "", number = "416-555-0123")))
        assertTrue(contacts.isEmpty())
    }

    @Test
    fun `falls back to a formatted number when the name is blank`() {
        val c = aggregateDeviceContacts(listOf(row(name = "", number = "416-555-0123"))).single()
        assertEquals("(416) 555-0123", c.displayName)
    }

    @Test
    fun `a later row supplies a name the first row lacked`() {
        val c = aggregateDeviceContacts(
            listOf(
                row(key = "k", name = null, number = "416-555-0123"),
                row(key = "k", name = "Grace Hopper", number = "416-555-0124"),
            ),
        ).single()
        assertEquals("Grace Hopper", c.displayName)
    }

    @Test
    fun `deviceDialerCandidates emits one per number using E164 when present`() {
        val contacts = aggregateDeviceContacts(
            listOf(
                row(key = "a", name = "Ada", number = "416-555-0123"),
                row(key = "a", name = "Ada", number = "+44 20 7946 0958"),
            ),
        )
        val candidates = deviceDialerCandidates(contacts)
        assertEquals(2, candidates.size)
        assertTrue(candidates.all { it.source == MatchSource.DEVICE })
        assertEquals("Ada", candidates.first().name)
        // Dialable number surfaces as E.164; the non-NANP one keeps its raw form.
        assertEquals("+14165550123", candidates[0].number)
        assertTrue(candidates[1].number.contains("44"))
    }
}
