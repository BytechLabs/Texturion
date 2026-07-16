package com.loonext.android.features.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PkceTest {
    // --- challenge: fixed vectors (computed with a verified python
    // reference: base64url(sha256(ascii(verifier))) stripped of padding;
    // the first is RFC 7636 Appendix B and reproduces its published value) ---

    @Test
    fun `RFC 7636 appendix B vector`() {
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            Pkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        )
    }

    @Test
    fun `minimum-length vector (43 chars)`() {
        assertEquals(
            "ZtNPunH49FD35FWYhT5Tv8I7vRKQJ8uxMaL0_9eHjNA",
            Pkce.challenge("a".repeat(43)),
        )
    }

    @Test
    fun `maximum-length vector (128 chars, full unreserved specials)`() {
        val verifier = ("Loonext-166_PKCE.vector~" + "x".repeat(104))
        assertEquals(128, verifier.length)
        assertEquals(
            "cYDGCYEImKLHthwt8FffvPJtQRkz6e8yiUYGTuRvotI",
            Pkce.challenge(verifier),
        )
    }

    @Test
    fun `challenge is 43 base64url chars with no padding`() {
        val challenge = Pkce.challenge(Pkce.generateVerifier())
        assertEquals(43, challenge.length) // 32 bytes -> ceil(32*4/3) unpadded
        assertTrue(challenge.matches(Regex("^[A-Za-z0-9_-]+$")))
    }

    // --- generateVerifier ---

    @Test
    fun `verifier is 64 unreserved chars by default`() {
        val verifier = Pkce.generateVerifier()
        assertEquals(64, verifier.length)
        assertTrue(verifier.matches(Regex("^[A-Za-z0-9._~-]+$")))
    }

    @Test
    fun `verifier honors explicit RFC bounds`() {
        assertEquals(43, Pkce.generateVerifier(43).length)
        assertEquals(128, Pkce.generateVerifier(128).length)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `verifier below 43 chars is rejected`() {
        Pkce.generateVerifier(42)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `verifier above 128 chars is rejected`() {
        Pkce.generateVerifier(129)
    }

    @Test
    fun `two verifiers differ`() {
        assertNotEquals(Pkce.generateVerifier(), Pkce.generateVerifier())
    }

    // --- generateState ---

    @Test
    fun `state is 32 alphanumeric chars and unique per call`() {
        val state = Pkce.generateState()
        assertEquals(32, state.length)
        assertTrue(state.matches(Regex("^[A-Za-z0-9]+$")))
        assertNotEquals(state, Pkce.generateState())
    }
}
