package com.loonext.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Where a notification tap lands. Every push the server sends resolves through
 * here, and a link that resolves to nothing is a tap that appears to do nothing.
 */
class DeepLinkTest {

    @Test
    fun `a thread link opens the thread`() {
        assertEquals(
            DeepLink.Thread("conv-1"),
            deepLinkFor(listOf("inbox", "conv-1")),
        )
    }

    @Test
    fun `a task reminder opens the job over its customer's thread`() {
        // The server points reminders at /inbox/<conv>?task=<id> so one tap
        // carries the address and checklist AND the thread they are about.
        assertEquals(
            DeepLink.Thread("conv-1", "task-9"),
            deepLinkFor(listOf("inbox", "conv-1"), taskParam = "task-9"),
        )
    }

    @Test
    fun `a task with no thread behind it opens its own page`() {
        assertEquals(DeepLink.Task("task-9"), deepLinkFor(listOf("tasks", "task-9")))
    }

    @Test
    fun `a blank task param is not a task`() {
        assertEquals(
            DeepLink.Thread("conv-1"),
            deepLinkFor(listOf("inbox", "conv-1"), taskParam = "  "),
        )
    }

    @Test
    fun `the legacy conversations path still resolves`() {
        assertEquals(
            DeepLink.Thread("conv-1"),
            deepLinkFor(listOf("conversations", "conv-1")),
        )
    }

    @Test
    fun `a call link carries its session`() {
        assertEquals(DeepLink.Calls("sess-3"), deepLinkFor(listOf("calls"), callParam = "sess-3"))
        assertEquals(DeepLink.Calls(null), deepLinkFor(listOf("calls")))
    }

    @Test
    fun `an unknown path resolves to nothing rather than guessing`() {
        assertNull(deepLinkFor(listOf("settings")))
        assertNull(deepLinkFor(emptyList()))
        assertNull(deepLinkFor(listOf("inbox")))
    }
}
