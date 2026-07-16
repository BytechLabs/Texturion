package com.loonext.android.features.auth

import com.loonext.android.core.auth.PendingOAuth
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OAuthReturnTest {
    private val pending = PendingOAuth(
        state = "state-nonce-123",
        verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
        createdAtMillis = 1_000_000L,
    )
    private val fresh = pending.createdAtMillis + 30_000L

    private fun resolve(
        code: String? = null,
        state: String? = null,
        error: String? = null,
        errorDescription: String? = null,
        pending: PendingOAuth? = this.pending,
        now: Long = fresh,
    ) = resolveOAuthReturn(code, state, error, errorDescription, pending, now)

    // --- happy path ---

    @Test
    fun `matching state and fresh pending exchanges with the stored verifier`() {
        val result = resolve(code = "auth-code-1", state = "state-nonce-123")
        assertEquals(
            OAuthReturn.Exchange("auth-code-1", pending.verifier),
            result,
        )
    }

    @Test
    fun `absent state is tolerated - the verifier is the cryptographic gate`() {
        val result = resolve(code = "auth-code-1", state = null)
        assertEquals(OAuthReturn.Exchange("auth-code-1", pending.verifier), result)
    }

    // --- state-nonce validation ---

    @Test
    fun `mismatched state is rejected`() {
        val result = resolve(code = "auth-code-1", state = "someone-elses-nonce")
        assertTrue(result is OAuthReturn.Failed)
        assertEquals(
            "That sign-in response didn't match the one this app started. Try again.",
            (result as OAuthReturn.Failed).message,
        )
    }

    @Test
    fun `redirect with no pending handoff is rejected`() {
        val result = resolve(code = "auth-code-1", state = "state-nonce-123", pending = null)
        assertTrue(result is OAuthReturn.Failed)
        assertEquals(
            "That Google sign-in expired. Start it again.",
            (result as OAuthReturn.Failed).message,
        )
    }

    @Test
    fun `handoff older than the TTL is rejected`() {
        val result = resolve(
            code = "auth-code-1",
            state = "state-nonce-123",
            now = pending.createdAtMillis + OAUTH_PENDING_TTL_MILLIS + 1,
        )
        assertTrue(result is OAuthReturn.Failed)
    }

    @Test
    fun `handoff exactly at the TTL still exchanges`() {
        val result = resolve(
            code = "auth-code-1",
            state = "state-nonce-123",
            now = pending.createdAtMillis + OAUTH_PENDING_TTL_MILLIS,
        )
        assertTrue(result is OAuthReturn.Exchange)
    }

    // --- error params (fixed copy, never echoed intent text) ---

    @Test
    fun `access_denied maps to the cancelled message`() {
        val result = resolve(error = "access_denied")
        assertEquals(
            OAuthReturn.Failed("Google sign-in was cancelled."),
            result,
        )
    }

    @Test
    fun `provider-not-enabled maps to the unprovisioned message`() {
        val result = resolve(
            error = "validation_failed",
            errorDescription = "Unsupported provider: provider is not enabled",
        )
        assertEquals(
            OAuthReturn.Failed("Google sign-in isn't set up for this app yet."),
            result,
        )
    }

    @Test
    fun `unknown error params map to fixed generic copy, not the raw text`() {
        val result = resolve(
            error = "server_error",
            errorDescription = "<script>alert(1)</script>",
        )
        assertEquals(OAuthReturn.Failed("Google sign-in failed. Try again."), result)
    }

    @Test
    fun `error params win even when a code is also present`() {
        val result = resolve(code = "auth-code-1", error = "access_denied")
        assertTrue(result is OAuthReturn.Failed)
    }

    // --- degenerate redirects ---

    @Test
    fun `no code and no error fails without exchanging`() {
        val result = resolve(state = "state-nonce-123")
        assertEquals(OAuthReturn.Failed("Google sign-in failed. Try again."), result)
    }

    @Test
    fun `blank code fails without exchanging`() {
        val result = resolve(code = "  ", state = "state-nonce-123")
        assertTrue(result is OAuthReturn.Failed)
    }
}
