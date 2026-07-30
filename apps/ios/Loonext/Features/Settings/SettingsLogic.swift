import Foundation

/// Pure settings logic (#163): the client-side mirrors of the server's seat
/// formula, role matrix, CNAM rule, and cap semantics — plus the shared
/// merge-field substituter's drop-empty behavior. Everything here is unit
/// tested (LoonextTests/SettingsLogicTests.swift, the Android twin's exact
/// vectors); the views render it.

// MARK: - Role matrix (SPEC §10, mirrored client-side; the server independently 403s)

enum SettingsRoleGate {
    /// Workspace name/timezone/hours/away/calling writes — admin+.
    static func canEditWorkspace(_ role: String?) -> Bool {
        MemberRole.atLeast(role, required: MemberRole.admin)
    }

    /// Invite / role change / deactivate — admin+ (owner row immutable).
    static func canManageTeam(_ role: String?) -> Bool {
        MemberRole.atLeast(role, required: MemberRole.admin)
    }

    /// Buy/port/text-enable numbers, registration writes — admin+.
    static func canManageNumbers(_ role: String?) -> Bool {
        MemberRole.atLeast(role, required: MemberRole.admin)
    }

    /// #106 per-number access dialog — admin+.
    static func canManageNumberAccess(_ role: String?) -> Bool {
        MemberRole.atLeast(role, required: MemberRole.admin)
    }

    /// Plan change, modules, portal/checkout — admin+.
    static func canManageBilling(_ role: String?) -> Bool {
        MemberRole.atLeast(role, required: MemberRole.admin)
    }

    /// #214 AI enrichment opt-in writes — admin+ (it spends money). Reads are
    /// member-visible; only the toggles are gated.
    static func canManageAiSettings(_ role: String?) -> Bool {
        MemberRole.atLeast(role, required: MemberRole.admin)
    }

    /// Overage cap — OWNER only.
    static func canChangeOverageCap(_ role: String?) -> Bool { role == MemberRole.owner }

    /// Release a number for good — OWNER only.
    static func canReleaseNumber(_ role: String?) -> Bool { role == MemberRole.owner }

    /// Cancel a port-in — OWNER only.
    static func canCancelPort(_ role: String?) -> Bool { role == MemberRole.owner }

    /// Cancel a text-enablement — OWNER only.
    static func canCancelTextEnablement(_ role: String?) -> Bool { role == MemberRole.owner }

    /// CA workspace turning on US texting ($29) — OWNER only.
    static func canEnableUsTexting(_ role: String?) -> Bool { role == MemberRole.owner }

    /// A member's role can change only between admin and member, by an
    /// admin+, never their own owner row and never a deactivated row.
    static func canChangeRoleOf(actorRole: String?, target: Member) -> Bool {
        canManageTeam(actorRole)
            && target.role != MemberRole.owner
            && target.deactivated_at == nil
    }

    static func canDeactivate(actorRole: String?, target: Member, selfUserId: String) -> Bool {
        canManageTeam(actorRole)
            && target.role != MemberRole.owner
            && target.deactivated_at == nil
            && target.user_id != selfUserId
    }
}

// MARK: - Seat math — exact mirror of routes/team.ts + routes/core/plans.ts

// #392: the server SENDS the allowance now (CompanyView.seat_limit). Starter 3
// / Pro 15 was written out four times in four languages, had already moved
// twice, and is a pricing lever rather than an architectural fact — pulling it
// should not require an App Store review before it is true everywhere.
//
// The literal below is now only the offline fallback, for a client that has
// never successfully loaded a company.

/// The ONE place these integers are written in Swift (#392).
///
/// They were in three: here, `planFacts`, and BillingSection's downgrade gate.
/// The downgrade one is the nastiest — a native gate that disagrees with the
/// API blocks or permits a plan change the server does not.
let starterSeats = 3
let proSeats = 15

/// Fallback allowance ONLY. Prefer `CompanyView.seat_limit` from the server.
func seatLimit(_ plan: String?) -> Int { plan == "pro" ? proSeats : starterSeats }

/// Active members — the API's filter (`deactivated_at IS NULL`).
func countActiveMembers(_ members: [Member]) -> Int {
    members.filter { $0.deactivated_at == nil }.count
}

