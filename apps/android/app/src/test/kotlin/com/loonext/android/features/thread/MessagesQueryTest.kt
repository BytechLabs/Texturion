package com.loonext.android.features.thread

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** #718: the three shapes of a thread read, as the API's `messages` route takes them. */
class MessagesQueryTest {

    @Test
    fun `an anchored read names the message and nothing else`() {
        val q = messagesQuery(around = "m5", limit = 50)
        assertEquals("m5", q["around"])
        assertEquals("50", q["limit"])
        assertNull(q["cursor"])
        assertNull(q["direction"])
    }

    @Test
    fun `paging newer carries the cursor and the direction`() {
        val q = messagesQuery(cursor = "c9", newer = true)
        assertEquals("c9", q["cursor"])
        assertEquals("newer", q["direction"])
        assertNull(q["around"])
    }

    @Test
    fun `the plain read is unchanged`() {
        val q = messagesQuery(cursor = "c1")
        assertEquals("c1", q["cursor"])
        assertNull(q["direction"])
        assertNull(q["around"])
    }
}
