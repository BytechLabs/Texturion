package com.loonext.android.telephony

import org.junit.Assert.assertEquals
import org.junit.Test

class ClientStateTest {
    /** The server mints btoa('oc_customer|<e164>|<nonce>'). */
    private fun serverMint(raw: String): String =
        java.util.Base64.getEncoder().encodeToString(raw.toByteArray(Charsets.UTF_8))

    @Test
    fun `decoding then the SDK's re-encode reproduces the server value byte-for-byte`() {
        val raw = "oc_customer|+15551234567|6a1c2f9e-9b7d-4f1e-8f7a-2c3d4e5f6a7b"
        val server = serverMint(raw)

        val sdkInput = ClientState.forAndroidSdk(server)

        assertEquals(raw, sdkInput)
        // What the Android SDK will put on the wire == what the webhook expects.
        assertEquals(server, ClientState.wireValue(sdkInput))
    }

    @Test
    fun `long states survive the round trip (no line wrapping)`() {
        // > 57 raw bytes — a wrapping base64 encoder would corrupt this.
        val raw = "oc_customer|+15551234567|" + "n".repeat(80)
        val server = serverMint(raw)
        assertEquals(server, ClientState.wireValue(ClientState.forAndroidSdk(server)))
    }

    @Test
    fun `a non-base64 value passes through unchanged`() {
        // The webhook rejects it either way — identical to a forged state.
        assertEquals("not base64!!", ClientState.forAndroidSdk("not base64!!"))
    }
}
