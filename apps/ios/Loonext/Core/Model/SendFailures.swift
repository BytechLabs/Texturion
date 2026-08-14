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
///
/// #228: a KEY rather than a sentence, because this table is built at file-init
/// — before any view exists, so a sentence written here could only ever be
/// written in one language.
let genericSendFailureKey = "domain.sendFailureGeneric"

/// The English, for the callers that have not been handed a reader yet.
///
/// Computed rather than stored, for the reason `voicemailIntakeSourceLabel`
/// in `Model/Calls.swift` gives.
var genericSendFailure: String {
    AppStrings.translate(nil, genericSendFailureKey)
}

private let sendFailureKeys: [String: String] = [
    // The recipient's own choice. Only they can undo it, by texting START.
    "40300": "domain.sendFailureOptedOut",

    // Nothing on the other end can receive it.
    "40001": "domain.sendFailureUnreachable",
    "40012": "domain.sendFailureNotTextable",
    "40310": "domain.sendFailureNotTextable",

    // Carriers judged the content. Worth rewording and trying again in the
    // temporary cases; pointless in the permanent ones, so the wording differs.
    "40002": "domain.sendFailureBlockedNow",
    "40017": "domain.sendFailureBlockedNow",
    "40003": "domain.sendFailureSpam",
    "40015": "domain.sendFailureSpam",
    "40322": "domain.sendFailureSpam",

    // Volume, not content.
    "40011": "domain.sendFailureRateLimited",
    "40016": "domain.sendFailureRateLimited",
    "40018": "domain.sendFailureRateLimited",
    "40318": "domain.sendFailureRateLimited",

    // Their phone, momentarily.
    "40004": "domain.sendFailureHandsetRejected",
    "40006": "domain.sendFailureHandsetUnavailable",
    "40008": "domain.sendFailureHandsetUnavailable",

    // It sat too long to still be worth sending.
    "40005": "domain.sendFailureExpired",
    "40014": "domain.sendFailureExpired",

    // Something about the message itself.
    "40009": "domain.sendFailureContent",
    "40316": "domain.sendFailureEmpty",
    "40317": "domain.sendFailureAttachment",
    "40328": "domain.sendFailureTooLong",

    // Registration and number setup, which the owner can actually go and fix.
    "40010": "domain.sendFailureRegistration",
    "40329": "domain.sendFailureRegistration",
    "40330": "domain.sendFailureNumberNotReady",
    "40100": "domain.sendFailureNumberNotReady",
    "40314": "domain.sendFailureTextingOff",
    "40305": "domain.sendFailureNoSms",
    "40308": "domain.sendFailureNoMms",
]

/// The sentence to show under a failed message. Falls back to the plain
/// "Not delivered" for a code we cannot explain honestly.
///
/// #228: `locale` is last and defaulted, so `CarrierFailureTests` keeps pinning
/// the English table while the thread that knows its reader passes `appLocale`.
/// Nothing about WHICH sentence is chosen depends on it — the choice is made
/// against the carrier's own numeric code, which arrives in one language
/// whoever is reading.
func sendFailureMessage(_ errorCode: String?, locale: String? = nil) -> String {
    let code = (errorCode ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return AppStrings.translate(locale, sendFailureKeys[code] ?? genericSendFailureKey)
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