/// Pending invites — the API's exact formula (not accepted/revoked/expired).
func pendingInviteCount(_ invites: [Invite], now: Date = Date()) -> Int {
    invites.filter { invite in
        invite.accepted_at == nil
            && invite.revoked_at == nil
            && (parseWireTimestamp(invite.expires_at).map { $0 > now } ?? false)
    }.count
}

struct SeatUsage: Equatable, Sendable {
    let used: Int
    let limit: Int
    let full: Bool
    /// Full AND there is a bigger self-serve plan: show the upgrade action.
    let canUpgrade: Bool
    /// The G8 seat line, e.g. "2 of 3 seats. Upgrade for more".
    let line: String
}

/// - Parameter servedLimit: the server's allowance (`CompanyView.seat_limit`).
///   Wins whenever we have it; the plan-derived fallback is for a client that
///   has never loaded. A client number HIGHER than the API's tells an owner
///   they have room and then the invite is refused, at the exact moment they
///   are trying to add somebody.
func seatUsage(
    activeMembers: Int,
    pendingInvites: Int,
    plan: String?,
    servedLimit: Int? = nil
) -> SeatUsage {
    let limit = (servedLimit.map { $0 > 0 ? $0 : nil } ?? nil) ?? seatLimit(plan)
    let used = activeMembers + pendingInvites
    let full = used >= limit
    let canUpgrade = full && plan != "pro"
    let line = canUpgrade
        ? "\(used) of \(limit) seats. Upgrade for more"
        : "\(used) of \(limit) seats"
    return SeatUsage(used: used, limit: limit, full: full, canUpgrade: canUpgrade, line: line)
}

// MARK: - CNAM (carrier rule: 1-15 letters, digits, or spaces)

func isValidCnam(_ value: String) -> Bool {
    wholeMatch(value, pattern: "^[A-Za-z0-9 ]{1,15}$")
}

// MARK: - Overage cap — mirror of web lib/settings/cap-control.ts (#42 honesty:
// there is no "no cap"; nil clamps to the 10× hard ceiling)

let maxCapMultiplier = 10.0


func normalizeCapMultiplier(_ value: Double?) -> Double {
    if let value, value.isFinite, value > 0 { return min(value, maxCapMultiplier) }
    return maxCapMultiplier
}

/// "2×", "2.5×", or "Maximum (10×)" for the ceiling.
func capLabel(_ multiplier: Double?) -> String {
    guard let multiplier, multiplier < maxCapMultiplier else { return "Maximum (10×)" }
    if multiplier == multiplier.rounded(), let whole = Int(exactly: multiplier.rounded()) {
        return "\(whole)×"
    }
    var text = String(multiplier)
    while text.hasSuffix("0") { text.removeLast() }
    if text.hasSuffix(".") { text.removeLast() }
    return "\(text)×"
}

/// Segments allowed under a cap — mirrors GET /v1/usage's Math.round.
func capSegments(includedSegments: Int, multiplier: Double?) -> Int {
    Int((Double(includedSegments) * normalizeCapMultiplier(multiplier)).rounded())
}

struct CapChange: Equatable, Sendable {
    let requiresConfirmation: Bool
    /// Dialog title, e.g. "Set the cap to 3×?".
    let title: String
    /// One sentence naming the new pause point ("" when nothing changes).
    let summary: String
}

/// Group digits like JS toLocaleString ("2,500").
func groupDigits(_ value: Int) -> String {
    guard value >= 0 else { return String(value) }
    let raw = String(value)
    var result = ""
    for (index, character) in raw.enumerated() {
        if index > 0 && (raw.count - index) % 3 == 0 { result.append(",") }
        result.append(character)
    }
    return result
}

