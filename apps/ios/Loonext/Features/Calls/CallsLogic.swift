import Foundation

/// Pure call-display helpers — a Swift port of the Android
/// `features/calls/CallsLogic.kt` (itself a port of the web's
/// lib/format/call.ts + voicemail-player screeningLabel), kept free of UI
/// imports so they unit-test without a device.

/// Display resolution order: contact > CNAM dip > formatted number.
func callerDisplayName(_ call: Call) -> String {
    if let contact = call.contact_name, !contact.isBlank { return contact }
    if let cnam = call.caller_name, !cnam.isBlank { return cnam }
    if let number = call.caller_e164, !number.isBlank { return formatPhone(number) }
    return "Unknown caller"
}

/// "4m 32s" / "58s" — talk time for answered calls (never ring time).
func formatCallDuration(_ seconds: Int) -> String {
    let whole = max(0, seconds)
    let minutes = whole / 60
    let rest = whole % 60
    if minutes == 0 { return "\(rest)s" }
    return rest == 0 ? "\(minutes)m" : "\(minutes)m \(rest)s"
}

/// The row's plain-language outcome line (web parity). Outbound speaks from
/// the crew's side ("You called…", "No answer" — nothing was missed by the
/// crew). A null outcome is a session still in flight. #191: an answered call
/// names the acting member (placer/answerer) when the server resolved one, so a
/// crew's log doesn't mis-attribute every member's call to the viewer.
func callOutcomeLabel(_ call: Call) -> String {
    let outbound = call.direction == "outbound"
    let dur = call.forward_seconds > 0
        ? " · \(formatCallDuration(call.forward_seconds))"
        : ""
    let actor = call.answered_by_name
    switch call.outcome {
    case CallOutcome.missed:
        return outbound ? "No answer" : "Missed"
    case CallOutcome.voicemail:
        return "Voicemail"
    case CallOutcome.answered:
        if outbound {
            // "Sam called" when the placer is known; "You called" (crew's-side
            // framing) for legacy/pre-#191 rows that carry no placer.
            return (actor.map { "\($0) called" } ?? "You called") + dur
        }
        // "Answered by Sam" when the answerer is known; bare "Answered" otherwise.
        return (actor.map { "Answered by \($0)" } ?? "Answered") + dur
    default:
        // Unknown future outcomes degrade to the in-flight copy, never crash.
        return outbound ? "Calling…" : "In progress"
    }
}

/// An INBOUND miss is the row's one urgent element (amber); nothing else is.
func isActionableMiss(_ call: Call) -> Bool {
    call.outcome == CallOutcome.missed && call.direction != "outbound"
}

/// Honest carrier-screening label from the raw verdict (web parity). Quiet by
/// design — the verdict came from the network, not from us.
func screeningLabel(_ result: String?) -> String? {
    guard let result, !result.isBlank else { return nil }
    let value = result.lowercased()
    if value.contains("no_flag") || value.contains("clean") { return nil }
    let markers = ["spam", "fraud", "scam", "robo", "flag", "spoof"]
    return markers.contains(where: { value.contains($0) }) ? "Spam likely" : nil
}

/// "0:42" / "12:04" / "1:02:33" — the live in-call timer.
func formatTimer(elapsedMs: Int) -> String {
    let total = max(0, elapsedMs / 1000)
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let seconds = total % 60
    if hours > 0 {
        return String(format: "%d:%02d:%02d", hours, minutes, seconds)
    }
    return String(format: "%d:%02d", minutes, seconds)
}

/// "0:42" for a voicemail length.
func formatVoicemailLength(_ seconds: Int) -> String {
    formatTimer(elapsedMs: seconds * 1000)
}

/// Normalize dialed digits to the E.164 the API dials: 10 NANP digits, 11
/// with a leading 1, or an already-+1 string. nil = not dialable yet (the
/// Call button stays disabled — an obviously-short number can't be dialed).
func dialableE164(_ raw: String) -> String? {
    let digits = raw.filter(\.isNumber)
    let trimmed = raw.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("+") && digits.count == 11 && digits.first == "1" {
        return "+\(digits)"
    }
    if digits.count == 10 { return "+1\(digits)" }
    if digits.count == 11 && digits.first == "1" { return "+\(digits)" }
    return nil
}

/// The saved-contact name matching typed dialer digits (#186 item 5), or nil.
/// The server `q` matches name AND phone, so we double-check the typed digits
/// actually appear in the hit's number before lighting the correlation — a
/// name-only match on unrelated digits must never mislabel the dial. A blank
/// name falls back to the formatted number. The Android `lookupContact` twin;
/// kept pure so the correlation is unit-testable without a device.
func dialerContactName(matching typed: String, in contacts: [Contact]) -> String? {
    let digits = typed.filter(\.isNumber)
    guard !digits.isEmpty else { return nil }
    guard let match = contacts.first(where: {
        $0.phone_e164.filter(\.isNumber).contains(digits)
    }) else { return nil }
    if let name = match.name, !name.isBlank { return name }
    return formatPhone(match.phone_e164)
}

/// "(415) 555-01…" progressive format while typing (NANP-shaped input).
func formatAsYouDial(_ raw: String) -> String {
    let digits = raw.filter(\.isNumber)
    let national: String
    if digits.count == 11 && digits.first == "1" {
        national = String(digits.dropFirst())
    } else if digits.count <= 10 {
        national = digits
    } else {
        return raw
    }
    if national.isEmpty { return "" }
    if national.count <= 3 { return "(\(national)" }
    let npa = national.prefix(3)
    if national.count <= 6 {
        return "(\(npa)) \(national.dropFirst(3))"
    }
    let nxx = national.dropFirst(3).prefix(3)
    return "(\(npa)) \(nxx)-\(national.dropFirst(6))"
}
