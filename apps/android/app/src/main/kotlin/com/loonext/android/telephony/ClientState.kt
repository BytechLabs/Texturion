package com.loonext.android.telephony

/**
 * client_state wire adaptation for the Telnyx ANDROID SDK.
 *
 * The contract (BINDING): the webhook must receive the exact base64
 * client_state that POST /v1/calls/browser minted — it base64-decodes it to
 * the `oc_customer|<customer>|<nonce>` tag and hangs up any outgoing PSTN leg
 * whose nonce doesn't validate.
 *
 * The web @telnyx/webrtc SDK sends the clientState option to the wire AS-IS,
 * so the web client passes the server value verbatim. The Android SDK is
 * different: `newInvite` base64-encodes its clientState argument internally
 * (StringExtensionsKt.encodeBase64 — android.util.Base64 NO_WRAP, standard
 * alphabet, padded) before putting it on the wire. Passing the server's
 * already-base64 string would double-encode it and every outbound leg would
 * be hung up by the webhook.
 *
 * So on Android "verbatim" means: base64-DECODE the server value here, hand
 * the decoded tag to the SDK, and the SDK's re-encode reproduces the server's
 * exact base64 on the wire (both sides use standard-alphabet, padded, unwrapped
 * base64 — btoa() server-side, Base64.NO_WRAP in the SDK).
 */
object ClientState {
    /**
     * The string to pass into the SDK's newCall so the WIRE carries the
     * server's client_state byte-for-byte. Falls back to the raw input when
     * it isn't valid base64 (the webhook will then reject the leg — honest
     * failure, identical to a forged state).
     */
    fun forAndroidSdk(serverClientState: String): String = try {
        String(
            java.util.Base64.getDecoder().decode(serverClientState),
            Charsets.UTF_8,
        )
    } catch (_: IllegalArgumentException) {
        serverClientState
    }

    /** What the Android SDK will put on the wire for a given newCall input. */
    fun wireValue(sdkInput: String): String =
        java.util.Base64.getEncoder().encodeToString(sdkInput.toByteArray(Charsets.UTF_8))
}
