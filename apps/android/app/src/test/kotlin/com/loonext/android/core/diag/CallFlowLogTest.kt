package com.loonext.android.core.diag

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * #198: the call-flow evidence channel's pure parts — line formatting,
 * last-4 masking, rotation math — plus the bounded in-memory tail and the
 * file sink's append/rotate behavior against a real temp directory.
 */
class CallFlowLogTest {
    @get:Rule
    val tmp = TemporaryFolder()

    @After
    fun tearDown() {
        CallFlowLog.resetForTest()
    }

    // -------------------------------------------------------------- formatLine

    @Test
    fun `formatLine is isoUtc time + tag + message`() {
        assertEquals(
            "1970-01-01T00:00:01.000Z [socket] Ready",
            CallFlowLog.formatLine(1_000, "socket", "Ready"),
        )
    }

    @Test
    fun `formatLine flattens newlines so one event is always one line`() {
        val line = CallFlowLog.formatLine(0, "sip", "INVITE\r\nheaders:\nmany")
        assertFalse(line.contains('\n'))
        assertFalse(line.contains('\r'))
        assertTrue(line.contains("INVITE"))
        assertTrue(line.contains("many"))
    }

    // -------------------------------------------------------------------- mask

    @Test
    fun `mask keeps only the last four digits of anything phone-shaped`() {
        assertEquals("***4567", CallFlowLog.mask("+15551234567"))
        assertEquals("***4567", CallFlowLog.mask("(555) 123-4567"))
        assertEquals("unknown", CallFlowLog.mask(null))
        assertEquals("unknown", CallFlowLog.mask(""))
        assertEquals("unknown", CallFlowLog.mask("anonymous"))
        // Last-4 of a short number would BE the number — mask it entirely.
        assertEquals("***", CallFlowLog.mask("911"))
        assertEquals("***", CallFlowLog.mask("1234"))
    }

    @Test
    fun `tail shortens opaque ids to a correlation handle`() {
        assertEquals("cdef", CallFlowLog.tail("abcdef"))
        assertEquals("ab", CallFlowLog.tail("ab"))
        assertEquals("-", CallFlowLog.tail(null))
        assertEquals("-", CallFlowLog.tail(""))
    }

    // ------------------------------------------------------------ shouldRotate

    @Test
    fun `rotation triggers only when a non-empty file would pass the cap`() {
        assertFalse("empty file never rotates", CallFlowLog.shouldRotate(0, 10, 100))
        assertFalse("oversized line on empty file still writes", CallFlowLog.shouldRotate(0, 1_000, 100))
        assertFalse("under the cap", CallFlowLog.shouldRotate(90, 10, 100))
        assertTrue("would pass the cap", CallFlowLog.shouldRotate(91, 10, 100))
        assertTrue(CallFlowLog.shouldRotate(100, 1, 100))
    }

    // ------------------------------------------------------- in-memory tail

    @Test
    fun `the in-memory tail is bounded and ordered newest-last`() {
        for (i in 1..CallFlowLog.MAX_MEMORY_ENTRIES + 50) {
            CallFlowLog.log("test", "event $i")
        }
        val tail = CallFlowLog.snapshot()
        assertEquals(CallFlowLog.MAX_MEMORY_ENTRIES, tail.size)
        assertTrue(tail.first().endsWith("event 51"))
        assertTrue(tail.last().endsWith("event ${CallFlowLog.MAX_MEMORY_ENTRIES + 50}"))
    }

    @Test
    fun `log before install never throws and readAll falls back to memory`() {
        CallFlowLog.log("test", "no sink yet")
        assertTrue(CallFlowLog.readAll().contains("no sink yet"))
    }

    // --------------------------------------------------------------- file sink

    @Test
    fun `installed sink appends lines and readAll returns them`() {
        val dir = tmp.newFolder("diag")
        CallFlowLog.install(dir)
        CallFlowLog.log("socket", "Ready")
        CallFlowLog.log("push", "kind:call received sess=ab12")
        CallFlowLog.awaitWritesForTest()

        val file = File(dir, CallFlowLog.FILE_NAME)
        assertTrue(file.exists())
        val text = file.readText()
        assertTrue(text.contains("[socket] Ready"))
        assertTrue(text.contains("[push] kind:call received sess=ab12"))
        assertTrue(CallFlowLog.readAll().contains("[socket] Ready"))
    }

    @Test
    fun `passing the size cap rotates the current file to dot-1 exactly once`() {
        val dir = tmp.newFolder("diag")
        CallFlowLog.install(dir)
        // One line bigger than the whole cap: the first append lands on the
        // EMPTY file (no rotation — an oversized line must still be written),
        // the next small line then trips the rotation.
        val huge = "x".repeat((CallFlowLog.MAX_FILE_BYTES + 1_024).toInt())
        CallFlowLog.log("test", huge)
        CallFlowLog.log("test", "after rotation")
        CallFlowLog.awaitWritesForTest()

        val current = File(dir, CallFlowLog.FILE_NAME)
        val rotated = File(dir, CallFlowLog.ROTATED_FILE_NAME)
        assertTrue(rotated.exists())
        assertTrue(rotated.readText().contains(huge.take(64)))
        assertTrue(current.exists())
        assertTrue(current.readText().contains("after rotation"))
        assertFalse(current.readText().contains(huge.take(64)))
        // readAll stitches rotated + current, oldest first.
        val all = CallFlowLog.readAll()
        assertTrue(all.indexOf("after rotation") > all.indexOf(huge.take(64)))
    }
}
