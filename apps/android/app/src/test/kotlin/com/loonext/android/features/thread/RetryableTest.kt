package com.loonext.android.features.thread

import com.loonext.android.core.model.CARRIER_OPT_OUT_ERROR_CODE
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
    ) = Message(
        id = "m1",
        conversation_id = "c1",
        direction = direction,
        body = "hello",
        status = status,
        telnyx_message_id = telnyxId,
        error_code = errorCode,
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
    fun `carrier opt-out 40300 blocks retry`() {
        assertFalse(message(errorCode = CARRIER_OPT_OUT_ERROR_CODE).retryable)
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