/// Confirm-dialog copy for a cap change — mirrors describeCapChange in the
/// web's cap-control.ts so all clients promise the same pause point.
func describeCapChange(current: Double?, next: Double?, includedSegments: Int) -> CapChange {
    let currentValue = normalizeCapMultiplier(current)
    let nextValue = normalizeCapMultiplier(next)
    if currentValue == nextValue {
        return CapChange(requiresConfirmation: false, title: "", summary: "")
    }
    let nextTotal = capSegments(includedSegments: includedSegments, multiplier: nextValue)
    let currentTotal = capSegments(includedSegments: includedSegments, multiplier: currentValue)
    let title = "Set the cap to \(capLabel(nextValue))?"
    if nextValue > currentValue {
        let atCeiling = nextValue >= maxCapMultiplier
        let summary: String
        if atCeiling {
            summary = "Sending pauses at \(groupDigits(nextTotal)) messages this period instead of "
                + "\(groupDigits(currentTotal)). That's the highest the cap goes. Every message "
                + "over your \(groupDigits(includedSegments)) included is billed at the overage "
                + "rate until sending pauses."
        } else {
            summary = "Sending pauses at \(groupDigits(nextTotal)) messages this period instead of "
                + "\(groupDigits(currentTotal))."
        }
        return CapChange(requiresConfirmation: true, title: title, summary: summary)
    }
    return CapChange(
        requiresConfirmation: true,
        title: title,
        summary: "Sending pauses at \(groupDigits(nextTotal)) messages this period. "
            + "If you're already past that, sends pause right away."
    )
}

// MARK: - Merge fields — byte-for-byte mirror of packages/shared/src/merge-fields.ts
// (drop-empty semantics: unknown/empty tokens vanish and whitespace tidies)

/// The sample name used to show {first_name} resolving in a preview.
let sampleFirstName = "Dana"

private func firstNameOf(_ contactName: String?) -> String {
    let trimmed = (contactName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return "" }
    return trimmed.split(whereSeparator: { $0.isWhitespace }).first.map(String.init) ?? ""
}

private func tidyDroppedTokens(_ text: String) -> String {
    var tidied = replacingPattern(text, pattern: "[ \\t]+([,.;:!?])", template: "$1")
    tidied = replacingPattern(tidied, pattern: "[ \\t]{2,}", template: " ")
    tidied = replacingPattern(tidied, pattern: "[ \\t]+$", template: "", options: [.anchorsMatchLines])
    tidied = replacingPattern(tidied, pattern: "^[ \\t]+", template: "", options: [.anchorsMatchLines])
    return tidied
}

