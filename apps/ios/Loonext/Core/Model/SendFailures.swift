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
    "40300": "This customer opted out",

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

/// #241 — why a send failed, in OUR vocabulary rather than the carrier's.
///
/// Hand-ported from `packages/shared/src/carrier-failure.ts`;
/// `CarrierFailureTests.swift` asserts the same table of cases.
///
/// `Messaging.swift` used to hold `carrierOptOutErrorCode = "40300"` and the
/// app branched on it to decide whether to offer a retry button — a Telnyx
/// constant shipped inside an iOS build. A second carrier would have meant
/// editing three apps and shipping them, which #339 established takes weeks to
/// reach everybody and never reaches some phones at all.
enum CarrierFailureReason: String, Sendable {
    case optOut = "opt_out"
    case unreachable
    case contentBlocked = "content_blocked"
    case spamBlocked = "spam_blocked"
    case rateLimited = "rate_limited"
    case expired
    case notProvisioned = "not_provisioned"
    case unknown
}

/// Telnyx codes → our reasons. The ONLY place a vendor code appears in a
/// decision on this client, and it exists only to classify rows written before
/// the server sent a reason.
private let telnyxReasons: [String: CarrierFailureReason] = [
    "40300": .optOut,
    "40001": .unreachable, "40012": .unreachable, "40310": .unreachable,
    "40004": .unreachable, "40006": .unreachable, "40008": .unreachable,
    "40002": .contentBlocked, "40017": .contentBlocked, "40009": .contentBlocked,
    "40316": .contentBlocked, "40317": .contentBlocked, "40328": .contentBlocked,
    "40003": .spamBlocked, "40015": .spamBlocked, "40322": .spamBlocked,
    "40011": .rateLimited, "40016": .rateLimited, "40018": .rateLimited,
    "40318": .rateLimited,
    "40005": .expired, "40014": .expired,
    "40010": .notProvisioned, "40329": .notProvisioned, "40330": .notProvisioned,
    "40100": .notProvisioned, "40314": .notProvisioned, "40305": .notProvisioned,
    "40308": .notProvisioned,
]

/// `.unknown` for anything unmapped, and that is honest rather than a soft
/// default: an unrecognised failure must never become `.optOut`, because that
/// is the one reason with a legal meaning — only the customer can lift a STOP.
func classifySendFailure(_ errorCode: String?) -> CarrierFailureReason {
    let code = errorCode?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if code.isEmpty { return .unknown }
    return telnyxReasons[code] ?? .unknown
}

/// The reason to act on: what the server classified, falling back to the code.
///
/// The fallback is not defensive padding — rows written before the server sent
/// a reason will sit on somebody's phone for months (#339), and a client that
/// only understood the new field would show the wrong affordance on every one.
func failureReasonOf(_ reason: String?, _ errorCode: String?) -> CarrierFailureReason {
    let wire = reason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !wire.isEmpty, let known = CarrierFailureReason(rawValue: wire) { return known }
    return classifySendFailure(errorCode)
}

/// Is offering "try again" honest? An opt-out never is: the block is the
/// customer's own choice and only they can lift it.
func isRetryableFailure(_ reason: CarrierFailureReason) -> Bool {
    reason != .optOut
}
