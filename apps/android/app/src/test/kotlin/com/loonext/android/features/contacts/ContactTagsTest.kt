package com.loonext.android.features.contacts

import com.loonext.android.core.model.Contact
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #695 - what the contact read now carries: the tags, and the record merged in.
 *
 * Unmerge acts on `merged_from.id`, the record that was folded in, so a decode
 * that dropped it would leave the Unmerge button with nothing to act on.
 */
class ContactTagsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `a contact carries its tags and the record merged into it`() {
        val contact = json.decodeFromString<Contact>(
            """
            {"id":"c1","phone_e164":"+14165550123","name":"Dana",
             "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
             "tags":[{"id":"t1","name":"Warranty","color":null}],
             "merged_from":{"id":"c2","name":"Jane Smith","phone_e164":"+14165550100",
                            "merged_at":"2026-11-02T15:00:00Z"}}
            """.trimIndent(),
        )
        assertEquals(listOf("Warranty"), contact.tags.map { it.name })
        assertEquals("c2", contact.merged_from?.id)
        assertEquals("Jane Smith", contact.merged_from?.name)
    }

    @Test
    fun `a contact from before tags decodes as untagged and unmerged`() {
        val contact = json.decodeFromString<Contact>(
            """
            {"id":"c1","phone_e164":"+14165550123",
             "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"}
            """.trimIndent(),
        )
        assertEquals(emptyList<Any>(), contact.tags)
        assertNull(contact.merged_from)
    }
}