/// Substitute {first_name}/{business_name}; unknown or empty tokens are
/// dropped cleanly — exactly what the server does at send time.
func applyMergeFields(_ text: String, contactName: String?, businessName: String?) -> String {
    guard text.contains("{") else { return text }
    guard let regex = try? NSRegularExpression(pattern: "\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}") else {
        return text
    }
    let source = text as NSString
    var result = ""
    var cursor = 0
    var anyDropped = false
    let matches = regex.matches(in: text, range: NSRange(location: 0, length: source.length))
    for match in matches {
        result += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
        let token = source.substring(with: match.range(at: 1)).lowercased()
        let replacement: String
        switch token {
        case "first_name":
            replacement = firstNameOf(contactName)
        case "business_name":
            replacement = (businessName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        default:
            replacement = ""
        }
        if replacement.isEmpty { anyDropped = true }
        result += replacement
        cursor = match.range.location + match.range.length
    }
    result += source.substring(from: cursor)
    return anyDropped ? tidyDroppedTokens(result) : result
}

// MARK: - Voicemail default — mirror of apps/api messaging/inbound-ring.ts

/// The greeting spoken when the owner has not written one.
func defaultVoicemailGreeting(companyName: String) -> String {
    "You've reached \(companyName). We can't take your call right now. "
        + "Please leave a message after the beep, or hang up and text us at this number."
}

// MARK: - Number status honesty — mirror of web components/settings/number-card.tsx

/// A provision_failed row the auto-retry loop can't fix — needs a new pick.
func needsNumberChoice(_ number: PhoneNumberSummary) -> Bool {
    number.status == NumberStatus.provisionFailed
        && (number.failure_reason == "no_inventory" || (number.provision_attempts ?? 0) >= 5)
}

/// Honest, reason-driven copy for a provision_failed number.
func failedNumberCopy(_ number: PhoneNumberSummary) -> String {
    if !needsNumberChoice(number) {
        return "We're still setting up your number. This is taking a little longer than usual."
    }
    if number.failure_reason == "timeout" {
        return "Setup is taking longer than expected. Choose a number to finish — "
            + "you won't be charged again."
    }
    if number.failure_reason == "no_inventory", let areaCode = number.requested_area_code {
        return "Area code \(areaCode) is out of new numbers right now. "
            + "Choose another number to finish setup."
    }
    return "We couldn't finish setting up your number. Choose a number to try again."
}

// MARK: - Business hours (weekday map mon..sun → { open, close } HH:MM, nil=closed)

let weekdayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

let weekdayLabels: [String: String] = [
    "mon": "Monday", "tue": "Tuesday", "wed": "Wednesday", "thu": "Thursday",
    "fri": "Friday", "sat": "Saturday", "sun": "Sunday",
]

func isValidHhmm(_ value: String) -> Bool {
    wholeMatch(value, pattern: "^([01]\\d|2[0-3]):[0-5]\\d$")
}

/// A day window is valid when both ends parse and differ. The server supports
/// overnight windows (close < open, e.g. 18:00–02:00) but reads open == close
/// as closed all day — an enabled row saying that would lie, so block it here.
func isValidDayWindow(open: String, close: String) -> Bool {
    isValidHhmm(open) && isValidHhmm(close) && open != close
}

/// "09:00" → "9:00 AM" for the grid's human labels.
func formatHhmm(_ value: String) -> String {
    guard isValidHhmm(value), let hour = Int(value.prefix(2)) else { return value }
    let minute = String(value.suffix(2))
    let suffix = hour < 12 ? "AM" : "PM"
    let display: Int
    if hour == 0 {
        display = 12
    } else if hour > 12 {
        display = hour - 12
    } else {
        display = hour
    }
    return "\(display):\(minute) \(suffix)"
}

// MARK: - Number picker digit filter (client-side "contains" over national digits)

func matchesDigitFilter(e164: String, filter: String) -> Bool {
    let digits = filter.filter(\.isNumber)
    if digits.isEmpty { return true }
    var national = e164
    if national.hasPrefix("+1") { national.removeFirst(2) }
    return national.filter(\.isNumber).contains(digits)
}

// MARK: - Port tracker stepper

let portSteps = ["Draft", "Submitted", "In progress", "Ported"]

/// Index into `portSteps` for the calm 4-step tracker; -1 = terminal/off-track.
func portStepIndex(_ status: String) -> Int {
    switch status {
    case PortStatus.draft:
        return 0
    case PortStatus.submitted, PortStatus.exception:
        return 1
    case PortStatus.inProcess, PortStatus.focDateConfirmed, PortStatus.activationInProgress:
        return 2
    case PortStatus.ported:
        return 3
    default:
        return -1
    }
}

// MARK: - Formatting helpers

private let settingsPosixLocale = Locale(identifier: "en_US_POSIX")

/// "$5" for 500 cents, "$7.50" for 750 — whole dollars drop the cents.
func formatMonthlyCents(_ cents: Int) -> String {
    if cents % 100 == 0 { return "$\(cents / 100)" }
    return "$" + String(format: "%.2f", locale: settingsPosixLocale, Double(cents) / 100.0)
}

/// "$12.34" — always two decimals (projected overage dollars).
func formatCents(_ cents: Int) -> String {
    "$" + String(format: "%.2f", locale: settingsPosixLocale, Double(cents) / 100.0)
}

/// Human bytes: "0 B", "412 KB", "1.2 GB".
func formatBytes(_ bytes: Int) -> String {
    if bytes < 1024 { return "\(bytes) B" }
    let kb = Double(bytes) / 1024.0
    if kb < 1024 { return "\(Int(kb.rounded())) KB" }
    let mb = kb / 1024.0
    if mb < 1024 {
        if mb < 10 { return String(format: "%.1f MB", locale: settingsPosixLocale, mb) }
        return "\(Int(mb.rounded())) MB"
    }
    let gb = mb / 1024.0
    return String(format: "%.1f GB", locale: settingsPosixLocale, gb)
}

/// The shareable invite accept link (same origin the web copies).
func inviteLink(_ inviteId: String) -> String { "https://app.loonext.com/invite/\(inviteId)" }

/// Plan display facts (SPEC §2, mirrored from web plan-facts.ts).
struct PlanFacts: Equatable, Sendable {
    let name: String
    let price: String
    let seats: Int
    let numbers: Int
    let voiceMinutes: Int
}

func planFacts(_ plan: String?) -> PlanFacts? {
    switch plan {
    case "starter":
        return PlanFacts(name: "Starter", price: "$29/mo", seats: starterSeats, numbers: 1, voiceMinutes: 2500)
    case "pro":
        return PlanFacts(name: "Pro", price: "$79/mo", seats: proSeats, numbers: 2, voiceMinutes: 6000)
    default:
        return nil
    }
}

/// Included outbound segments (SPEC §2) — for downgrade checklists only;
/// live figures always come from GET /v1/usage.
func planIncludedSegments(_ plan: String?) -> Int {
    switch plan {
    case "pro": return 2500
    case "starter": return 500
    default: return 0
    }
}

/// What to say while a number is still being set up, tiered on how long it has
/// actually been. The flat "usually under a minute" line was true for the first
/// minute and a lie for every one after it, and a number that stalls is exactly
/// when a stale promise reads worst. The web twin is provisioningWaitCopy in
/// apps/web/src/components/registration/copy.ts.
func provisioningWaitCopy(_ createdAtIso: String?, now: Date = Date()) -> String {
    let elapsed = parseWireTimestamp(createdAtIso)
        .map { now.timeIntervalSince($0) } ?? 0
    if elapsed >= 240 {
        return "Your number is taking a little longer than usual. We're still on "
            + "it, you don't have to wait here."
    }
    if elapsed >= 90 {
        return "Still setting up your number, this is taking a little longer "
            + "than usual. Hang tight."
    }
    return "We're setting up your number. This usually takes under a minute."
}

/// "(416) 555-0182" → "+14165550182"; nil when it isn't a NANP number.
func normalizeNanpInput(_ input: String) -> String? {
    let digits = input.filter(\.isNumber)
    if digits.count == 10 { return "+1\(digits)" }
    if digits.count == 11 && digits.hasPrefix("1") { return "+\(digits)" }
    return nil
}

// MARK: - Regex plumbing (regexes are built per call: a global NSRegularExpression
// constant is not Sendable under Swift 6 strict concurrency)

private func wholeMatch(_ value: String, pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) != nil
}

