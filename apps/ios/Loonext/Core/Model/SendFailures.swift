import Foundation

/// Why a text did not arrive, in words the person reading the thread can act on.
///
/// Every failed send except a carrier opt-out used to read "Not delivered",
/// which tells you nothing about whether to fix the number, wait, or stop
/// trying. The provider does tell us: it stores an error code on the row, and
/// the codes below are the ones a small business actually hits.
///
/// Codes and their meanings come from Telnyx's messaging error reference. An
/// unknown or absent code keeps the old wording, because inventing a reason is
/// worse than admitting we do not have one.
///
/// Twin of packages/shared/src/send-failures.ts and
/// apps/android/.../core/model/SendFailures.kt. Keep the three identical.

/// The fallback, and the whole of what a failed send used to say.
let genericSendFailure = "Not delivered"

private let sendFailureMessages: [String: String] = [
    // The recipient's own choice. Only they can undo it, by texting START.
    carrierOptOutErrorCode: "This customer opted out",

    // Nothing on the other end can receive it.
    "40001": "That number can't receive texts",
    "40012": "That number isn't textable",
    "40310": "That number isn't textable",

    // Carriers judged the content. Worth rewording and trying again in the
    // temporary cases; pointless in the permanent ones, so the wording differs.
    "40002": "Carriers are blocking this right now",
    "40017": "Carriers are blocking this right now",
    "40003": "Carriers blocked this as spam",
    "40015": "Carriers blocked this as spam",
    "40322": "Carriers blocked this as spam",

    // Volume, not content.
    "40011": "Sent too fast for carriers. Try again shortly",
    "40016": "Sent too fast for carriers. Try again shortly",
    "40018": "Sent too fast for carriers. Try again shortly",
    "40318": "Sent too fast for carriers. Try again shortly",

    // Their phone, momentarily.
    "40004": "Their phone rejected it",
    "40006": "Their phone couldn't receive it",
    "40008": "Their phone couldn't receive it",

    // It sat too long to still be worth sending.
    "40005": "It expired before it could send",
    "40014": "It expired before it could send",

    // Something about the message itself.
    "40009": "Carriers wouldn't accept this message",
    "40316": "There was nothing to send",
    "40317": "Carriers wouldn't accept that attachment",
    "40328": "Too long to send",

    // Registration and number setup, which the owner can actually go and fix.
    "40010": "Your US texting registration isn't approved yet",
    "40329": "Your US texting registration isn't approved yet",
    "40330": "This number isn't set up for texting yet",
    "40100": "This number isn't set up for texting yet",
    "40314": "Texting is turned off for this number",
    "40305": "This number can't send texts",
    "40308": "This number can't send pictures",
]

/// The sentence to show under a failed message. Falls back to the plain
/// "Not delivered" for a code we cannot explain honestly.
func sendFailureMessage(_ errorCode: String?) -> String {
    let key = (errorCode ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return sendFailureMessages[key] ?? genericSendFailure
}
