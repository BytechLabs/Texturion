package com.loonext.android.features.auth

import com.loonext.android.core.net.ApiException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptchaGateTest {
    @Test
    fun `structural error_code captcha_failed is the gate`() {
        assertTrue(
            isCaptchaRejection(
                ApiException("captcha_failed", "captcha verification process failed", 400),
            ),
        )
    }

    @Test
    fun `code alone is enough even with an unhelpful message`() {
        assertTrue(isCaptchaRejection(ApiException("captcha_failed", "Bad request", 400)))
    }

    @Test
    fun `older GoTrue ships the gate as a message with no stable code`() {
        // The exact production string from the founder's device (#166).
        assertTrue(
            isCaptchaRejection(
                ApiException(
                    "unauthorized",
                    "captcha protection: request disallowed (no captcha_token found)",
                    500,
                ),
            ),
        )
    }

    @Test
    fun `message sniff is case-insensitive`() {
        assertTrue(
            isCaptchaRejection(ApiException("bad_request", "CAPTCHA verification failed", 400)),
        )
    }

    @Test
    fun `wrong password is not the captcha gate`() {
        assertFalse(
            isCaptchaRejection(
                ApiException("invalid_credentials", "Invalid login credentials", 400),
            ),
        )
    }

    @Test
    fun `network failures are not the captcha gate`() {
        assertFalse(
            isCaptchaRejection(
                ApiException("network", "Can't reach the sign-in service.", 0),
            ),
        )
    }

    @Test
    fun `non-ApiException throwables are never the gate`() {
        assertFalse(isCaptchaRejection(IllegalStateException("captcha")))
    }
}