private func replacingPattern(
    _ text: String,
    pattern: String,
    template: String,
    options: NSRegularExpression.Options = []
) -> String {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return text }
    return regex.stringByReplacingMatches(
        in: text,
        range: NSRange(text.startIndex..., in: text),
        withTemplate: template
    )
}

// ---------------------------------------------------------------------------
// #414 emergency keyword — mirror of packages/shared/src/emergency.ts
// ---------------------------------------------------------------------------

/// The words the away-message default asks a homeowner to send.
let emergencyKeywords = ["URGENT", "EMERGENCY", "911", "SOS"]

/// The §5/D3 carrier keywords, answered by Telnyx before we see them. "Reply
/// STOP to unsubscribe" is required compliance copy, so naming it unrecognised
/// would be both wrong and the fastest way to teach an owner to ignore this
/// warning. Mirrors `CARRIER_REPLY_KEYWORDS` in shared.
let carrierReplyKeywords = [
    "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT",
    "START", "UNSTOP", "YES",
    "HELP", "INFO",
]

/// True when OWNER-AUTHORED copy still invites the emergency reply.
///
/// Reads what the owner wrote, not what a customer sent, so it must not
/// UNDER-fire: missing an invitation means the settings screen tells an owner
/// their message is fine while it promises a callback nothing will make. That
/// is the whole of #414, re-created by the owner's own hand.
///
/// The boundaries are `\\b` in SOURCE, which is `\b` in the pattern. Swift has
/// no `\b` string escape at all, so writing it unescaped is not a subtle bug —
/// it does not compile.
func mentionsEmergencyKeyword(
    _ copy: String,
    // #460: the workspace's own words. Defaults to the product list so a caller
    // not yet taught about custom keywords gets the old answer, not a wrong one.
    keywords: [String] = emergencyKeywords
) -> Bool {
    keywords.contains { keyword in
        guard let regex = try? NSRegularExpression(
            pattern: "\\b\(keyword)\\b",
            options: [.caseInsensitive]
        ) else { return false }
        return regex.firstMatch(
            in: copy,
            range: NSRange(copy.startIndex..., in: copy)
        ) != nil
    }
}

