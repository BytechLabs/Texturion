package com.loonext.android.core.diag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** #198: the call-flow trace's line shape and its last-4 masking. */
class CallFlowLogTest {
    @Test
    fun `line is the tag then the message`() {
        assertEquals("[socket] Ready", CallFlowLog.line("socket", "Ready"))
    }

    @Test
    fun `line flattens newlines so one event is always one line`() {
        val line = CallFlowLog.line("sip", "INVITE\r\nheaders:\nmany")
        assertFalse(line.contains('\n'))
        assertFalse(line.contains('\r'))
        assertTrue(line.contains("INVITE"))
        assertTrue(line.contains("many"))
    }

    @Test
    fun `mask keeps only the last four digits of anything phone-shaped`() {
        assertEquals("***0123", CallFlowLog.mask("+15555550123"))
        assertEquals("***0123", CallFlowLog.mask("(555) 555-0123"))
        assertEquals("unknown", CallFlowLog.mask(null))
        assertEquals("unknown", CallFlowLog.mask(""))
        assertEquals("unknown", CallFlowLog.mask("anonymous"))
        // Last-4 of a short number would BE the number, so it is masked entirely.
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
}
