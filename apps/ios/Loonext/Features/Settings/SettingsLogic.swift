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

    /// Plan change, modules, portal/checkout — `billing.manage`, which is
    /// admin+ AND the bookkeeper preset (#315). Asked as an axis rather than a
    /// rank because the bookkeeper is not on the rank line: a rank check here
    /// would hand them the one screen their role exists for and then refuse
    /// every button on it.
    static func canManageBilling(_ role: String?) -> Bool {
        MemberRole.has(role, Capability.billingManage)
    }

    /// Ending the subscription: OWNER only, and deliberately a DIFFERENT
    /// question from `canManageBilling`.
    ///
    /// POST /v1/billing/portal mints the full Stripe portal for an owner and a
    /// `payment_method_update` session for everybody else, and that flow has no
    /// cancellation surface on it at all. So `billing.manage` is the wrong gate
    /// here: it would offer an admin or a bookkeeper a "Cancel subscription"
    /// button, walk them to a Stripe page where cancelling is structurally
    /// impossible, and file the reason they typed on the way against a
    /// cancellation that can never be confirmed.
    static func canCancelSubscription(_ role: String?) -> Bool { role == MemberRole.owner }

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

/// Business numbers per plan — PLAN_NUMBERS in packages/shared/src/seats.ts.
///
/// Here for the same reason the seat counts are, and it arrived later because
/// nothing outside the API needed to SAY the number until a cancel screen had
/// to name what Starter actually covers. A real limit rather than a marketing
/// figure: POST /v1/billing/change-plan refuses a downgrade while the workspace
/// holds more numbers than this, so a figure that drifted from the server's
/// would be a promise the next tap refuses.
let starterNumbers = 1
let proNumbers = 2

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

// MARK: - What this workspace is charged in (#328)

/// The currencies a workspace can be billed in — BILLING_CURRENCIES (#328).
enum BillingCurrency: String, Sendable {
    case usd
    case cad
}

/// What this workspace is actually charged in.
///
/// The stored currency wins whenever it is one we bill in, and it is stored on
/// every workspace there is: `20260802090000_billing_currency.sql` adds the
/// column `not null default 'usd'`, and `api_create_company` writes `'cad'` for
/// every CA signup. There is no null row and no "pre-#328 workspace" to fall
/// back for.
///
/// NIL ON THE WIRE MEANS REDACTED, not unknown. `billing_currency` is in
/// BILLING_ONLY_COMPANY_FIELDS, so the key is ABSENT for a caller without
/// `billing.manage` — a tech or a member reading the plan card. The country is
/// the answer THEN, and it is the right one: it is what the column was
/// defaulted from at signup, so it agrees with the stored value for every
/// workspace that has not deliberately switched. Trusting the country OVER a
/// stored `usd` would be the wrong way round, which is why the stored value is
/// checked first rather than last.
func billingCurrencyFor(stored: String?, country: String?) -> BillingCurrency {
    if let stored, let known = BillingCurrency(rawValue: stored) { return known }
    return country?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() == "CA"
        ? .cad
        : .usd
}

/// Flat monthly plan price in the minor unit — PLAN_PRICE_CENTS (#328).
///
/// CAD is decided, not converted: a converted number reads as an afterthought
/// and moves every time the rate does.
func planPriceCents(_ plan: String?, _ currency: BillingCurrency) -> Int {
    let pro = plan == "pro"
    switch currency {
    case .usd: return pro ? 7900 : 2900
    case .cad: return pro ? 10900 : 3900
    }
}

extension CompanyView {
    /// The currency this workspace's card is charged in, resolved once.
    ///
    /// A property rather than a call at each site, because the two screens that
    /// print a plan price would otherwise each decide for themselves how to
    /// answer a redacted column, and the failure mode of the pair disagreeing
    /// is two different prices for the same plan in the same app.
    var billedIn: BillingCurrency {
        billingCurrencyFor(stored: billing_currency, country: country)
    }
}

/// Plan display facts (SPEC §2, mirrored from web plan-facts.ts).
struct PlanFacts: Equatable, Sendable {
    let name: String
    let price: String
    let seats: Int
    let numbers: Int
    let voiceMinutes: Int
}

