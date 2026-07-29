package com.loonext.android.features.thread

import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.MessageStatus
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The one retry-affordance rule (SPEC): outbound + failed + no carrier id +
 * error code != 40300 (carrier opt-out block).
 */
class RetryableTest {

    private fun message(
        direction: String = MessageDirection.OUTBOUND,
        status: String? = MessageStatus.FAILED,
        telnyxId: String? = null,
        errorCode: String? = "internal",
        errorReason: String? = null,
    ) = Message(
        id = "m1",
        conversation_id = "c1",
        direction = direction,
        body = "hello",
        status = status,
        telnyx_message_id = telnyxId,
        error_code = errorCode,
        error_reason = errorReason,
        created_at = "2026-07-15T00:00:00Z",
    )

    @Test
    fun `api-level failure with no carrier id is retryable`() {
        assertTrue(message().retryable)
    }

    @Test
    fun `a carrier-assigned id blocks retry`() {
        assertFalse(message(telnyxId = "tx_123").retryable)
    }

    @Test
    fun `a carrier opt-out blocks retry, however it reached us`() {
        // #241: both routes to the same conclusion. The server now sends the
        // reason; rows written before it still carry only the vendor code, and
        // both must withhold the button — a STOP is the customer's own choice.
        assertFalse(message(errorReason = "opt_out").retryable)
        assertFalse(message(errorCode = "40300").retryable)
    }

    @Test
    fun `the server's reason wins over a code that disagrees`() {
        // A second carrier spells its codes differently; the reason is what
        // the app is allowed to believe.
        assertTrue(message(errorReason = "rate_limited", errorCode = "40300").retryable)
    }

    @Test
    fun `only failed status is retryable`() {
        assertFalse(message(status = MessageStatus.QUEUED).retryable)
        assertFalse(message(status = MessageStatus.SENT).retryable)
        assertFalse(message(status = MessageStatus.DELIVERED).retryable)
        assertFalse(message(status = null).retryable)
    }

    @Test
    fun `only outbound is retryable`() {
        assertFalse(
            message(
                direction = MessageDirection.INBOUND,
                status = MessageStatus.RECEIVED,
            ).retryable,
        )
        assertFalse(message(direction = MessageDirection.NOTE, status = null).retryable)
    }

    @Test
    fun `a null error code with no carrier id stays retryable`() {
        assertTrue(message(errorCode = null).retryable)
    }
}
