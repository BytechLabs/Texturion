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

/// Seats per plan (SPEC §2: Starter 3, Pro 15; NULL plan reads as Starter).
func seatLimit(_ plan: String?) -> Int { plan == "pro" ? 15 : 3 }

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
    /// The G8 seat line, e.g. "2 of 3 seats. Upgrade for more".
    let line: String
}

func seatUsage(activeMembers: Int, pendingInvites: Int, plan: String?) -> SeatUsage {
    let limit = seatLimit(plan)
    let used = activeMembers + pendingInvites
    let full = used >= limit
    let canUpgrade = plan != "pro"
    let line = full && canUpgrade
        ? "\(used) of \(limit) seats. Upgrade for more"
        : "\(used) of \(limit) seats"
    return SeatUsage(used: used, limit: limit, full: full, line: line)
}

// MARK: - CNAM (carrier rule: 1-15 letters, digits, or spaces)

func isValidCnam(_ value: String) -> Bool {
    wholeMatch(value, pattern: "^[A-Za-z0-9 ]{1,15}$")
}

// MARK: - Overage cap — mirror of web lib/settings/cap-control.ts (#42 honesty:
// there is no "no cap"; nil clamps to the 10× hard ceiling)

let maxCapMultiplier = 10.0

let capPresets: [Double] = [2.0, 3.0, 5.0, maxCapMultiplier]

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
        return PlanFacts(name: "Starter", price: "$29/mo", seats: 3, numbers: 1, voiceMinutes: 2500)
    case "pro":
        return PlanFacts(name: "Pro", price: "$79/mo", seats: 15, numbers: 2, voiceMinutes: 6000)
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