/// The plan card's facts, in the currency this workspace is billed in.
///
/// THE CURRENCY IS A PARAMETER AND HAS NO DEFAULT, deliberately. It used to be
/// "$29/mo" and "$79/mo" flat, which put a Canadian owner in front of "Pro ·
/// $79/mo" on the plan card and "Starter is $39 a month instead of $109" in the
/// cancel answer an inch below it — two prices for the same plan, on one
/// screen, one of them provably wrong, at the moment they are deciding whether
/// to leave. A defaulted parameter would let the next call site re-create that
/// silently; a required one makes the caller say whose money it is.
///
/// The figures are read from `planPriceCents` rather than typed, so a repricing
/// moves this card and the cancel answer together. Unprefixed "$": it is the
/// reader's own money, and "CA$39" to a Canadian reads as though we expect them
/// to be confused about it. Web's twin is `planFactsFor` in plan-facts.ts.
func planFacts(_ plan: String?, _ currency: BillingCurrency) -> PlanFacts? {
    switch plan {
    case "starter":
        return PlanFacts(
            name: "Starter",
            price: formatMonthlyCents(planPriceCents("starter", currency)) + "/mo",
            seats: starterSeats, numbers: starterNumbers, voiceMinutes: 2500
        )
    case "pro":
        return PlanFacts(
            name: "Pro",
            price: formatMonthlyCents(planPriceCents("pro", currency)) + "/mo",
            seats: proSeats, numbers: proNumbers, voiceMinutes: 6000
        )
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

// MARK: - The handover, read by the person it is happening TO (#515)

/// The four states somebody can be in with respect to a handover of their own.
///
/// Hand-ported from packages/shared/src/handover.ts (vectors in
/// handover.test.ts and the Android twin). The three functions above describe a
/// handover to a crew; these describe one to its recipient, which is a
/// different reader — the Team card said "Ownership has been offered to Dana",
/// and Dana could not open it.
enum HandoverPrompt {
    /// An offer is open and addressed to them.
    static let acceptOffer = "accept_offer"
    /// Their own claim outlasted the owner's veto window.
    static let completeClaim = "complete_claim"
    /// Their own claim is still inside it.
    static let claimWaiting = "claim_waiting"
    /// They are the named backup and nothing is in flight.
    static let backupStanding = "backup_standing"
}

/// The prompt this caller is owed, or nil when they are not party to anything.
///
/// `canClaim` rather than `isBackup` for the standing state: they differ
/// exactly when something is already in flight, and the server's answer to
/// "may they act" is the one that must not be second-guessed.
func viewerHandoverPrompt(_ state: Ownership) -> String? {
    if let pending = state.pending, pending.isMine {
        // Only a claim can be theirs and unripe: an offer ripens the moment it
        // is made (api_offer_ownership sets ripens_at = now()), so a pending
        // offer addressed to somebody is always ready to accept.
        if !pending.isReady { return HandoverPrompt.claimWaiting }
        return pending.kind == HandoverKind.offer
            ? HandoverPrompt.acceptOffer
            : HandoverPrompt.completeClaim
    }
    return state.canClaim ? HandoverPrompt.backupStanding : nil
}

/// The one sentence the prompt leads with.
func handoverPromptHeadline(_ kind: String) -> String {
    switch kind {
    case HandoverPrompt.acceptOffer:
        return "You have been offered ownership of this workspace."
    case HandoverPrompt.completeClaim:
        return "Your request to take over is ready to complete."
    case HandoverPrompt.claimWaiting:
        return "You have asked to take over this workspace."
    default:
        return "You are the backup owner."
    }
}

/// What happens next, in the second person.
///
/// The `backupStanding` branch is loss aversion, stated once and plainly, and
/// it is deliberately the same sentence the OWNER read when they named this
/// person — both ends of the arrangement should understand it identically.
func handoverPromptDetail(_ kind: String, ripensAt: String, expiresAt: String) -> String {
    switch kind {
    case HandoverPrompt.acceptOffer:
        return "Accepting makes you responsible for billing, the spending cap and your "
            + "numbers; the current owner stays on the team as an admin. Everyone is "
            + "told either way. The offer expires \(absoluteTime(expiresAt))."
    case HandoverPrompt.completeClaim:
        return "The waiting period is over and nobody stopped it. Completing this makes "
            + "you the owner — billing, the spending cap and your numbers — and puts "
            + "the previous owner on the team as an admin."
    case HandoverPrompt.claimWaiting:
        return "The owner has been emailed and can stop this until "
            + "\(absoluteTime(ripensAt)). If nobody stops it, you can complete the "
            + "takeover after that."
    default:
        return "If the owner ever can't get in — they leave, they lose access to their "
            + "email, or worse — you're the one person who can ask to take over. They "
            + "get a week to say no, and everyone on the team is told. Nothing changes "
            + "until you ask."
    }
}

/// What the button that ends it says, to the person it is happening to.
///
/// `handoverCancelLabel` covers the Team card, where an owner reads about their
/// crew. Neither of its labels fits a claimant reading about their OWN request —
/// being told to "decline" something you asked for is the app misreading the
/// room. Nil for the standing nomination, which has nothing to call off.
func handoverPromptCancelLabel(_ kind: String) -> String? {
    switch kind {
    case HandoverPrompt.acceptOffer:
        return "Decline"
    case HandoverPrompt.completeClaim, HandoverPrompt.claimWaiting:
        return "Withdraw my request"
    default:
        return nil
    }
}

// MARK: - Why a workspace is leaving (#277)

/// One answer to "why are you leaving": what goes on the wire, and what a
/// person reads.
///
/// The code is stored as free text rather than a database enum, precisely so
/// the list can change as we learn what people say, which makes the list
/// itself the only thing keeping the report readable. Ten workspaces leaving
/// for the same reason have to land in the same bucket, so a client that
/// invented its own spelling would quietly split them.
struct CancellationReason: Equatable, Sendable, Identifiable {
    /// The short code the API stores. Max 40 characters, server-side.
    let code: String
    /// What the person choosing it reads.
    let label: String

    var id: String { code }
}

/// The six, in the order they are offered, identical on all three clients.
///
/// There is no default and there is no "prefer not to say" row: the way to not
/// answer is to not answer, and the button that leaves works either way.
let cancellationReasons: [CancellationReason] = [
    CancellationReason(code: "too_expensive", label: "Too expensive"),
    CancellationReason(code: "seasonal", label: "Quiet season, I'll be back"),
    CancellationReason(code: "missing_feature", label: "Missing something I need"),
    CancellationReason(code: "switched", label: "Going with something else"),
    CancellationReason(code: "not_using", label: "Not using it"),
    CancellationReason(code: "other", label: "Something else"),
]

/// The server's ceiling on the free-text half. Over-length is a 422.
let cancellationDetailMax = 2000

/// As much of `text` as the server's ceiling holds.
///
/// Measured and cut exactly the way the invite note is (`truncatedInviteNote`
/// in TeamSection.swift) and for the same reason: the route's zod counts UTF-16
/// units, the column's `char_length` counts code points, and `String.count`
/// counts grapheme clusters, which is never the smallest of the three. A cap
/// counted in clusters therefore waves a note past the client that the route
/// then refuses.
///
/// It matters more here than it does there. This call is deliberately never
/// waited on, so a rejected body would lose somebody's words with nobody told.
///
/// Whole characters only, re-measuring each one, so the cut cannot land inside
/// an emoji and leave half of it behind.
func truncatedCancellationDetail(_ text: String) -> String {
    guard text.utf16.count > cancellationDetailMax else { return text }
    var kept = ""
    var length = 0
    for character in text {
        let next = length + String(character).utf16.count
        if next > cancellationDetailMax { break }
        kept.append(character)
        length = next
    }
    return kept
}

/// The POST /v1/billing/cancellation-reason body.
///
/// An EMPTY OBJECT is the point of this function, not an edge case: both fields
/// are optional server-side, and `{}` is the honest record that somebody was
/// asked and went straight through. Sending it is what makes the two numbers
/// comparable, how many were asked against how many said anything, and a client
/// that skipped the call when there was nothing to say would leave the
/// denominator unknowable.
func cancellationReasonBody(reason: String?, detail: String) -> JSONValue {
    var object: [String: JSONValue] = [:]
    if let reason, !reason.isEmpty {
        object["reason"] = .string(reason)
    }
    // Trimmed first, then capped, because the server trims before it measures.
    let written = detail.trimmingCharacters(in: .whitespacesAndNewlines)
    if !written.isEmpty {
        object["detail"] = .string(truncatedCancellationDetail(written))
    }
    return .object(object)
}

// MARK: - Answering that reason (#277 follow-up)

/// MIRROR of `packages/shared/src/cancellation-offers.ts`. Swift cannot import
/// it, so the module is hand-ported and `cancellation-offers.test.ts` is the
/// fixture the port is held to — its cases are re-run in Swift.
///
/// # What this is
///
/// The cancel card asks why, records the answer, and then says nothing back.
/// Six reasons, and for three of them there is a true and useful thing to say
/// that the person has no way of knowing. This is that answer and ONLY that
/// answer: a heading, a body, and an optional action naming a control the
/// client already has on the same screen.
///
/// # What it is deliberately not
///
/// NOT A RETENTION FUNNEL, and the constraint is hard rather than tasteful.
/// `CancelCard` renders open precisely so somebody who answers nothing reaches
/// Stripe in ONE action, because cancelling may never take more steps than
/// subscribing did. Nothing here may be rendered in a way that adds a step.
///
/// NOT A PLACE TO INVENT AN OFFER. Three of the six reasons return nil, and one
/// more returns nil on Starter, because there is nothing honest to say — not
/// because the copy has not been written yet:
///
///   too_expensive on starter  There is no cheaper plan. Inventing one is the
///                             dishonesty #277 forbids.
///   switched                  We do not know what they switched to, and a
///                             rebuttal against a competitor we are guessing at
///                             is an argument, which this is not.
///   not_using / other         The export and the exit are already on the card
///                             and are what those answers actually need.
///
/// There is NO pause feature. Copy implying one sends somebody looking for a
/// button that is not there.
///
/// # Why the figures are read rather than typed
///
/// Three hand-typed copies of a sentence carrying a price and a deadline is
/// three chances to be wrong about money, and the wrong one is always
/// discovered by the customer. Every number below comes from the price book or
/// the plan limits, so a repricing moves the copy instead of stranding it.

/// SPEC §1 key rule 2 / §9 — how long the number is held after cancellation.
///
/// THE CLOCK RUNS FROM `companies.canceled_at`, not from the period end,
/// because that is what the job does: `runGraceJob` measures `now -
/// canceled_at` and releases at 30. Stripe stamps `canceled_at` when cancelling
/// is REQUESTED, so on a cancel-at-period-end the clock can start most of a
/// month before texting stops. Copy that says "30 days after your last period"
/// names a later date than the one the number actually dies on, and a deadline
/// wrong in the customer's favour is the expensive direction to be wrong in.
let cancellationGraceDays = 30

private let cancellationGraceSeconds = TimeInterval(cancellationGraceDays * 24 * 60 * 60)

/// When this workspace's number goes back to the carrier, or nil if it is not
/// cancelled.
///
/// A `Date` rather than a formatted string, so each surface formats it the way
/// that surface needs. Mirrors `releaseDateLabel` in grace.ts, which prints this
/// same date into the day-27 email.
func numberReleaseAt(_ canceledAt: String?) -> Date? {
    guard let canceledAt,
          !canceledAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          let canceled = parseWireTimestamp(canceledAt) else { return nil }
    return canceled.addingTimeInterval(cancellationGraceSeconds)
}

/// Is this workspace still inside the window where coming back keeps the number?
///
/// The grace offer must not be rendered outside it. Past the release the number
/// is gone — back in carrier inventory and reassignable to another business
/// (#413) — so "resubscribe and keep your number" becomes false at exactly this
/// boundary, and it is the sort of false that gets discovered by the person it
/// was promised to.
func isWithinCancellationGrace(_ canceledAt: String?, now: Date = Date()) -> Bool {
    guard let release = numberReleaseAt(canceledAt) else { return false }
    return now < release
}

/// Has the grace-window win-back been waved away for THIS cancellation?
///
/// The comparison is the design. A dismissal belongs to one cancellation, so a
/// stamp left over from a previous one suppresses nothing: somebody who
/// dismisses this, resubscribes, and leaves again next winter gets the answer
/// again, because that second `canceled_at` is newer than the stamp.
///
/// An absent or unreadable stamp is NOT a dismissal. `winback_dismissed_at` is
/// withheld entirely from a caller without `billing.manage`, and failing that
/// way round shows a note to somebody who has not declined it rather than
/// hiding one from somebody who has not.
func winbackIsDismissed(canceledAt: String?, dismissedAt: String?) -> Bool {
    guard let canceled = parseWireTimestamp(canceledAt),
          let dismissed = parseWireTimestamp(dismissedAt) else { return false }
    return dismissed >= canceled
}

/// Where the offer is being read.
///
/// The same reason gets the same ANSWER in both places and a different verb: on
/// the cancel card the subscription is still live, so the control is the plan
/// switch; during grace it is over, so the control is coming back.
enum CancellationOfferPhase: Sendable {
    case before
    case grace
}

/// A control the client already has. Never a route — a route string returned
/// from shared logic would be wrong on two of the three platforms. The LABEL is
/// shared, because the words on the button are not platform-specific and three
/// of them would drift.
enum CancellationOfferAction: Equatable, Sendable {
    /// The plan switcher already on the billing screen, targeting Starter.
    case changePlan
    /// The resubscribe control, with Starter as the plan rather than the old one.
    case resubscribeStarter
    /// The in-product help surface (#382) — `SettingsSection.help` here.
    case openHelp
}

struct CancellationOffer: Equatable, Sendable {
    /// The reason this answers, so a surface can key on it.
    let reason: String
    let heading: String
    let body: String
    /// Nil when the words are the whole answer and there is nothing to press.
    let action: CancellationOfferAction?
    /// The words on that control, or nil when there is no control.
    let actionLabel: String?
}

/// The answer to a stated reason, or nil for "say nothing".
///
/// NIL IS THE COMMON CASE and it is a real answer. Three of the six reasons
/// return it always, one returns it on Starter, and an unrecognised or absent
/// reason returns it too — a client reading a code from a newer build must
/// render nothing rather than guess.
///
/// - Parameters:
///   - reason: the stored reason code. Anything unrecognised yields nil.
///   - plan: `companies.plan`. Nil (never checked out) is treated as Starter.
///   - phase: `.before` is the cancel card, `.grace` the canceled-state card.
///   - billingCurrency: `companies.billing_currency` — what the card is really
///     charged, and so what any price printed here must be in.
///   - country: `companies.country`. Used ONLY to pick a currency when the
///     workspace has no stored one.
///   - registrationFeePaidAt: `companies.registration_fee_paid_at`. Non-nil
///     unlocks one extra sentence in the seasonal answer, and it is the
///     sentence a seasonal business is actually asking about: what coming back
///     costs.
func cancellationOffer(
    reason: String?,
    plan: String?,
    phase: CancellationOfferPhase = .before,
    billingCurrency: String? = nil,
    country: String? = nil,
    registrationFeePaidAt: String? = nil
) -> CancellationOffer? {
    // The shared list is the contract, so a code this build has never heard of
    // renders nothing instead of falling through to a guessed answer.
    guard let reason, cancellationReasons.contains(where: { $0.code == reason }) else {
        return nil
    }
    switch reason {
    case "too_expensive":
        return tooExpensiveCancellationOffer(
            plan: plan,
            phase: phase,
            billingCurrency: billingCurrency,
            country: country
        )
    case "seasonal":
        return seasonalCancellationOffer(
            phase: phase,
            registrationFeePaidAt: registrationFeePaidAt
        )
    case "missing_feature":
        return missingFeatureCancellationOffer()
    // switched / not_using / other: nothing honest to add. See the header.
    default:
        return nil
    }
}

/// The cheaper-plan answer, and the ONE case it is not offered.
///
/// A workspace already on Starter gets nothing, because there is nothing below
/// it. The alternative — some softer sentence about how the price is fair — is
/// an argument with somebody who has just told us it is not, on the screen they
/// came to leave from.
///
/// # A FIGURE MAY ONLY BE PRINTED ON THE PATH THAT ENFORCES IT
///
/// The rule the shared module settled on after the first round of this copy
/// shipped with a limit the next tap did not apply. The two routes back to
/// Starter are not the same route:
///
///   before  POST /v1/billing/change-plan. Refuses (409) while the workspace
///           holds more numbers than Starter allows, and again while active
///           members exceed the Starter seats. The allowances are real there,
///           so they are stated.
///   grace   Stripe checkout. Its only gates are "one live subscription" and
///           the US registration draft — no seat count, no number count — and
///           `checkout.session.completed` then un-suspends EVERY suspended
///           number with no plan filter. A Pro workspace with two numbers and
///           eight members can come back on Starter holding two and eight, so
///           the seat and number allowances are NOT stated there.
///
/// Dropping the grace control instead was rejected: change-plan 409s a canceled
/// subscription outright ("resubscribe to change plans"), so checkout is the
/// ONLY way back once the subscription is dead, and removing the button would
/// leave the win-back with nothing to press at the one moment it is worth
/// anything. What was false was the FIGURE, not the button. The price stays in
/// both, because both end at a Starter subscription built from the Starter
/// prices.
///
/// WHY THE BEFORE PHASE NAMES A REFUSAL. It used to end "your number and your
/// message history stay exactly as they are", which is true for the workspace
/// that fits Starter and false for exactly the workspace being spoken to: a Pro
/// tenant holding a second number is REFUSED the downgrade until it is
/// released. The history genuinely does survive and is still promised; the
/// second number is not, because the next tap is where they would find out.
///
/// The smaller allowances are named without a figure, matching the plan card on
/// this same screen: #85 and #121 put the concrete numbers only in the fair-use
/// policy, and a count quoted here would be a second home for them.
private func tooExpensiveCancellationOffer(
    plan: String?,
    phase: CancellationOfferPhase,
    billingCurrency: String?,
    country: String?
) -> CancellationOffer? {
    guard plan == "pro" else { return nil }

    let currency = billingCurrencyFor(stored: billingCurrency, country: country)
    // Unprefixed "$": it is the reader's own money. `formatMonthlyCents` drops
    // the cents on a whole dollar, which is what `formatMoney` does too.
    let starter = formatMonthlyCents(planPriceCents("starter", currency))
    let pro = formatMonthlyCents(planPriceCents("pro", currency))
    // True on both routes back: both end at a Starter subscription built from
    // the Starter prices, and the metered allowances ride those same prices.
    let price = "Starter is \(starter) a month instead of \(pro), with smaller "
        + "texting and calling allowances under the same fair-use policy."
    // Seats and numbers, and so only for the phase whose route refuses them.
    let limits = "It covers \(starterSeats) people and \(starterNumbers) business "
        + "number\(starterNumbers == 1 ? "" : "s")."

    if phase == .grace {
        return CancellationOffer(
            reason: "too_expensive",
            heading: "There is a smaller plan to come back on",
            body: price
                + " Come back on Starter and your number and your whole message "
                + "history come with you.",
            action: .resubscribeStarter,
            actionLabel: "Come back on Starter"
        )
    }
    return CancellationOffer(
        reason: "too_expensive",
        heading: "Starter is the same product, priced for a smaller crew",
        body: price + " " + limits
            + " The switch takes effect at the end of your current billing "
            + "period. Your message history comes with you, and so does the "
            + "number you text from — a second number does not: the downgrade is "
            + "refused until you release it, and until the crew is back inside "
            + "\(starterSeats) seats.",
        action: .changePlan,
        actionLabel: "Switch to Starter"
    )
}

/// The seasonal answer: what is already true about going quiet and coming back.
///
/// THERE IS NO PAUSE, and this copy must never imply one. What exists is the
/// 30-day hold, and for a business that goes quiet for a winter the useful
/// facts are that the number keeps receiving, the history survives, and the
/// one-time registration fee is not charged twice.
///
/// "You cannot reply" is in there on purpose. `runPreSendGates` requires an
/// active subscription and answers 402 otherwise, so a cancelled workspace can
/// receive and cannot send. Leaving that out would let somebody plan a quiet
/// season around a product that answers their customers, and find out otherwise
/// from a customer.
///
/// THE HEADING MAY NOT COVER THE SEASON. It used to read "Your number is held
/// while you are gone", over a body that said 30 days, to a reader who had just
/// said they would be back next spring. A trades quiet season is months; the
/// hold is 30 days; and the heading is the line that gets read. So the heading
/// carries the duration and the anchor, and the body says plainly that a longer
/// season outruns it — which is the whole reason this answer is worth showing
/// to somebody whose plan is to disappear until the work comes back.
///
/// THE ANCHOR IS THE CANCELLATION, NOT THE PERIOD END. `runGraceJob` measures
/// `now - canceled_at`, and `startCancellationLifecycle` stamps that column
/// from Stripe's `canceled_at`, which for a `cancel_at_period_end` cancellation
/// is the time of the REQUEST (the vendored `Subscriptions.d.ts` says so in as
/// many words), not the end of the period. Somebody who cancels on day 2 of a
/// month and reads "your period ends, then we hold it for 30 days" counts about
/// 59 days and has about 30. What they lose at the end of the miscount is the
/// number on the side of the van, so both phases name the wrong anchor by name
/// in order to deny it — the wrong anchor is the one already in the reader's
/// head.
private func seasonalCancellationOffer(
    phase: CancellationOfferPhase,
    registrationFeePaidAt: String?
) -> CancellationOffer {
    // Gated on the TIMESTAMP rather than on country, because the timestamp is
    // the exact thing checkout tests: the $29 line is added only when
    // `registration_fee_paid_at IS NULL`, and the webhook stamps it once per
    // company ever. A workspace that has not paid it WILL be charged on return,
    // so for them this sentence is simply absent rather than softened.
    let paid = !(registrationFeePaidAt ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    let fee = paid
        ? " You have already paid the one-time registration fee, and it is "
            + "charged at most once per workspace, ever — coming back does not "
            + "charge it again."
        : ""

    if phase == .grace {
        return CancellationOffer(
            reason: "seasonal",
            heading: "Your number is still yours until the date below",
            body: "It is still receiving texts, so nothing a customer sends is lost, "
                + "though you cannot reply until you are back. That date is "
                + "\(cancellationGraceDays) days from the day you cancelled, not from "
                + "the end of your last billing period. Resubscribe before then and "
                + "the number and your whole message history come back with you." + fee,
            action: nil,
            actionLabel: nil
        )
    }
    return CancellationOffer(
        reason: "seasonal",
        heading: "Your number is held for \(cancellationGraceDays) days from the "
            + "day you cancel",
        body: "It keeps receiving texts the whole time, so nothing a customer sends "
            + "is lost — you cannot reply until you are back, and your message "
            + "history stays put. The \(cancellationGraceDays) days run from the day "
            + "you cancel, not from the end of your billing period, so a quiet season "
            + "longer than that outruns the hold and the number goes back to the "
            + "phone company." + fee,
        action: nil,
        actionLabel: nil
    )
}

/// The missing-feature answer: the route to a human, and what it promises.
///
/// Both sentences are read from the support constants rather than restated, for
/// the reason that module gives: a response time typed into three clients
/// separately is a promise somebody made without knowing they were making it.
/// Same words the help screen shows, so the offer cannot promise something the
/// help screen does not.
private func missingFeatureCancellationOffer() -> CancellationOffer {
    CancellationOffer(
        reason: "missing_feature",
        heading: "Tell us what was missing",
        body: "If the thing you needed is not here, the fastest way to change that is "
            + "to tell us what it was. We answer \(supportResponseTime). "
            + supportFixPromise,
        action: .openHelp,
        actionLabel: "Get help"
    )
}