/// Owners capitalise the word they want sent back. The verb matches
/// case-insensitively; the WORD's capitalisation is checked separately, since
/// it is the only thing telling a keyword instruction apart from a sentence
/// that merely contains "reply".
private let replyInstructionPattern =
    "\\b(?:reply|replying|text|respond|send)\\s+(?:back\\s+)?(?:with\\s+)?[\"'“‘]?([A-Za-z0-9]{2,15})\\b"

/// #453 — the word an owner told customers to send that nothing listens for.
/// Returns it so the screen can quote it back; an owner cannot fix what we
/// will not name. Mirror of `unrecognizedReplyKeyword` in shared.
func unrecognizedReplyKeyword(
    _ copy: String,
    keywords: [String] = emergencyKeywords
) -> String? {
    guard let regex = try? NSRegularExpression(
        pattern: replyInstructionPattern,
        options: [.caseInsensitive]
    ) else { return nil }
    let full = NSRange(copy.startIndex..., in: copy)
    for match in regex.matches(in: copy, range: full) {
        guard match.numberOfRanges > 1,
              let range = Range(match.range(at: 1), in: copy) else { continue }
        let raw = String(copy[range])
        let word = raw.uppercased()
        // #460: a word the owner has just ADDED must stop being warned about
        // the moment they add it, or the warning teaches them to ignore it.
        if keywords.contains(word) || carrierReplyKeywords.contains(word) { continue }
        // Must READ as a keyword: all-caps in the original, letters only. This
        // is what keeps "reply within 24 hours" and "we'll reply Monday" out.
        if raw != word { continue }
        if word.count < 2 || !word.allSatisfy({ $0.isLetter && $0.isUppercase }) { continue }
        return word
    }
    return nil
}

extension CompanyView {
    /// #460 — the words this workspace really watches for, safe against a
    /// lagging server that has not learned to send them yet.
    ///
    /// An empty array from an older API must read as "the product list", not as
    /// "nothing" — a switch labelled "texts starting with nothing reach the
    /// crew" is worse than the hardcoded copy it replaced.
    var effectiveEmergencyWords: [String] {
        emergency_effective_keywords.isEmpty
            ? emergencyKeywords
            : emergency_effective_keywords
    }
}

/// "URGENT, EMERGENCY, 911 or SOS" — an owner reads a list, not an array.
/// Mirror of `emergencyWordList` in shared; keep the joining identical or the
/// same switch reads differently on three phones.
func emergencyWordList(_ words: [String]) -> String {
    if words.isEmpty { return "nothing" }
    if words.count == 1 { return words[0] }
    return words.dropLast().joined(separator: ", ") + " or " + (words.last ?? "")
}

/// #460 — why a keyword was refused, in the owner's terms, or nil when it is
/// fine. Mirror of `emergencyKeywordError` in shared.
///
/// The client checks first so an owner is told immediately rather than after a
/// round trip, but the server and the CHECK constraint remain the authority —
/// this is a courtesy, not the gate.
func emergencyKeywordError(_ rawInput: String) -> String? {
    let trimmed = rawInput.trimmingCharacters(in: .whitespaces)
    let word = trimmed.uppercased()
    if word.isEmpty { return "Type a word first." }
    if trimmed.contains(where: { $0.isWhitespace }) {
        return "One word only — customers text a single word, so a phrase would never match."
    }
    if !word.allSatisfy({ ($0.isLetter && $0.isUppercase) || $0.isNumber }) {
        return "Letters and numbers only. Punctuation is stripped from what customers send."
    }
    if word.count < 2 { return "Too short — use at least 2 characters." }
    if word.count > 15 { return "Too long — 15 characters at most." }
    if carrierReplyKeywords.contains(word) {
        return "\(word) is answered by the phone carrier before it reaches us, "
            + "so it can't be an emergency word."
    }
    return nil
}

/// How loudly the away-reply screen should speak.
enum AwayNoticeTone {
    case warn
    case hint
}

/// What the away-reply screen should say about the emergency path, if anything.
struct AwayEmergencyNotice {
    let tone: AwayNoticeTone
    let text: String
}

