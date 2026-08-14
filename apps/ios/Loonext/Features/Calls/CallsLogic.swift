import Foundation

/// Pure call-display helpers — a Swift port of the Android
/// `features/calls/CallsLogic.kt` (itself a port of the web's
/// lib/format/call.ts + voicemail-player screeningLabel), kept free of UI
/// imports so they unit-test without a device.

/// Display resolution order: contact > CNAM dip > formatted number.
/// #516 — the Note control's title while its conversation link is still being
/// found, mirroring Android's `noteControlLabel`.
///
/// A plain greyed "Note" read as broken to the founder (#202), and an absent
/// one read as a missing feature (#516). Saying "Linking…" says which of the
/// two this is, and stops saying it the moment the lookup gives up so the
/// control never promises a wait that is already over.
func noteControlLabel(linked: Bool, resolving: Bool) -> String {
    !linked && resolving ? "Linking…" : "Note"
}

func callerDisplayName(_ call: Call) -> String {
    if let contact = call.contact_name, !contact.isBlank { return contact }
    if let cnam = call.caller_name, !cnam.isBlank { return cnam }
    if let number = call.caller_e164, !number.isBlank { return formatPhone(number) }
    return "Unknown caller"
}

/// "4m 32s" / "58s" — talk time for answered calls (never ring time).
func formatCallDuration(_ seconds: Int) -> String {
    let whole = max(0, seconds)
    // #570: hours were missing, so a three-hour call read as "183m 12s". Nothing
    // caps talk time — the call code's timeouts bound RINGING and a transfer, not a
    // connected call. Past an hour the seconds are dropped: "3h 3m 12s" is three
    // facts where the reader wanted one. Under an hour they stay, because 58s
    // against 4m 32s is exactly what somebody is scanning for.
    let hours = whole / 3600
    let minutes = (whole % 3600) / 60
    let rest = whole % 60
    if hours > 0 { return minutes == 0 ? "\(hours)h" : "\(hours)h \(minutes)m" }
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

// MARK: - #459 dialer correlation

/// Which book a dialer match came from. On an equal score APP beats DEVICE.
enum DialerSource { case app, device }

/// One thing that could be who you meant. App contacts (ours) and device
/// contacts (the phone's address book) collapse to this shape so the matcher
/// never has to know which book it is reading.
struct DialerCandidate {
    var name: String?
    var number: String
    var source: DialerSource
    /// Our contact id when this came from our own book; nil for device rows.
    var contactId: String?

    init(name: String?, number: String, source: DialerSource, contactId: String? = nil) {
        self.name = name
        self.number = number
        self.source = source
        self.contactId = contactId
    }
}

/// A resolved match: what to show, what to dial, and where it came from.
struct DialerMatch: Identifiable, Equatable {
    var name: String
    var number: String
    var source: DialerSource
    var contactId: String?
    var score: Int

    var id: String { number }
}

/// Fewest digits before a NUMBER match runs. Below this, the whole book matches.
let minNumberDigits = 4

/// Fewest digits before a NAME match runs. Two letters is how people reach.
let minNameDigits = 2

/// How many matches the dialer shows. Four is a glance; ten is a directory.
let maxDialerMatches = 4

/// Digit for a keypad letter, or nil when the character is not a letter.
private func t9Digit(_ character: Character) -> Character? {
    switch character {
    case "a", "b", "c": return "2"
    case "d", "e", "f": return "3"
    case "g", "h", "i": return "4"
    case "j", "k", "l": return "5"
    case "m", "n", "o": return "6"
    case "p", "q", "r", "s": return "7"
    case "t", "u", "v": return "8"
    case "w", "x", "y", "z": return "9"
    default: return nil
    }
}

/// A name as its keypad digits, one entry per word: "Bob Vance" gives
/// ["262", "82623"].
///
/// Per word because the match rule is per word — typing the start of a surname
/// has to find it, and letters buried mid-word must not. Split by hand rather
/// than with a regex word boundary, which does not compile in a Swift regex
/// literal and is a backspace character in the Kotlin twin.
func t9Words(_ name: String) -> [String] {
    var words: [String] = []
    var current = ""
    for character in name.lowercased() {
        if let digit = t9Digit(character) {
            current.append(digit)
        } else if character.isNumber {
            current.append(character) // "A1 Plumbing" is already keypad-shaped
        } else {
            if !current.isEmpty { words.append(current) }
            current = ""
        }
    }
    if !current.isEmpty { words.append(current) }
    return words
}

/// National digits: the bare digits with a single leading NANP country code
/// dropped, so "+14165550123", "14165550123" and "4165550123" compare equal.
func nationalDigits(_ value: String) -> String {
    let digits = String(value.filter(\.isNumber))
    if digits.count == 11 && digits.hasPrefix("1") { return String(digits.dropFirst()) }
    return digits
}

/// Score a candidate against the typed digits. Zero means no match.
///
/// The scale is spread out rather than 1-2-3 so a number match and a name match
/// can be compared without either category swallowing the other: an exact
/// number always wins, a name that STARTS with what you typed beats a number
/// that merely contains it, and a surname beats nothing but noise.
func scoreDialerCandidate(typed: String, candidate: DialerCandidate) -> Int {
    let typedDigits = nationalDigits(typed)
    guard !typedDigits.isEmpty else { return 0 }

    var best = 0

    let candidateDigits = nationalDigits(candidate.number)
    if !candidateDigits.isEmpty && typedDigits.count >= minNumberDigits {
        if candidateDigits == typedDigits {
            best = 100
        } else if candidateDigits.hasSuffix(typedDigits) {
            best = 80
        } else if candidateDigits.contains(typedDigits) {
            best = 20
        }
    }

    let name = (candidate.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !name.isEmpty && typedDigits.count >= minNameDigits {
        let words = t9Words(name)
        for (index, word) in words.enumerated() where word.hasPrefix(typedDigits) {
            // The first word is the one people reach for, so it ranks above a
            // match on a surname or the second half of a business name.
            let nameScore = index == 0 ? 60 : 40
            if nameScore > best { best = nameScore }
        }
    }

    return best
}

/// The matches for what has been typed, best first, capped at `limit`.
///
/// Ties break toward our own book and then toward the order the caller passed —
/// callers pass app candidates first, so the crew's shared contacts win over a
/// personal phone entry for the same person. Duplicates collapse by number
/// AFTER sorting: collapsing on the way in keeps whichever row arrived first,
/// which quietly hands the tie to a device contact whenever it is listed first.
///
/// The hand-port of `packages/shared/src/dialer.ts`; `DialerCorrelationTests`
/// asserts the same cases its vitest twin does.
func rankDialerCandidates(
    typed: String,
    candidates: [DialerCandidate],
    limit: Int = maxDialerMatches
) -> [DialerMatch] {
    var scored: [(order: Int, match: DialerMatch)] = []

    for (order, candidate) in candidates.enumerated() {
        let score = scoreDialerCandidate(typed: typed, candidate: candidate)
        guard score > 0 else { continue }
        // A candidate with no dialable digits is a dead row.
        guard !nationalDigits(candidate.number).isEmpty else { continue }
        let name = (candidate.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        scored.append((
            order,
            DialerMatch(
                name: name.isEmpty ? formatPhone(candidate.number) : name,
                number: candidate.number,
                source: candidate.source,
                contactId: candidate.contactId,
                score: score
            )
        ))
    }

    scored.sort { lhs, rhs in
        if lhs.match.score != rhs.match.score { return lhs.match.score > rhs.match.score }
        if lhs.match.source != rhs.match.source { return lhs.match.source == .app }
        return lhs.order < rhs.order
    }

    var seen = Set<String>()
    var unique: [DialerMatch] = []
    for entry in scored {
        let key = nationalDigits(entry.match.number)
        if seen.contains(key) { continue }
        seen.insert(key)
        unique.append(entry.match)
        if unique.count >= limit { break }
    }
    return unique
}

/// The saved-contact name matching typed dialer digits (#186 item 5), or nil.
/// Now the top of the same ranking the list below the readout uses, so the name
/// under the number and the first row can never disagree.
func dialerContactName(matching typed: String, in contacts: [Contact]) -> String? {
    rankDialerCandidates(
        typed: typed,
        candidates: contacts.map {
            DialerCandidate(
                name: $0.name, number: $0.phone_e164, source: .app, contactId: $0.id
            )
        },
        limit: 1
    ).first?.name
}

// MARK: - #210 ongoing call card

/// The #208 live-phase mirror values the card reads. Private: the card and
/// its tests speak in the raw wire strings, exactly as the Android twin does.
private enum CallState {
    static let ringing = "ringing"
    static let answered = "answered"
    static let voicemailGreeting = "voicemail_greeting"
    static let voicemailRecording = "voicemail_recording"
    static let endedPrefix = "ended"
}

/// A row still holding the line: outcome unstamped AND the #208 state mirror
/// does not already say ended_*. An outcome-null row whose state is terminal
/// is mirror lag (the outcome stamp is seconds behind) — pinning it as
/// "ongoing" would show a ghost call, so it counts as resolved.
func isOngoingCall(_ call: Call) -> Bool {
    call.outcome == nil && call.state?.hasPrefix(CallState.endedPrefix) != true
}

/// The rows the Ongoing card pins, kept in the log's newest-first order.
func ongoingCalls(_ calls: [Call]) -> [Call] {
    calls.filter(isOngoingCall)
}

/// The log below the card — everything that has actually resolved.
func resolvedCalls(_ calls: [Call]) -> [Call] {
    calls.filter { !isOngoingCall($0) }
}

/// What an ongoing row is doing right now.
enum OngoingPhase {
    case ringing
    case dialing
    case answered
    case voicemail
}

/// Phase resolution: the #208 state is the truth when present; a null state
/// (outbound rows, pre-backfill rows) falls back to the answer stamps, then
/// direction — an unstamped outbound row is the crew dialing out.
func ongoingPhase(_ call: Call) -> OngoingPhase {
    switch call.state {
    case CallState.answered:
        return .answered
    case CallState.voicemailGreeting, CallState.voicemailRecording:
        return .voicemail
    case CallState.ringing:
        return .ringing
    default:
        if call.answered_at != nil || call.answered_by_user_id != nil { return .answered }
        return call.direction == "outbound" ? .dialing : .ringing
    }
}

/// The card's status line. Ringing shows no member (nobody has the line yet);
/// an answered call names who does; an answered call whose member cannot be
/// resolved still says the line is taken instead of naming no one.
///
/// #228: `locale` is last and defaulted, so `OngoingCallTests` — which pins the
/// English against the Android twin — keeps calling this unchanged.
func ongoingStatusLabel(
    _ phase: OngoingPhase,
    memberName: String?,
    _ locale: String? = nil
) -> String {
    switch phase {
    case .ringing:
        return AppStrings.translate(locale, "shell.ringing")
    case .dialing:
        // The call screen's own vocabulary, which lives in `ContactsTasksStrings`
        // — the same key Android and `CallsView` use. The other three words on
        // this card have no twin there, so they are `shell.`'s.
        return AppStrings.translate(locale, "contactsTasks.phaseCalling")
    case .voicemail:
        return AppStrings.translate(locale, "shell.leavingVoicemail")
    case .answered:
        if let memberName, !memberName.isBlank {
            return AppStrings.translate(locale, "shell.withMember", ["who": memberName])
        }
        return AppStrings.translate(locale, "shell.onTheLine")
    }
}

/// Only an answered call has talk time to tick.
func ongoingShowsTimer(_ phase: OngoingPhase) -> Bool {
    phase == .answered
}

/// The live timer's anchor: answered_at (true talk time). A row the API has
/// not stamped yet falls back to started_at — a few seconds of ring time is
/// a smaller lie than a frozen timer.
func ongoingAnchorIso(_ call: Call) -> String {
    call.answered_at ?? call.started_at
}

/// answered_by user id → roster display name; nil when unresolvable.
func memberDisplayName(_ userId: String?, in members: [Member]) -> String? {
    guard let userId else { return nil }
    guard let match = members.first(where: { $0.user_id == userId }) else { return nil }
    return match.display_name.isBlank ? nil : match.display_name
}

/// The business-line chip label: only when the company owns MORE than one
/// number (one number = zero ambiguity, the chip is noise) and the row's
/// number resolves to a listable E.164.
func ongoingNumberLabel(_ phoneNumberId: String?, in numbers: [PhoneNumberSummary]) -> String? {
    guard numbers.count > 1, let phoneNumberId else { return nil }
    guard let match = numbers.first(where: { $0.id == phoneNumberId }),
          let e164 = match.number_e164, !e164.isBlank else { return nil }
    return formatPhone(e164)
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
