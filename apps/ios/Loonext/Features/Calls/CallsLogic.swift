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
/// crew). A null outcome is a session still in flight.
func callOutcomeLabel(_ call: Call) -> String {
    let outbound = call.direction == "outbound"
    switch call.outcome {
    case CallOutcome.missed:
        return outbound ? "No answer" : "Missed"
    case CallOutcome.voicemail:
        return "Voicemail"
    case CallOutcome.answered:
        if outbound && call.forward_seconds > 0 {
            return "You called · \(formatCallDuration(call.forward_seconds))"
        }
        if outbound { return "You called" }
        if call.forward_seconds > 0 {
            return "Answered · \(formatCallDuration(call.forward_seconds))"
        }
        return "Answered"
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
