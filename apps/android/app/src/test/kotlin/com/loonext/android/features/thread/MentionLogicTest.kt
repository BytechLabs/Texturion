package com.loonext.android.features.thread

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The same cases the web client pins in `mentions.test.ts`. Both clients POST
 * `mention_user_ids`, so any drift here is drift in who gets notified.
 */
class MentionLogicTest {

    @Test
    fun `sends the id that was picked, not one guessed from the text`() {
        assertEquals(
            listOf("sam-rivera"),
            MentionLogic.resolveMentions(
                "@Sam can you look?",
                listOf(PickedMention("sam-rivera", "Sam")),
            ),
        )
    }

    @Test
    fun `withdraws a mention whose name was deleted from the draft`() {
        assertEquals(
            emptyList<String>(),
            MentionLogic.resolveMentions(
                "never mind",
                listOf(PickedMention("sam-rivera", "Sam")),
            ),
        )
    }

    @Test
    fun `does not re-arm a withdrawn mention whose name is a prefix of another`() {
        // "@Sam" was deleted; "@Sam Rivera" remains and contains it.
        assertEquals(
            listOf("sam-rivera"),
            MentionLogic.resolveMentions(
                "@Sam Rivera can you look?",
                listOf(PickedMention("sam", "Sam"), PickedMention("sam-rivera", "Sam Rivera")),
            ),
        )
    }

    @Test
    fun `keeps both when the draft really names both`() {
        assertEquals(
            setOf("sam", "sam-rivera"),
            MentionLogic.resolveMentions(
                "@Sam Rivera and @Sam please",
                listOf(PickedMention("sam", "Sam"), PickedMention("sam-rivera", "Sam Rivera")),
            ).toSet(),
        )
    }

    @Test
    fun `notifies one person when two teammates share a name and one is named`() {
        assertEquals(
            1,
            MentionLogic.resolveMentions(
                "@Sam can you check the shutoff?",
                listOf(PickedMention("sam-a", "Sam"), PickedMention("sam-b", "Sam")),
            ).size,
        )
    }

    @Test
    fun `treats a name repeated in the draft as separate claims`() {
        assertEquals(
            setOf("sam-a", "sam-b"),
            MentionLogic.resolveMentions(
                "@Sam and also @Sam",
                listOf(PickedMention("sam-a", "Sam"), PickedMention("sam-b", "Sam")),
            ).toSet(),
        )
    }

    @Test
    fun `opens on at-sign at the start of a note and after a space`() {
        assertTrue(MentionLogic.isMentionTrigger("@", 1))
        assertTrue(MentionLogic.isMentionTrigger("hey @", 5))
    }

    @Test
    fun `stays shut inside an email address`() {
        // An internal note is exactly where someone writes a customer's email.
        assertFalse(MentionLogic.isMentionTrigger("bob@acme.com", 4))
        assertFalse(MentionLogic.isMentionTrigger("rate2@", 6))
        assertFalse(MentionLogic.isMentionTrigger("hello", 5))
    }

    @Test
    fun `insert replaces the trigger and leaves the caret after the name`() {
        val result = MentionLogic.insertMention("hey @", 5, "Sam")
        assertEquals("hey @Sam ", result.text)
        assertEquals(9, result.caret)
    }

    @Test
    fun `insert mid-draft does not double an existing space`() {
        val result = MentionLogic.insertMention("hey @ can you look?", 5, "Sam")
        assertEquals("hey @Sam can you look?", result.text)
        assertEquals(8, result.caret)
    }
}
