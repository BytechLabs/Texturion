import Foundation

/// #538 (audit) — turning your own notifications off while you are the one on call.
///
/// The hand-port of `packages/shared/src/on-call-notifications.ts`, and the third
/// copy after `core/oncall/OnCallSilence.kt`.
///
/// ## What the audit found
///
/// The issue asked for other places that would benefit from a confirmation. Almost
/// everywhere already had one: leaving a workspace names the consequence, turning
/// your own two-factor off names it, releasing a number names it. The notifications
/// screen did not, and it is the one where silence is the whole failure.
///
/// A crew nominates somebody on call. Unclaimed leads page that person. If they
/// switch push off — perfectly reasonable on an ordinary evening — the pages still
/// fire and reach nothing. Nobody else is told, because as far as the system is
/// concerned the alert was delivered. The customer texted, nobody answered, and the
/// first anyone hears about it is the customer going somewhere else.
///
/// ## Why this warns and does not refuse
///
/// Somebody who wants their phone quiet is entitled to a quiet phone, and a product
/// that refuses would be a product people work around by turning the phone off —
/// which is worse, because then we cannot tell.
enum OnCallSilence {

    /// The confirm button, which says what happens rather than "OK".
    static let confirm = "Turn it off anyway"

    /// ...and the way out.
    static let cancel = "Leave it on"

    /// One shift, reduced to what this decision needs.
    struct Shift {
        let userId: String
        let startsAt: String
        let endsAt: String
    }

    /// Is this member on call at this instant, for any number?
    ///
    /// The end is EXCLUSIVE, so two people handing over at six o'clock do not both
    /// count for that minute — otherwise the handover warns the wrong person.
    static func isOnCallNow(
        _ shifts: [Shift],
        userId: String,
        now: Date = Date()
    ) -> Bool {
        shifts.contains { shift in
            guard shift.userId == userId else { return false }
            // An unreadable stamp is treated as NOT covering the moment. Assuming it
            // does would warn somebody who is not on call, and a warning that fires
            // wrongly is one people learn to dismiss.
            guard
                let from = parseWireTimestamp(shift.startsAt),
                let until = parseWireTimestamp(shift.endsAt)
            else { return false }
            return now >= from && now < until
        }
    }

    /// What to say before somebody on call goes quiet.
    ///
    /// Nil when there is nothing to warn about — not on call, or switching something
    /// ON — so a caller can ask unconditionally. Turning notifications back on is the
    /// good outcome, and a dialog there would be punishing the fix.
    static func warning(
        onCall: Bool,
        turningOff: Bool,
        channel: String
    ) -> String? {
        guard onCall, turningOff else { return nil }
        let what = channel == "push" ? "Push alerts" : "Emails"
        return "You're on call right now. \(what) are how a new customer nobody has "
            + "answered reaches you, and with this off those pages go nowhere — no "
            + "one else is told. Hand the shift over first if you need to be "
            + "unreachable."
    }
}
