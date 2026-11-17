package com.loonext.android.features.shell

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test

class ShellCountsTest {
    @Test
    fun `failed reads keep prior counts and a successful zero clears its count`() = runTest {
        val counts = ShellCounts(forYou = 3, unreadConversations = 7, openTasks = 2)
        val unread = readShellData<Int> { throw IllegalStateException("offline") }

        assertNull(unread)
        assertEquals(
            ShellCounts(forYou = 3, unreadConversations = 7, openTasks = 0),
            counts.updating(forYou = null, unread = unread, openTasks = 0),
        )
    }

    @Test
    fun `a cancelled refresh exits before publishing counts`() = runTest {
        val cancelled = CancellationException("Superseded")

        try {
            readShellData<Int> { throw cancelled }
            fail("Expected cancellation")
        } catch (cause: CancellationException) {
            assertSame(cancelled, cause)
        }
    }
}
