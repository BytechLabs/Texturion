package com.loonext.android.features.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * RFC 7636 PKCE pieces for the Google sign-in authorize flow (#166):
 * verifier = 43–128 chars from the unreserved set, challenge =
 * base64url(SHA-256(verifier)) with no padding. Pure JVM (java.util.Base64,
 * not android.util) so the vectors run as plain unit tests.
 */
object Pkce {
    /** RFC 3986 §2.3 unreserved characters — the full verifier alphabet. */
    private const val UNRESERVED =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"

    private val random = SecureRandom()

    fun generateVerifier(length: Int = 64): String {
        require(length in 43..128) { "PKCE verifier must be 43-128 chars" }
        return randomFrom(UNRESERVED, length)
    }

    fun challenge(verifier: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest.getInstance("SHA-256")
                .digest(verifier.toByteArray(Charsets.US_ASCII)),
        )

    /**
     * CSRF nonce riding the redirect_to query. Alphanumeric only so it
     * survives URL encoding round trips byte-for-byte.
     */
    fun generateState(): String =
        randomFrom("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 32)

    private fun randomFrom(alphabet: String, length: Int): String =
        buildString(length) {
            repeat(length) { append(alphabet[random.nextInt(alphabet.length)]) }
        }
}
