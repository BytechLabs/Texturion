import Foundation

/// #366 — what to say when the crew outgrows a single call's fan-out.
///
/// A call rings a bounded number of phones. A crew larger than that used to
/// have the same members left out of every call, and nothing in the product
/// said so — the warning went to Sentry, not to the owner and not to the
/// people who were not ringing.
///
/// Nil — say nothing — is the answer for almost every workspace, and that
/// matters: a line about a limit nobody is near is noise that trains people to
/// skip the card it sits on. The ceiling arrives from the server rather than
/// being hard-coded here, so a client can never disagree with the engine.
///
/// Same words as web and Android, deliberately.
func ringCeilingLine(_ number: PhoneNumberSummary) -> String? {
    guard let targets = number.ring_targets,
          let limit = number.ring_target_limit,
          targets > limit
    else { return nil }
    return "\(targets) people could be rung by a call to this number, and one "
        + "call rings \(limit). Everyone still takes turns — a different "
        + "\(limit) ring each time — but nobody is rung on every call."
}