/// #453 — the one decision every client renders, so all three say the SAME
/// thing. Mirror of `awayEmergencyNotice` in shared; keep the copy identical.
func awayEmergencyNotice(
    emergencyEnabled: Bool,
    awayMessage: String,
    keywords: [String] = emergencyKeywords
) -> AwayEmergencyNotice? {
    let invites = mentionsEmergencyKeyword(awayMessage, keywords: keywords)
    let unknown = unrecognizedReplyKeyword(awayMessage, keywords: keywords)

    if !emergencyEnabled {
        if !invites, unknown == nil { return nil }
        return AwayEmergencyNotice(
            tone: .warn,
            text: "Your away message tells customers to reply for an emergency, but nothing "
                + "will treat that reply as one. Turn this back on, or take the offer out of "
                + "the message."
        )
    }

    if let unknown {
        return AwayEmergencyNotice(
            tone: .warn,
            text: "Your away message tells customers to reply \(unknown), which nothing "
                + "watches for. Use \(emergencyWordList(keywords)) instead, add \(unknown) to "
                + "your emergency words, or take the offer out of the message."
        )
    }

    if !invites {
        return AwayEmergencyNotice(
            tone: .hint,
            text: "Nobody has been told they can. Mention it in your away message if you "
                + "want customers to know."
        )
    }

    return nil
}

// MARK: - Signed-in devices (#236)

/// What to call a signed-in device.
///
/// `unknown` is a real answer, not a gap: it is what a client that predates
/// the X-Client header looks like, and a row that says "Unrecognised device"
/// is exactly the row somebody should look twice at.
func deviceClientLabel(_ client: String) -> String {
    switch client {
    case SessionClient.web: "Web browser"
    case SessionClient.android: "Android app"
    case SessionClient.ios: "iPhone or iPad"
    default: "Unrecognised device"
    }
}

/// SF Symbol for a device row.
func deviceClientSymbol(_ client: String) -> String {
    switch client {
    case SessionClient.web: "laptopcomputer"
    case SessionClient.android: "candybarphone"
    case SessionClient.ios: "iphone"
    default: "questionmark.square.dashed"
    }
}

/// "1 device" / "3 devices" — used in three sentences that each read wrong
/// otherwise.
func deviceCountLabel(_ count: Int) -> String {
    count == 1 ? "1 device" : "\(count) devices"
}

/// The order a person reads their own device list in: the one they are
/// holding first, then everything else by most recently active.
///
/// Sorted here rather than trusted from the server because "this device" has
/// to be identified and dismissed before any other row means anything, and
/// the server orders by activity alone.
func orderMyDevices(_ sessions: [DeviceSession]) -> [DeviceSession] {
    sessions.sorted { left, right in
        if left.isCurrent != right.isCurrent { return left.isCurrent }
        return left.last_active_at > right.last_active_at
    }
}

// MARK: - Ownership (#332)

/// The headline of a handover in flight: what is happening, in one sentence.
///
/// Hand-ported to three clients, so it lives here with a test rather than
/// inline in a view — the failure mode is one client telling a workspace
/// something subtly different about who is taking it over.
func handoverHeadline(_ kind: String, who: String) -> String {
    kind == HandoverKind.offer
        ? "Ownership has been offered to \(who)."
        : "\(who) has asked to take over this workspace."
}

/// The line underneath it: what happens next, and by when.
///
/// The claim branch is the one that matters — it is where the owner learns
/// they have a deadline and a veto, and it must never read as though the
/// handover has already happened.
func handoverDetail(
    _ kind: String,
    ready: Bool,
    ripensAt: String,
    expiresAt: String
) -> String {
    if kind == HandoverKind.offer {
        return "Nothing changes until they accept. The offer expires "
            + "\(absoluteTime(expiresAt))."
    }
    if ready {
        return "The waiting period is over. They can complete this at any time."
    }
    return "This completes \(absoluteTime(ripensAt)) unless the owner stops it. "
        + "Stopping it takes effect immediately."
}

/// What the button that ends a handover says.
///
/// "Stop this" and "Decline" are the same call and the same outcome, but a
/// person reading them is doing two different things: an owner is vetoing
/// something aimed at them, and a recipient is turning something down.
func handoverCancelLabel(isOwner: Bool, isMine: Bool) -> String {
    isOwner && !isMine ? "Stop this" : "Decline"
}
