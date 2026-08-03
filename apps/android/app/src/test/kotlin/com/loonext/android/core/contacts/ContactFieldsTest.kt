package com.loonext.android.core.contacts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #291 — the same cases as `contact-fields.test.ts` and `ContactFieldsTests`.
 *
 * This is a HAND-PORT of shared TypeScript, which is where the silent failures
 * live: a regex that means something different in Kotlin compiles and then
 * quietly accepts what the server refuses, or refuses what it accepts. Every
 * case here asserts a POSITIVE result as well as a negative, because a
 * function that returns null for everything passes every "is it rejected?"
 * test ever written.
 */
class ContactFieldsTest {
    @Test
    fun `CFK-1 turns a label into something a CSV header can survive`() {
        // The same string becomes a JSON key AND a column head for import
        // mapping (#248) and export (#227). A key with a comma in it makes a
        // file that reads back wrong, two features from now.
        assertEquals("boiler_model", ContactFields.key("Boiler model"))
        assertEquals("serial", ContactFields.key("Serial #"))
        assertEquals(
            "warranty_expiry_if_any",
            ContactFields.key("Warranty expiry, if any"),
        )
        // A label that STARTS with punctuation. The leading trim is the only
        // thing standing between "#Serial" and a null — without it the key is
        // "_serial", which fails the must-start-with-a-letter check and the
        // field cannot be created at all. Found by breaking the trim and
        // watching every other case carry on passing.
        assertEquals("serial", ContactFields.key("#Serial"))
    }

    @Test
    fun `CFK-2 refuses rather than inventing a name`() {
        assertNull(ContactFields.key("???"))
        assertNull(ContactFields.key("   "))
        // Leading digits are legal JSON and an awkward column head, and the
        // database refuses them anyway.
        assertNull(ContactFields.key("2nd meter"))
    }

    @Test
    fun `CFK-3 never ends in the separator it introduced`() {
        assertTrue(ContactFields.key("Serial #")?.endsWith("_") == false)
        assertTrue(ContactFields.key("Model (v2)")?.endsWith("_") == false)
        // The case the final strip exists for: a label long enough that the
        // 40-character cut lands on a separator the sanitiser introduced.
        val long = "x".repeat(39) + " tail"
        assertEquals("x".repeat(39), ContactFields.key(long))
    }

    @Test
    fun `CFV-1 empty is always allowed, because it is an ANSWER`() {
        // "We asked and there is no gate code" is a fact worth recording, and
        // it is not the same as never having asked.
        for (kind in ContactFields.KINDS) {
            assertNull(kind, ContactFields.valueError(kind, listOf("Combi"), "F", ""))
        }
    }

    @Test
    fun `CFV-2 a date field takes a date, not a phrase`() {
        assertNull(ContactFields.valueError("date", null, "Warranty", "2027-03-01"))
        assertEquals(
            "Warranty should be a date",
            ContactFields.valueError("date", null, "Warranty", "next Tuesday"),
        )
    }

    @Test
    fun `CFV-3 a select takes one of its own choices`() {
        val options = listOf("Combi", "System")
        assertNull(ContactFields.valueError("select", options, "Type", "Combi"))
        assertTrue(
            ContactFields.valueError("select", options, "Type", "Combie")
                ?.contains("choices") == true,
        )
    }

    @Test
    fun `CFV-4 the reason names the FIELD, so somebody can find it`() {
        // A form with ten custom fields and one error saying "invalid" is a
        // form somebody edits at random until it saves.
        assertEquals(
            "Capacity should be a number",
            ContactFields.valueError("number", null, "Capacity", "abc"),
        )
        assertEquals(
            "Dog should be yes or no",
            ContactFields.valueError("checkbox", null, "Dog", "maybe"),
        )
        // And the good values pass, so the rule is a rule rather than a
        // rejection of everything.
        assertNull(ContactFields.valueError("number", null, "Capacity", "24.5"))
        assertNull(ContactFields.valueError("checkbox", null, "Dog", "yes"))
    }

    @Test
    fun `CFV-5 a value has a ceiling`() {
        val long = "x".repeat(ContactFields.VALUE_MAX + 1)
        assertTrue(
            ContactFields.valueError("text", null, "Notes", long)
                ?.contains("too long") == true,
        )
        assertNull(
            ContactFields.valueError(
                "text",
                null,
                "Notes",
                "x".repeat(ContactFields.VALUE_MAX),
            ),
        )
    }
}
