import Foundation

/// client_state wire adaptation for the Telnyx iOS SDK.
///
/// The contract (BINDING): the webhook must receive the exact base64
/// client_state that POST /v1/calls/browser minted — it base64-decodes it to
/// the `oc_customer|<customer>|<nonce>` tag and hangs up any outgoing PSTN leg
/// whose nonce doesn't validate.
///
/// Which SDK does what (each verified against source):
/// - The web @telnyx/webrtc SDK sends the clientState option to the wire
///   AS-IS, so the web client passes the server value verbatim.
/// - The ANDROID SDK base64-encodes its clientState argument internally
///   (StringExtensionsKt.encodeBase64, verified from bytecode), so the
///   Android client base64-DECODES the server value first and lets the SDK's
///   re-encode reproduce the server bytes on the wire.
/// - The iOS SDK (TelnyxRTC 4.x) does NOT re-encode: TxCallOptions documents
///   "clientState string should be base64 encoded" (i.e. by the caller) and
///   InviteMessage puts the value into the verto dialogParams UNCHANGED —
///   verified against TelnyxRTC/Telnyx/Models/TxCallOptions.swift and
///   TelnyxRTC/Telnyx/Verto/InviteMessage.swift on team-telnyx/
///   telnyx-webrtc-ios (main, v4.x).
///
/// So on iOS "verbatim" is literal: hand the server's client_state string to
/// `newCall` byte-for-byte. Decoding it Android-style here would put the RAW
/// tag on the wire and the webhook would hang up every outbound leg.
enum ClientState {
    /// The string to pass into the SDK's newCall so the WIRE carries the
    /// server's client_state byte-for-byte. On iOS that is the server value
    /// itself — the SDK sends it unmodified.
    static func forIOSSdk(_ serverClientState: String) -> String {
        serverClientState
    }

    /// What the iOS SDK will put on the wire for a given newCall input
    /// (identity — no internal re-encode).
    static func wireValue(_ sdkInput: String) -> String {
        sdkInput
    }

    /// Decode the server's tag (`oc_customer|<e164>|<nonce>`) for
    /// verification/tests. Nil when the input isn't valid base64 — the
    /// webhook would reject such a leg exactly like a forged state.
    static func decodedTag(_ clientState: String) -> String? {
        guard let data = Data(base64Encoded: clientState) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// What the server's `btoa(tag)` mints for a raw tag — standard-alphabet,
    /// padded, unwrapped base64 (Foundation's default). Used by the tests to
    /// prove the round trip both ways.
    static func serverMint(_ rawTag: String) -> String {
        Data(rawTag.utf8).base64EncodedString()
    }
}
