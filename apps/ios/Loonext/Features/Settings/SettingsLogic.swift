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

    /// CA workspace turning on US texting (`usRegistrationFeeCents`) — OWNER
    /// only. Not "$29": the reader of that card is Canadian by construction.
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
///
/// #224: THE THOUSANDS SEPARATOR IS NOT COSMETIC HERE ANY MORE. This formatter
/// was written for plan prices, where the largest figure in the book is $109 and
/// grouping never fires — so its absence cost nothing and matched nothing.
/// Text-to-pay hands it amounts up to $25,000, and "$25000" beside web's
/// "$25,000" is the same bill printed two ways, on the one screen where somebody
/// is about to charge a customer's card. `formatMoney` in
/// packages/shared/src/billing-currency.ts groups via `toLocaleString("en-CA")`;
/// this is that behaviour, spelled with the digit grouper already in this file.
///
/// The cents are assembled with integer arithmetic rather than `%.2f` over a
/// Double, for the reason `parsePaymentAmountToCents` gives at length: a money
/// amount that becomes a binary double on its way to a screen is one rounding
/// rule away from disagreeing with what the card is actually charged.
func formatMonthlyCents(_ cents: Int) -> String {
    let whole = groupDigits(cents / 100)
    if cents % 100 == 0 { return "$" + whole }
    return "$" + whole
        + String(format: ".%02d", locale: settingsPosixLocale, abs(cents % 100))
}

/// "$12.34" — always two decimals (projected overage dollars).
///
/// #522: the bare "$" is correct here, and worth saying because `formatMoneyIn`
/// right below exists precisely to add a "US$"/"CA$" prefix. Every figure this
/// formats is the workspace's OWN money — `GET /v1/usage` prices the segment
/// overage, the voice overage and the month-end projection at that workspace's
/// own rates — and a Canadian reading their own invoice should see "$40.00", not
/// "CA$40.00". The qualifier belongs on a foreign price.
///
/// Which makes this right only while the amount really is the reader's currency.
/// Use `formatMoneyIn` for anything filed in one currency and quoted to
/// everybody, like the USD-only extra-number line.
func formatCents(_ cents: Int) -> String {
    "$" + String(format: "%.2f", locale: settingsPosixLocale, Double(cents) / 100.0)
}

/// Money whose currency is not necessarily the reader's — `formatMoney`'s twin
/// (packages/shared/src/billing-currency.ts).
///
/// WHEN THE TWO AGREE THE PREFIX IS WRONG. "$39" to a Canadian reading their own
/// CAD invoice is right; "CA$39" reads as though we expect them to be confused
/// about their own money. That is why `formatMonthlyCents` stays the formatter
/// for a plan price and this one exists beside it rather than replacing it.
///
/// WHEN THEY DISAGREE THE PREFIX IS THE WHOLE POINT. Some figures are filed in
/// ONE currency and quoted to everybody — the add-on catalog and the #523
/// extra-number price are both USD-only, so a workspace billed in CAD is being
/// quoted a US price. A bare "$5" there means CAD to the reader and we would
/// charge US$5, which is the exact shape of #522. The server states the currency
/// of every such figure; this renders that statement.
func formatMoneyIn(
    _ cents: Int,
    _ currency: BillingCurrency,
    audience: BillingCurrency
) -> String {
    let amount = formatMonthlyCents(cents)
    if currency == audience { return amount }
    // "US$5" / "CA$5" — the prefix goes before the sign, matching web.
    return (currency == .usd ? "US" : "CA") + amount
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

/// The one-time US texting registration fee in the minor unit —
/// US_REGISTRATION_FEE_CENTS (#328).
///
/// EVERY READER OF THIS FIGURE IS CANADIAN. The only surface that quotes it is
/// the card a workspace sees while `country == "CA"` and US texting is off, and
/// `api_create_company` bills every CA workspace in CAD. So the flat "$29" that
/// stood on that card was wrong for every single person who ever read it — on
/// the one card whose entire purpose is consent to the charge. A US workspace
/// is never offered the fee at all; it is charged with the first subscription.
///
/// READ RATHER THAN TYPED, and the reason is sharper here than for a plan
/// price: the fee and the Starter plan are the same amount in both currencies
/// today (2900/3900), so an implementation that reached for `planPriceCents`
/// instead would render correctly until one of the two moves, and then be
/// wrong with no test failing. They are separate figures that happen to agree.
func usRegistrationFeeCents(_ currency: BillingCurrency) -> Int {
    switch currency {
    case .usd: return 2900
    case .cad: return 3900
    }
}

// MARK: - Extra numbers (#464 / #522)

/// The currency the extra-number prices are filed in — EXTRA_NUMBER_CURRENCY in
/// packages/shared/src/extra-numbers.ts.
///
/// USD only, and not derivable: the CAD book was priced item by item and its
/// ratios all differ (2900→3900, 7900→10900, 3→4, 2.5→3.5, 1→1.5), so there is
/// no rule that yields a CAD figure for a $5 line.
let extraNumberCurrency: BillingCurrency = .usd

/// Monthly price per extra number in the minor unit —
/// EXTRA_NUMBER_MONTHLY_CENTS (#80: $5 Starter, $4 Pro).
///
/// Looked up STRICTLY rather than defaulted to Starter: a workspace with no plan
/// is not a Starter workspace, and quoting it Starter's price would name a figure
/// for a purchase that cannot happen.
func extraNumberMonthlyCents(_ plan: String?) -> Int? {
    switch plan {
    case "starter": return 500
    case "pro": return 400
    default: return nil
    }
}

/// "US$5/mo" to a CAD workspace, "$5/mo" to a USD one — nil when there is no
/// plan whose price book applies.
///
/// #522: this card is where consent to the charge is given, so the bare "$5" it
/// used to print was the defect in miniature — to a Canadian reader "$5" means
/// CA$5 for a line the card takes US$5 for. `formatMoneyIn` states the currency
/// exactly when it differs from the reader's.
func extraNumberMonthly(_ plan: String?, audience: BillingCurrency) -> String? {
    guard let cents = extraNumberMonthlyCents(plan) else { return nil }
    return formatMoneyIn(cents, extraNumberCurrency, audience: audience) + "/mo"
}

/// Why this workspace cannot buy one more number, or nil when it can.
///
/// Hand-port of `extraNumberBlockedReason` in packages/shared/src/extra-numbers.ts,
/// which the API, the web app and Android all already used. iOS did not, and
/// carried the pre-#464 rule instead:
///
///     !(country == "US" && us_texting_enabled)
///
/// `usTextingEnabled` is the 10DLC gate and is NEVER true for a Canadian
/// workspace, because Canada has no such registration — so that condition
/// refused every Canadian customer forever, and told them "an extra number is a
/// US number", which is not true. The Starter total cap is checked by the caller,
/// which already counts live numbers.
func extraNumberBlockedReason(
    country: String,
    usTextingEnabled: Bool,
    billingCurrency: String?
) -> String? {
    if country != "US" && country != "CA" {
        return "Extra numbers are available for US and Canadian workspaces."
    }
    // US only: the carriers must approve the brand before a US number can text.
    if country == "US" && !usTextingEnabled {
        return "An extra number needs US texting turned on for your workspace first."
    }
    // #522: a Stripe subscription bills in ONE currency and every item on it has
    // to carry an amount in that currency, so a USD-only price cannot join a
    // subscription billed in another. Better a sentence than a tap that becomes
    // an error.
    //
    // A nil or unrecognised value reads as USD, matching `billingCurrencyOf` on
    // the server: this must never refuse a sale because a field was missing from
    // an older response.
    let currency = billingCurrency?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
    if let currency, !currency.isEmpty, currency != extraNumberCurrency.rawValue {
        return "Extra numbers are priced in US dollars and can't be added to a "
            + "subscription billed in another currency yet. Contact support and "
            + "we'll sort it out."
    }
    return nil
}

/// #525 — the invitation a paused workspace reads above the button.
///
/// TWO PARTS RATHER THAN ONE PARAGRAPH: the heading is the answer to the
/// question a paused owner actually has ("is this even open to me right now"),
/// and the detail is why it is worth doing today. Rendered as heading + body so
/// the answer is legible without reading the paragraph — a strong-relationship
/// pair, tight spacing.
struct UsRegistrationPausedNote: Equatable, Sendable {
    let heading: String
    let detail: String
}

/// Everything the enable-US-texting card prints — all in one money, and all in
/// one account of whether this workspace is paused.
struct EnableUsTextingCopy: Equatable, Sendable {
    /// The owner's button.
    let buttonLabel: String
    /// The confirmation sheet's body: the terms every reader gets, plus the
    /// closing promise when there is one that holds.
    let confirmMessage: String
    /// What a reader who cannot press the button is told instead.
    let readOnlyLine: String
    /// #525 — the note on the card itself, and nil when there is nothing to
    /// disclose.
    ///
    /// AN OPTIONAL RATHER THAN AN ALWAYS-PRESENT SENTENCE, because the note has
    /// to be absent for the ordinary reader: a workspace that is not paused
    /// would otherwise be handed a paragraph about a state it is not in, on the
    /// card whose whole job is to be understood before money moves.
    let pausedNote: UsRegistrationPausedNote?
    /// #525 — the extra things a PAUSED buyer is agreeing to, one fact per
    /// line. Empty for everybody else.
    let pausedTerms: [String]
    /// What the toast says once the charge has landed — the receipt, and the
    /// last thing anybody reads before leaving this screen.
    let startedMessage: String
}

/// The enable-US-texting card's copy, in the currency this workspace is billed
/// in.
///
/// THE CURRENCY IS A PARAMETER AND HAS NO DEFAULT, for the reason `planFacts`
/// spells out below: a defaulted one lets the next call site quietly go back to
/// printing one workspace's money at another workspace, and nothing at the call
/// site has to mention money for that to happen. There is no harmless default
/// to pick here either — this card has no US readers at all, so `.usd` would be
/// wrong for one hundred percent of them.
///
/// THE COPY LIVES HERE RATHER THAN IN THE VIEW so the figure can be asserted
/// without rendering SwiftUI. That is the same move the pause copy made after a
/// price was typed straight into a view body, and the same reason: a sentence
/// only a screenshot can check is a sentence nothing checks.
///
/// Unprefixed "$": it is the reader's own money, and "CA$39" to a Canadian
/// reads as though we expect them to be confused about it — the same call
/// `formatMoney` makes on web, whose `audience` parameter defaults to the
/// currency. `formatMonthlyCents` is the house money formatter and drops the
/// cents on a whole dollar; its name says "monthly" and this fee is charged
/// once, which is a naming debt rather than a reason for a second formatter
/// that rounds differently.
///
/// # `paused` (#525), and why it does not remove anything
///
/// `POST /v1/registration/enable-us` charges the fee and submits the carrier
/// registration WITHOUT reading `paused_at`, and that is the decision rather
/// than an oversight: carrier approval takes days to weeks, nothing in the
/// registration path is blocked by a pause, and a seasonal crew's quiet winter
/// is the cheapest time in the year to spend that wait. Refusing would mean
/// they resume in spring and then wait another week before they can text a US
/// customer.
///
/// So the pause changes what this card SAYS and never what it offers. The
/// button label and the read-only line are byte-identical either way — a paused
/// reader is sold the same thing at the same price — and the terms every reader
/// gets are word for word the same. What changes is the closing promise: "we
/// handle it and email you when it's live" is the shipped copy making a promise
/// the send gate then breaks, so a paused reader gets the three facts that are
/// actually true for them instead.
///
/// THE NOTE ON THE CARD LEADS WITH THE INVITATION, NOT THE LIMIT. A paused
/// owner reading a US texting card that says nothing about their pause concludes
/// the feature is shut to them and does not press — which is refusal, arrived at
/// by silence, and it is the outcome #525 rules out. What the pause blocks is a
/// term of the sale, and it belongs in the sheet where they agree to it.
///
/// # A `Bool` here, and the read is the caller's problem
///
/// The caller has to have READ the pause to answer this, and "not paused" and
/// "not read yet" are different screens — see `PauseRead`. This function takes
/// the settled fact; `EnableUsCard` is where the read state collapses into it,
/// and it collapses toward `false`, which is the copy that has always shipped.
///
/// NO DEFAULT, for the same reason the currency has none: a defaulted `false`
/// is a call site quietly claiming the workspace is not paused without anything
/// on that line mentioning the pause at all.
func enableUsTextingCopy(
    _ currency: BillingCurrency,
    paused: Bool
) -> EnableUsTextingCopy {
    let fee = formatMonthlyCents(usRegistrationFeeCents(currency))
    // The terms EVERY reader gets: what is charged, who reviews it, how long
    // that takes. Word for word what this sheet has always said, split at the
    // sentence boundary so the branch below drops a promise rather than
    // rewriting the agreement.
    let terms = "A one-time \(fee) registration fee is charged to your card on "
        + "file, and we register your business with US carriers. Approval "
        + "usually takes 3 to 7 business days."
    // Hoisted and explicitly typed rather than written as ternaries inside the
    // initialiser: several branches nested in a struct literal is the shape
    // that makes Swift's type checker give up on an expression, and each branch
    // reads better on its own line anyway.
    let note: UsRegistrationPausedNote? = paused
        ? UsRegistrationPausedNote(
            heading: "You can start this while your plan is paused",
            detail: "Carrier review takes days either way, and none of it needs "
                + "your plan running. Doing it now means the waiting happens in "
                + "your quiet season rather than in your first week back."
        )
        : nil
    // THREE FACTS AS THREE LINES, not a fourth clause on a 45-word paragraph.
    // Only the last of them changes an expectation, and a clause buried at the
    // end of a long sentence is the clause that gets skimmed — at the moment
    // somebody is agreeing to a charge.
    //
    // The first is the value argument and is worthless unspoken: the fee is
    // stamped on `companies.registration_fee_paid_at`, so paying during the
    // pause is not paying again in spring.
    let extraTerms: [String] = paused
        ? [
            "The \(fee) is charged today, and it is charged once ever — not "
                + "again when you come back.",
            "Carriers review you while your plan is paused. The pause does not "
                + "hold the registration up.",
            "Sending stays off until you resume. Approval means US texting is "
                + "set up and waiting for you, not that a paused plan starts "
                + "sending.",
        ]
        : []
    // The promise is DROPPED for a paused reader rather than qualified. Left in
    // place with a caveat beneath it, the false sentence is still on the screen
    // above its own correction, and it is the sentence somebody quotes back at
    // us when their texts do not send.
    let body: String = paused
        ? terms
        : terms + " We handle it and email you when it's live."
    let started: String = paused
        ? "US registration started. We'll email you when it's approved; US texts "
            + "go out when you resume."
        : "US registration started. We'll email you when it's approved."
    return EnableUsTextingCopy(
        buttonLabel: "Enable US texting: \(fee) one-time",
        confirmMessage: body,
        readOnlyLine: "Ask your account owner to enable US texting; it's a "
            + "one-time \(fee) carrier registration.",
        pausedNote: note,
        pausedTerms: extraTerms,
        startedMessage: started
    )
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

/// "Quiet season, I'll be back" — the one reason the paid pause answers.
///
/// Named rather than spelled out at each site: the reason list, the answer the
/// cancel card renders and the pause substitution all have to agree about this
/// string, and a third spelling of it would silently split them.
let cancellationReasonSeasonal = "seasonal"

/// The six, in the order they are offered, identical on all three clients.
///
/// There is no default and there is no "prefer not to say" row: the way to not
/// answer is to not answer, and the button that leaves works either way.
let cancellationReasons: [CancellationReason] = [
    CancellationReason(code: "too_expensive", label: "Too expensive"),
    CancellationReason(code: cancellationReasonSeasonal, label: "Quiet season, I'll be back"),
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
/// A PAUSE IS NAMED ONLY TO A WORKSPACE THAT IS IN ONE. The paid pause exists
/// now, so the old flat ban on the word is gone — but whether one is on OFFER is
/// a Stripe read that `GET /v1/billing/pause` owns, and it refuses a workspace
/// with a prepaid year, an unconsumed referral month, a pending plan change, an
/// unhealthy card or an unprovisioned price. This function sees none of that, so
/// a sentence here mentioning a pause to somebody who is not already in one
/// sends them looking for a button the API will not give them.
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
///   - paused: `companies.paused_at != nil`, as `GET /v1/billing/pause` reports
///     it. OMITTED MEANS NOT PAUSED, deliberately: every answer this function
///     gave before the pause existed is the answer for an unpaused workspace, so
///     a caller that does not pass this reads exactly what it read before, word
///     for word. PASS THE FACT YOU HAVE READ, never the absence of one — `false`
///     is a claim, and on a paused workspace it is the claim that puts a "Switch
///     to Starter" button in front of a 409. A client whose read has not landed
///     has `cancellationOffer(read:reason:plan:…)` for exactly that.
func cancellationOffer(
    reason: String?,
    plan: String?,
    phase: CancellationOfferPhase = .before,
    billingCurrency: String? = nil,
    country: String? = nil,
    registrationFeePaidAt: String? = nil,
    paused: Bool? = nil
) -> CancellationOffer? {
    // The shared list is the contract, so a code this build has never heard of
    // renders nothing instead of falling through to a guessed answer.
    guard let reason, cancellationReasons.contains(where: { $0.code == reason }) else {
        return nil
    }
    // The pause fact, narrowed to the phase it can be true in.
    //
    // `paused_at` OUTLIVES THE SUBSCRIPTION IT BELONGED TO: nothing clears it on
    // cancellation (the daily reconcile skips cancelled tenants, and
    // `claim_checkout_activation` clears it only if they come back — see
    // 20260805080000_resubscribe_clears_pause.sql). So a grace-phase caller
    // reading a company row can hand over a `true` for a workspace whose pause
    // died with its subscription and whose 30-day clock is running right now,
    // and honouring it there would answer "nothing expires" to the one reader
    // for whom something is. `isPaused` in scripts/ops/pricing-report.mjs draws
    // the same line, after the same stale fact named a churned workspace as a
    // paying paused one in a founder report.
    //
    // `== true` rather than a truthiness test because the parameter is `Bool?`
    // and a client with nothing to say says nil.
    let isPaused = paused == true && phase == .before
    switch reason {
    case "too_expensive":
        return tooExpensiveCancellationOffer(
            plan: plan,
            phase: phase,
            billingCurrency: billingCurrency,
            country: country,
            paused: isPaused
        )
    case "seasonal":
        return isPaused
            ? pausedSeasonalCancellationOffer(
                registrationFeePaidAt: registrationFeePaidAt
            )
            : seasonalCancellationOffer(
                phase: phase,
                registrationFeePaidAt: registrationFeePaidAt
            )
    // The support promise does not change because the plan is paused, for the
    // same reason it does not change between the two phases: it is a promise
    // about us answering, not about the state of their subscription.
    case "missing_feature":
        return missingFeatureCancellationOffer()
    // switched / not_using / other: nothing honest to add, paused or not — a
    // pause does not tell us what they switched to. See the header.
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
///           the US registration draft — no seat count, no number count — so
///           nothing there refuses a Pro workspace with two numbers and eight
///           members, and the allowances are NOT stated.
///
///           #523 changed what happens after that checkout, not whether it is
///           allowed: the completion handler claims the allowance, so the
///           second number comes back HELD rather than active — suspended, not
///           released, still receiving, and named on the billing screen with
///           two priced routes back. Seats are unchanged; the only gates on
///           them are at invite and at acceptance, so the eight stay eight.
///           Neither figure has become a ceiling this path applies, so neither
///           is quoted here.
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
///
/// WHY THE PAUSED ANSWER KEEPS THE WORDS AND DROPS THE BUTTON. While paused, the
/// pause offer itself is over (`GET /v1/billing/pause` answers
/// `already_paused`), so the cancel card falls through to this function — and it
/// used to hand a paused Pro workspace "Switch to Starter", whose
/// `POST /v1/billing/change-plan` answers 409 "Your plan is paused. Resume it
/// first, then switch plans". Returning nil for the whole offer was the other
/// option and it is worse: somebody cancelling over $79 would be told nothing
/// about the $29 plan they can have. What the API refuses is the CLICK, not the
/// fact — so the sentences stay, the control goes, and the copy names the two
/// steps in the order the 409 itself names them.
private func tooExpensiveCancellationOffer(
    plan: String?,
    phase: CancellationOfferPhase,
    billingCurrency: String?,
    country: String?,
    paused: Bool
) -> CancellationOffer? {
    // Still nothing below Starter, and a pause does not invent one.
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

    // Same heading as the unpaused answer, on purpose: it is a fact about the
    // two plans and the pause does not touch it. A second heading would be a
    // second string for three clients to hand-port and drift.
    //
    // Answered BEFORE the phase, which is safe because `cancellationOffer`
    // narrows `paused` to the `before` phase before calling in: a paused
    // workspace in the grace phase is a stale flag, not a state, and this branch
    // never sees one.
    if paused {
        return CancellationOffer(
            reason: "too_expensive",
            heading: "Starter is the same product, priced for a smaller crew",
            body: price + " " + limits
                + " Your plan is paused, so this takes two steps in this order: "
                + "resume first, then switch plans. The switch takes effect at "
                + "the end of your current billing period. Your message history "
                + "comes with you, and so does the number you text from — a "
                + "second number does not: the downgrade is refused until you "
                + "release it, and until the crew is back inside "
                + "\(starterSeats) seats.",
            // No `resume` control either: Resume is already on the paused card
            // at the top of this same screen, and a second one here would be
            // this module growing a control.
            action: nil,
            actionLabel: nil
        )
    }

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

/// The fee sentence, only for a workspace that has actually paid it.
///
/// Gated on the TIMESTAMP rather than on country, because the timestamp is the
/// exact thing checkout tests: the registration line is added only when
/// `registration_fee_paid_at IS NULL`, and the webhook stamps it once per
/// company ever. A workspace that has not paid it WILL be charged on return, so
/// for them this sentence is simply absent rather than softened.
///
/// SAID TO THE PAUSED READER TOO. It answers "what does coming back cost", and
/// that question survives the pause unchanged: the fee is charged at most once
/// per workspace ever, so neither resuming nor cancelling-and-returning charges
/// it again. Lifted out of `seasonalCancellationOffer` when the paused answer
/// needed the same sentence — one copy, because two would be one promise about
/// money typed twice.
private func registrationFeeSentence(_ registrationFeePaidAt: String?) -> String {
    let paid = !(registrationFeePaidAt ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    guard paid else { return "" }
    return " You have already paid the one-time registration fee, and it is "
        + "charged at most once per workspace, ever — coming back does not "
        + "charge it again."
}

/// The seasonal answer for somebody who ALREADY PAUSED, and is cancelling anyway.
///
/// They are not choosing between leaving and a 30-day hold; they are choosing
/// between the thing they already have and giving it up, and only one of those
/// two has a deadline. So this answer states both sides of exactly that:
///
///   what they have   the number and the history are held, and nothing expires
///                    while the plan is paused. The pause is a licensed-price
///                    swap with no clock attached — `runGraceJob` measures
///                    `now - canceled_at`, and a paused workspace has no
///                    `canceled_at`, so there is genuinely nothing counting.
///   what they lose   cancelling ends the pause and starts the hold, which is
///                    the only countdown in this product. Anchored to the
///                    cancellation for the reason the unpaused answer below
///                    gives at length.
///
/// THE UNPAUSED COPY IS FALSE HERE, which is why this exists rather than a
/// tweak. It has to end by admitting that "a quiet season longer than that
/// outruns the hold and the number goes back to the phone company" — and twelve
/// lines above it on the same screen, the paused card says pausing starts no
/// clock at all. Both sentences were on screen together.
///
/// NO CONTROL, same as every other seasonal answer. Resume is already on the
/// paused card on this screen, and the point of the paragraph is not to press
/// anything — it is that somebody about to trade an open-ended hold for a 30-day
/// one should know that is the trade. It is not an argument either: two facts,
/// in the order they matter, and no sentence telling them which to pick.
private func pausedSeasonalCancellationOffer(
    registrationFeePaidAt: String?
) -> CancellationOffer {
    CancellationOffer(
        reason: "seasonal",
        heading: "Your plan is already paused, and that hold has no deadline",
        body: "Your number and your whole message history are held for as long as "
            + "you stay paused — nothing expires while your plan is paused, and "
            + "there is no date you have to be back by. Cancelling instead ends "
            + "the pause and starts a clock: \(cancellationGraceDays) days from "
            + "the day you cancel, not from the end of your billing period, and "
            + "at the end of it the number goes back to the phone company."
            + registrationFeeSentence(registrationFeePaidAt),
        action: nil,
        actionLabel: nil
    )
}

/// The seasonal answer: what is already true about going quiet and coming back.
///
/// THIS COPY IS FOR SOMEBODY WHO HAS NOT PAUSED. What it describes is the
/// 30-day hold, and for a business that goes quiet for a winter the useful
/// facts are that the number keeps receiving, the history survives, and the
/// one-time registration fee is not charged twice. It must not mention the
/// pause: whether one is on offer is the API's read, not ours (see the header).
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
    // The same sentence the paused answer above uses, from the same gate.
    let fee = registrationFeeSentence(registrationFeePaidAt)

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

// MARK: - The paid pause (#277)

/// A quiet season, priced: the number and the whole message history stay, the
/// texting stops, and there is no fuse on any of it.
///
/// # THE ONE RULE THIS SECTION EXISTS TO KEEP
///
/// `eligible` is the ONLY thing that may put a Pause control on screen. The API
/// computes it as `eligibility.eligible && offer !== null`, so a pause it cannot
/// QUOTE already reports false, and nothing below re-derives it from `reason`.
/// There are eight refusal reasons and a client that tried to interpret them
/// would be a ninth opinion about whether somebody may be charged monthly.
///
/// # Why no figure is typed here
///
/// The pause price is not in this repository at all: the founder provisions a
/// Stripe price and the API reads it back before the offer is ever rendered. A
/// number typed into this file would be a recurring charge a client invented,
/// and the customer would find out about the real one on the invoice. So every
/// price below arrives as cents from the API, and a nil renders no sentence at
/// all rather than a plausible-looking default.
///
/// # What a pause means, which is what this copy has to be right about
///
/// Cannot send (`runPreSendGates` refuses with `workspace_paused`), cannot dial
/// in or out, inbound texts still ARRIVE, and scheduled sends are HELD rather
/// than failed. The number and the history are untouched. Leaving out "you
/// cannot reply" would let somebody plan a whole quiet season around a product
/// that answers their customers, and find out otherwise from a customer.

/// The price to print on a Pause OFFER, or nil when there is nothing to offer.
///
/// The second gate is not redundant with the first. `eligible` already folds in
/// "we could read a price" — but this client is the last thing standing between
/// an amount and a person agreeing to pay it every month, and the specific
/// failure it refuses is a button that says "Pause" with no number on it. A
/// missing figure therefore renders exactly what `not_provisioned` renders:
/// nothing at all, because the offer does not exist.
///
/// A workspace already paused gets nil too. The offer is over for them, and what
/// they have instead is `pausedMonthlyPrice`.
func pauseOfferPrice(_ pause: BillingPause?) -> String? {
    guard let pause, pause.isEligible, !pauseIsActive(pause),
          let cents = pause.monthly_cents else { return nil }
    return formatMonthlyCents(cents)
}

/// Is this workspace paused RIGHT NOW?
///
/// `paused_at` and nothing else. Never `reason == "already_paused"`: the reason
/// says why an OFFER was refused, and seven of its eight values mean something
/// other than this. A blank string is treated as absent for the reason
/// `numberReleaseAt` treats one that way — an empty timestamp is a serialisation
/// artefact, not a moment in time.
func pauseIsActive(_ pause: BillingPause?) -> Bool {
    guard let stamp = pause?.paused_at else { return false }
    return !stamp.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}

/// What a paused workspace is REALLY charged, or nil when no figure came with
/// the pause.
///
/// Nil prints no sentence rather than falling back to the plan price. The plan
/// price is the one number that is certainly wrong here: a paused subscription's
/// licensed line IS the holding fee, so printing the plan's own price over it
/// would be this screen telling somebody they are paying many times what they
/// are — about their own money, on the billing screen.
func pausedMonthlyPrice(_ pause: BillingPause?) -> String? {
    guard pauseIsActive(pause), let cents = pause?.monthly_cents else { return nil }
    return formatMonthlyCents(cents)
}

/// The pause price to answer `seasonal` with, or nil to leave the shared answer
/// exactly where it was.
///
/// ONE FUNCTION returning the price rather than a Bool beside a second lookup,
/// so "is the answer the pause" and "what does the pause cost" cannot come apart
/// at the call site.
///
/// ONLY `seasonal`. `too_expensive` keeps the smaller-plan answer even on a
/// workspace that could pause, because "your number survives the winter" is not
/// an answer to "this costs too much" — it is a different offer wearing the
/// same slot. The three reasons that answer nothing still answer nothing.
func pauseAnswerPrice(reason: String?, pause: BillingPause?) -> String? {
    reason == cancellationReasonSeasonal ? pauseOfferPrice(pause) : nil
}

/// The offer, in the same voice the cancel card's other answers use.
///
/// It leads with what the money buys and names what STOPS in the same breath,
/// because a seasonal crew can be wrong about that at their customers' expense.
/// The hold is named only to say the pause does not have one — the shared
/// seasonal copy this replaces has to end with "a quiet season longer than that
/// outruns the hold and the number goes back to the phone company", and the
/// whole point of the pause is that this sentence stops being true.
func pauseOfferBody(price: String, resumePlanName: String?) -> String {
    "\(price) a month holds your number and your whole message history for as long "
        + "as the quiet lasts. There is no \(cancellationGraceDays)-day clock on a "
        + "pause and nothing goes back to the phone company. Texting and calling "
        + "stop; texts your customers send still arrive and are waiting for you, and "
        + "anything you scheduled is held rather than cancelled. "
        + (resumePlanName.map { "Come back on \($0) whenever the work does." }
            ?? "Come back whenever the work does.")
}

/// The same facts once more, where the recurring charge is actually agreed to.
///
/// Repetition on purpose: the note above is an offer somebody may have scrolled
/// past, and this is the sentence they read with their thumb over the button.
func pauseConfirmMessage(price: String) -> String {
    "You'll be billed \(price) a month instead of your plan, starting now. Texting "
        + "and calling stop straight away. Your number, your message history and "
        + "anything you have scheduled stay exactly where they are, and texts your "
        + "customers send keep arriving. There is no deadline on any of it — resume "
        + "whenever you like."
}

/// The paused state, as separate facts rather than one paragraph.
///
/// Three of them, plus the price when there is one, because a reader checking
/// "wait, am I still receiving?" is scanning rather than reading. The price goes
/// FIRST when it exists: it is the one line that changes what they owe.
func pausedStateLines(price: String?) -> [String] {
    var lines: [String] = [
        "Texting and calling are off.",
        "Texts your customers send still arrive, and anything you scheduled is held "
            + "until you resume — nothing is lost.",
        "Your number and your whole message history stay exactly where they are, with "
            + "no deadline on them.",
    ]
    if let price {
        lines.insert("You're billed \(price) a month while this is paused.", at: 0)
    }
    return lines
}

/// "Resume Pro", or plain "Resume" when the server did not name a plan.
///
/// `resume_plan` is a real answer months in — the pause never touches `plan` —
/// so naming it is naming what they are getting back, not a guess.
func pauseResumeLabel(planName: String?) -> String {
    planName.map { "Resume \($0)" } ?? "Resume"
}

/// What is said after the pause lands, built from the RESPONSE.
///
/// The API re-reads its own mirror and 409s when it disagrees, so this sentence
/// is only ever composed from a pause that demonstrably exists. No figure when
/// the response carried none — a confirmation is a bad place to invent a price.
func pausedConfirmationMessage(monthlyCents: Int?) -> String {
    guard let monthlyCents else { return "Paused. Texting is off until you resume." }
    return "Paused. You're billed \(formatMonthlyCents(monthlyCents)) a month until "
        + "you resume."
}

// MARK: - What the screen KNOWS about the pause (#277)

/// What the REQUEST has done so far.
///
/// Three cases and deliberately not four: `unaskable` is a fact about the
/// READER — no `billing.manage`, so the whole `/v1/billing` router 403s — known
/// before any request is made, and it is not something a fetch can become. It
/// lives on `PauseRead`, which this becomes once the role is applied by
/// `pauseReadFor`.
///
/// # This split closes a hole; it is not an abstraction for its own sake
///
/// The billing screen keeps this in a `@State` with a default, and while that
/// default had type `PauseRead` a one-token edit — `.loading` to `.unaskable` —
/// restored the whole defect (a paused workspace shown its plan's price beside a
/// green `Active` pill) with every test in the suite still green, because
/// `planCardShape(.unaskable)` is `.active` BY DESIGN. The narrow exception for
/// a reader who genuinely cannot ask was covering a reader who simply had not
/// asked yet. A screen that has not asked must not be able to SAY it cannot ask,
/// and with this type on the state that edit no longer compiles.
enum PauseFetch {
    /// Asked, no answer yet. The ordinary state for the first moment of a visit.
    case loading
    /// Asked, and this is the answer.
    case ready(BillingPause)
    /// Asked, and no answer came back.
    case failed
}

/// The read as every card on the billing screen must see it.
///
/// THE ONE PLACE `.unaskable` IS PRODUCED, and it is produced from the role and
/// from nothing else. That is what keeps `planCardShape`'s exception for a
/// reader who cannot ask from being reachable by a screen that has not asked.
func pauseReadFor(canManageBilling: Bool, fetch: PauseFetch) -> PauseRead {
    guard canManageBilling else { return .unaskable }
    switch fetch {
    case .loading: return .loading
    case .ready(let pause): return .ready(pause)
    case .failed: return .failed
    }
}

/// The state of the read, which is a different thing from the state of the plan.
///
/// # Why this is not `BillingPause?`
///
/// It was, and the optional collapsed three different situations into one value.
/// `nil` meant "the screen just opened", "we asked and Stripe did not answer",
/// and "there is no pause" all at once — and the card downstream read all three
/// as the last one. A workspace paying a holding fee, on a cold start whose read
/// failed, was shown its PLAN's price beside a green Active pill: a wrong number
/// about the reader's own money, on the billing screen, in the confident voice.
///
/// `GET /v1/billing/pause` throws rather than degrading to a null precisely so
/// this cannot happen — the route would rather fail than let the offer render
/// with no price beside it. Swallowing that throw with `try?` threw the
/// distinction away again on the client side. This enum is the throw, kept.
///
/// # The rule
///
/// A screen may not state a fact it has not read. Only `ready` is a fact.
enum PauseRead {
    /// Asked, no answer yet. The ordinary state for the first moment of a visit.
    case loading
    /// Asked, and this is the answer. The only case anything may be asserted
    /// from.
    case ready(BillingPause)
    /// Asked, and no answer came back.
    case failed
    /// Not asked, and not askable. The whole `/v1/billing` router is behind
    /// `billing.manage`, so for a tech or a member there is no answer to be had
    /// — asking would 403 on every visit to this screen.
    case unaskable

    /// The answer, and only when there is one.
    ///
    /// `loading`, `failed` and `unaskable` all hand back nil, which every
    /// pause-copy function already renders as "no offer". So a surface that only
    /// needs the offer keeps taking a `BillingPause?` and needs no new branch.
    var answer: BillingPause? {
        if case .ready(let pause) = self { return pause }
        return nil
    }
}

/// Which plan card may be drawn, given what has actually been read.
enum PlanCardShape: Equatable {
    /// The API said paused. Price, status and controls all come from the pause.
    case paused
    /// The API said not paused. The plan card exactly as it has always been.
    case active
    /// No answer. The card renders what it read from the COMPANY and leaves out
    /// everything that depends on the answer — the price, the status pill and
    /// the plan switch. `checking` is true while the read is still in flight and
    /// false once it has failed, which is the difference between a state that
    /// will resolve itself and one that wants a retry.
    case unconfirmed(checking: Bool)
}

/// The whole of the rule above, in one place a test can reach.
///
/// A FUNCTION RATHER THAN A CHAIN OF `if`s IN THE VIEW, because the view is the
/// one place a test cannot go: the defect this replaces was three lines of
/// SwiftUI, and every unit test in the suite passed straight through it. A
/// `switch` over what this returns cannot silently grow a fourth interpretation,
/// and `CancelOneActionTests` reads the view to prove the branches are in the
/// order that matters.
///
/// `unaskable` RENDERS `active`, and that is a deliberate, narrow exception
/// rather than a hole. For a reader without `billing.manage` there is no answer
/// to be had at any point, so "unconfirmed" would not be a loading state for
/// them — it would permanently delete the plan price from the only screen that
/// prints it, to guard a case they can neither act on nor see a control for.
/// What they get is the card exactly as it was before the pause existed, and
/// "Pro" with its price under the heading "Plan" remains a true statement about
/// the plan. Closing this properly is an API change — a paused marker on the
/// company view, which today deliberately withholds `paused_at` — not a client
/// one.
///
/// The exception is only as narrow as the thing that produces `.unaskable`, and
/// that is `pauseReadFor` reading the role. A screen storing this case in its own
/// state would be claiming "I cannot ask" while holding an unfinished request,
/// and would be handed `.active` for it; `PauseFetch` is what makes that
/// unsayable.
func planCardShape(_ read: PauseRead) -> PlanCardShape {
    switch read {
    case .ready(let pause): return pauseIsActive(pause) ? .paused : .active
    case .loading: return .unconfirmed(checking: true)
    case .failed: return .unconfirmed(checking: false)
    case .unaskable: return .active
    }
}

/// What the card says while it cannot vouch for itself.
///
/// It names what is MISSING rather than apologising in the abstract, because the
/// reader's question on seeing a thinner card is "where did my price go". And it
/// says the plan has not changed, because the second question is "did something
/// happen to my subscription".
func planUnconfirmedLine(checking: Bool) -> String {
    checking
        ? "Checking whether this plan is paused…"
        : "We couldn't check whether this plan is paused, so anything that depends on "
            + "the answer — the price, the status and the plan switch — is left out "
            + "rather than guessed. Nothing about your plan has changed."
}

/// May a control that CHARGES be offered?
///
/// Only on an answer that came back and said "not paused". Enabling a module
/// invoices immediately (`proration_behavior: "always_invoice"`), and
/// `POST /v1/billing/modules` refuses a paused workspace, so offering the toggle
/// on a maybe is offering a purchase that either fails or — worse, before the
/// route was gated — charges for voice on a workspace that cannot dial.
///
/// FAILING CLOSED COSTS NOTHING VISIBLE HERE. The add-ons card already draws
/// nothing until its own catalog fetch returns, so "not yet" looks like the
/// loading state it already has. A read that FAILS hides the card for that
/// visit; the plan card above it says why and offers the retry that heals both.
func mayBuyAddOns(_ read: PauseRead) -> Bool {
    if case .ready(let pause) = read { return !pauseIsActive(pause) }
    return false
}

/// The cancel card's answer, decided from what this screen has actually READ.
///
/// # Why the Bool on `cancellationOffer` is not enough on its own
///
/// A `Bool` cannot tell "not paused" apart from "not read yet". Handing that
/// function `false` on a workspace whose pause read is still in flight — or has
/// failed — puts "Switch to Starter" back in front of a
/// `POST /v1/billing/change-plan` that answers 409 while `companies.paused_at`
/// is set. It is the same defect the plan card above already refuses with
/// `planCardShape`, re-created one inch further down the same screen: that card
/// withholds its own plan switch until the read lands, and this second switch
/// sat under it, ungated.
///
/// # THE WORDS STAY, THE CONTROL GOES
///
/// On an answer this is `cancellationOffer` exactly. On `loading`, `failed` or
/// `unaskable` it is the same paragraph with the PLAN SWITCH removed — the
/// sentences are the ones this screen has always shown and no route can refuse
/// a sentence, while `change_plan` is the one thing here that a route does
/// refuse. Dropping the answer entirely was rejected for the reason the shared
/// module gives: somebody cancelling over $79 would then be told nothing about
/// the $29 plan they can have.
///
/// ONLY `change_plan` IS WITHHELD. `open_help` is a screen in this app that no
/// state refuses, so a pause read that has not landed has nothing to say about
/// it, and deleting it would be this guard costing a reader the route to a human
/// over a fact that does not apply to it.
///
/// `unaskable` sits with the unread states rather than with `ready`, and that
/// costs its reader nothing: the whole cancel card is behind `billing.manage`
/// (see `BillingSectionView`), and so is the plan sheet this control opens, so a
/// reader who cannot ask about the pause was never going to press it.
///
/// The phase is always `.before`: this is the cancel card, where the
/// subscription is still live. The grace surface reads a company row whose
/// `paused_at` may have outlived its subscription, and `cancellationOffer`
/// ignores the flag there for exactly that reason.
func cancellationOffer(
    read: PauseRead,
    reason: String?,
    plan: String?,
    billingCurrency: String? = nil,
    country: String? = nil,
    registrationFeePaidAt: String? = nil
) -> CancellationOffer? {
    func answer(paused: Bool?) -> CancellationOffer? {
        cancellationOffer(
            reason: reason,
            plan: plan,
            phase: .before,
            billingCurrency: billingCurrency,
            country: country,
            registrationFeePaidAt: registrationFeePaidAt,
            paused: paused
        )
    }
    switch read {
    case .ready(let pause):
        return answer(paused: pauseIsActive(pause))
    case .loading, .failed, .unaskable:
        guard let offer = answer(paused: nil) else { return nil }
        // The type is written out rather than inferred: `offer.action` is an
        // optional, and the one comparison in this file that decides whether a
        // control survives should not rest on how a leading dot resolves.
        guard offer.action == CancellationOfferAction.changePlan else { return offer }
        return CancellationOffer(
            reason: offer.reason,
            heading: offer.heading,
            body: offer.body,
            action: nil,
            actionLabel: nil
        )
    }
}

// MARK: - Numbers the plan does not cover (#523)

/// What the billing screen may OFFER about a held number, once it knows enough
/// to say anything.
///
/// A separate type from the copy because the two answer different questions —
/// "what can be pressed" and "what does it say" — and only the first of them is
/// allowed to depend on facts this screen has not read yet.
enum HeldNumbersOffer: Equatable, Sendable {
    /// Buy the capacity for one held number, at this price, right now.
    case buy(price: String)
    /// The plan is paused. Nothing may be added to it until it resumes, and
    /// `POST …/reinstate` says exactly that back (`workspace_paused`).
    case resumeFirst
    /// The plan will not sell another number at ANY price — Starter's hard
    /// total cap (#80). Named rather than left as a missing button, because an
    /// owner who has already bought one extra and sees no way to buy a second
    /// otherwise concludes the button is broken.
    case planIsFull(maxTotal: Int)
    /// No purchase is offered here. Either the screen may not sell anything
    /// (the #163 store-rules kill-switch), or it has not read enough to know.
    ///
    /// NOT `none`: `HeldNumbersOffer?` and `.none` in one expression is a coin
    /// toss over which of the two a leading dot means.
    case noPurchase
}

/// Everything the held-numbers card says, in one value a test can read.
///
/// THE COPY LIVES HERE AND NOT IN THE VIEW, for the reason `enableUsTextingCopy`
/// gives: a sentence only a screenshot can check is a sentence nothing checks.
///
/// THE WORDS TRACK THE EMAIL. `heldNumbersCopy` in
/// apps/api/src/billing/number-allowance.ts writes the mail and the push about
/// this exact state, and the whole reason it is one function there is that the
/// same state must not be described three different ways by a Worker, a browser
/// and two phones. This is the iOS end of that agreement — the title IS the
/// mail's subject line, so somebody arriving from it lands on a card they
/// recognise.
struct HeldNumbersCopy: Equatable, Sendable {
    /// The card's title, and the subject of the mail that announced this.
    let title: String
    /// Why: the plan's allowance, from the server's figure.
    let lead: String
    /// What a hold is NOT. First, before anything that can be pressed.
    let kept: String
    /// The route back that is not a button on a row — nil when the row's own
    /// button is the whole answer.
    let routes: String?
    /// True when the only honest route left is a person. The card then draws
    /// the way to Help rather than ending on a sentence with nothing behind it.
    let offerHelp: Bool
}

/// The whole card, decided once: what it says and what it offers.
///
/// A NAMED TYPE AND NOT A TUPLE. It is compared whole in the tests, and an
/// `Optional<(A, B)>` is not `Equatable` however Equatable its members are — so
/// the tuple version pushed every assertion down to one field at a time, which
/// is the shape that lets a second field regress unnoticed.
struct HeldNumbersState: Equatable, Sendable {
    let copy: HeldNumbersCopy
    let offer: HeldNumbersOffer
}

/// The card, decided — or nil, meaning draw nothing at all.
///
/// # Why one function and not a chain of `if`s in the view
///
/// Three separate facts decide this — the server's answer, the pause read and
/// the store-rules kill-switch — and every one of them has a state that means
/// "not yet". A view that asks them one at a time inside `body` reaches a
/// different answer depending on which it asked first, and the failure mode is a
/// purchase offered against a plan nobody has read. That is the defect
/// `planCardShape` exists to prevent one card higher up this same screen.
///
/// # Nothing is drawn for a cancelled workspace
///
/// `subscription_inactive` is a different state with a different answer: those
/// numbers are suspended because the subscription is over and the 30-day hold is
/// running, and the surface for that is the win-back inside the Subscription
/// card above. Two cards about one suspended number giving different reasons is
/// the drift this route exists to stop, so the server names the reason and this
/// trusts it rather than re-deriving it from two fields.
func heldNumbersState(
    _ view: HeldNumbers,
    read: PauseRead,
    billingWritesEnabled: Bool,
    audience: BillingCurrency
) -> HeldNumbersState? {
    guard view.reason == HeldNumbersReason.overPlanAllowance,
          !view.held.isEmpty,
          // No allowance means the server could not read the plan. There is
          // nothing honest to say about a limit we cannot name, and inventing
          // one is worse than staying quiet.
          let allowance = view.allowance
    else { return nil }

    let offer = heldNumbersOffer(
        view,
        read: read,
        billingWritesEnabled: billingWritesEnabled,
        audience: audience
    )
    return HeldNumbersState(
        copy: heldNumbersCopy(
            allowance: allowance,
            heldCount: view.held.count,
            offer: offer,
            canUpgrade: view.can_upgrade
        ),
        offer: offer
    )
}

/// What may be pressed, in the order the reasons actually override each other.
func heldNumbersOffer(
    _ view: HeldNumbers,
    read: PauseRead,
    billingWritesEnabled: Bool,
    audience: BillingCurrency
) -> HeldNumbersOffer {
    // A pause outranks everything below it: it is the one state with its own
    // one-press way out, and that press is on the card directly above this one.
    if planCardShape(read) == .paused { return .resumeFirst }

    // The hard cap is a FACT about the plan rather than a state of this screen,
    // so it is named even where nothing could be sold anyway. `max_total` is
    // served precisely so that no client has to know Starter stops at two.
    if let maxTotal = view.max_total, let included = view.included,
       included + view.paid_extras >= maxTotal {
        return .planIsFull(maxTotal: maxTotal)
    }

    // #163: the store-rules kill-switch hides every in-app billing WRITE. A
    // button that adds a priced line to a subscription is exactly that, so it
    // goes; the reading half of this card is untouched.
    guard billingWritesEnabled else { return .noPurchase }

    // The pause read has not landed. `mayBuyAddOns` is false for loading, for
    // failed and for a reader who may not ask — the same gate the add-ons card
    // uses, and for the same reason: a purchase is never offered against a fact
    // nobody has read.
    guard mayBuyAddOns(read) else { return .noPurchase }

    // The server's own answer to "would the POST be accepted". Trusted rather
    // than re-derived: it knows about a scheduled plan change and about an
    // unprovisioned price, and this screen knows about neither.
    guard view.can_reinstate else { return .noPurchase }

    // A price we cannot label is a price we do not print. #522: a bare "$5" at
    // a workspace billed in CAD reads as CAD and bills US$5.
    guard let cents = view.extra_number_cents,
          let currency = view.extra_number_currency.flatMap(BillingCurrency.init(rawValue:))
    else { return .noPurchase }

    return .buy(price: formatMoneyIn(cents, currency, audience: audience) + "/mo")
}

/// The sentences, given what is on offer.
func heldNumbersCopy(
    allowance: Int,
    heldCount: Int,
    offer: HeldNumbersOffer,
    canUpgrade: Bool
) -> HeldNumbersCopy {
    let one = heldCount == 1
    let title = one
        ? "One of your numbers is on hold"
        : "\(heldCount) of your numbers are on hold"
    let lead = "Your plan covers \(allowance) number\(allowance == 1 ? "" : "s"), "
        + "and you have more than that."
    // The mail's own sentence, in the same order. It leads with what a hold is
    // NOT, because the reader's first question is whether they have lost the
    // number on the side of their van, and the answer is no.
    let kept = "A number on hold hasn't been given up. We're still holding it, "
        + "texts and calls still reach it, and nothing in its history has been "
        + "touched — you just can't send or answer from it while it's on hold."

    let them = one ? "it" : "them"
    switch offer {
    case .buy:
        return HeldNumbersCopy(
            title: title,
            lead: lead,
            kept: kept,
            // Only the OTHER route. The paid one is a button on the row an inch
            // below with its own price on it, and restating it here would give
            // one figure two homes on one card.
            routes: canUpgrade
                ? "Or move to Pro from the plan card above: that brings back "
                    + "everything that fits, with no extra number to buy."
                : nil,
            offerHelp: false
        )
    case .resumeFirst:
        return HeldNumbersCopy(
            title: title,
            lead: lead,
            kept: kept,
            // The API's 409 names the two steps in this order — resume first,
            // then bring it back — and a client that put them the other way
            // round would be walking somebody into that refusal.
            routes: "Your plan is paused, so nothing can be added to it yet. "
                + "Resume it from the plan card above, then you can bring \(them) back.",
            offerHelp: false
        )
    case .planIsFull(let maxTotal):
        return HeldNumbersCopy(
            title: title,
            lead: lead,
            kept: kept,
            routes: "Starter tops out at \(maxTotal) numbers, so there's no extra "
                + "to buy here. Move to Pro from the plan card above and everything "
                + "that fits comes back.",
            offerHelp: false
        )
    case .noPurchase:
        return HeldNumbersCopy(
            title: title,
            lead: lead,
            kept: kept,
            routes: canUpgrade
                ? "Move to Pro from the plan card above and everything that fits "
                    + "comes back."
                : "Get in touch and we'll bring \(them) back.",
            // Pro, with nothing to sell and nothing to upgrade to. A person is
            // the only honest route left.
            offerHelp: !canUpgrade
        )
    }
}

/// What a plan change is told to have done.
///
/// #523 GAVE THE UPGRADE A SECOND EFFECT. Moving to Pro raises the allowance and
/// the API claims against the new one in the same call, so the switch can bring
/// held numbers back — and until it says so, the owner presses "Upgrade to Pro"
/// to fix a held number and is told only that they are on Pro. They then have to
/// go and check whether the thing they upgraded FOR actually happened.
///
/// The reinstated list comes off the response rather than being guessed from the
/// plan: an ordinary upgrade reinstates nothing and must not claim otherwise.
func changePlanMessage(_ result: ChangePlanResult) -> String {
    guard result.effective == "now" else {
        return "Switch to Starter scheduled for the end of this period."
    }
    let back = result.reinstated.count
    if back == 0 { return "You're on Pro now." }
    // One number gets named. A suspended row has always been active so it has a
    // number, but the nil branch is here rather than force-unwrapped: a toast
    // reading "and () is back" would be worse than the count.
    if back == 1, let e164 = result.reinstated[0].number_e164, !e164.isEmpty {
        return "You're on Pro now, and \(formatPhone(e164)) is back."
    }
    return "You're on Pro now, and \(back) number\(back == 1 ? " is" : "s are") back."
}

/// The sheet that takes consent for the charge.
struct ReinstateNumberCopy: Equatable, Sendable {
    let title: String
    let message: String
    let confirmLabel: String
}

/// Buying one number back, in the voice the add-on toggle already uses for the
/// same shape of charge: a priced line added to the subscription, prorated and
/// invoiced today.
///
/// IT NAMES BOTH HALVES OF THE MONEY. `POST …/reinstate` sends
/// `proration: always_invoice`, so the customer pays now for the rest of this
/// period and then the full price monthly. A sheet that said only "a month"
/// would be taking consent for a charge whose timing it never mentioned.
func reinstateNumberCopy(number: String, price: String) -> ReinstateNumberCopy {
    ReinstateNumberCopy(
        title: "Bring back \(number)?",
        message: "\(price) is added to your plan. You're charged a prorated amount "
            + "for the rest of this period today, then the full price each month. "
            + "The number can send and answer again as soon as it goes through.",
        confirmLabel: "Bring it back"
    )
}

/// What to say after pressing "Bring it back", for each of the three things
/// that can actually have happened.
///
/// THE THIRD ONE IS THE POINT. `reinstated == false` with `already_active ==
/// false` means the Stripe write landed and the un-hold did not — the #110
/// raise fence refused a capacity raise formed against an epoch that moved
/// underneath it. The money HAS moved, so the one thing this must never do is
/// invite an immediate retry: pressing again reads a fresh billed quantity and
/// buys a SECOND unit of capacity for a number the customer has already paid
/// for. It sends them to a person instead, and says the charge went through so
/// nobody has to wonder.
///
/// `already_active` is not a failure and gets no apology. It is a double-press,
/// or an upgrade that reinstated the number between this screen loading and the
/// button being pressed, and nothing was bought either way.
func reinstateOutcomeMessage(_ result: ReinstatedNumber, number: String) -> String {
    if result.already_active { return "\(number) was already back." }
    if result.reinstated {
        return "\(number) is back. You can send and answer from it again."
    }
    return "Your plan covers \(number) now, and the charge went through — but it "
        + "hasn't come back yet. Get in touch and we'll finish it; you won't be "
        + "charged again."
}

/// What the NUMBERS screen says about a suspended row.
///
/// # It used to name a cause it could not know
///
/// The line was "This number is suspended. Update your payment method under
/// Settings › Billing to bring it back." That is one of TWO reasons a number is
/// suspended, and since #523 it is the less likely one: a resubscribe onto a
/// smaller plan holds the surplus, and the workspace reading this is paid up.
/// Sending them to fix a payment method that is working is a dead end they only
/// discover after going to look.
///
/// # And it does not guess the other one either
///
/// The reason is decided by `GET /v1/billing/held-numbers`, which sits behind
/// `billing.manage` — so a tech reading this card cannot be told which of the
/// two it is, and deriving it here from `subscription_status` would put a second
/// opinion about one state into the product. This says what is true in BOTH
/// cases and points at the one screen that says which.
func suspendedNumberLine(canManageBilling: Bool) -> String {
    "This number is on hold. " + heldNumberTail(canManageBilling: canManageBilling)
}

/// What is true of EVERY hold, and where the reader goes next.
///
/// Extracted because Settings › Numbers draws one held line on TWO cards. A
/// transferred-in number gets a `NumberCard` (since #523 admitted `suspended`
/// to the filter) AND a completed transfer tracker directly below it, and both
/// have to describe the same line. Two hand-kept copies of a sentence whose
/// whole job is to be exactly true drift, and the one that drifts is always the
/// one on the surface nobody tests — which is precisely how the tracker went on
/// saying "Ported" over a line that cannot send.
///
/// Neither caller names a CAUSE. `GET /v1/billing/held-numbers` decides that and
/// sits behind `billing.manage`, so a tech reading either card cannot be told
/// which of the two reasons applies, and re-deriving it from
/// `subscription_status` would put a second opinion about one state into the
/// product. Both sentences are true of an allowance hold and of a past-due one.
func heldNumberTail(canManageBilling: Bool) -> String {
    "Texts and calls still reach it, but you can't send or answer from it. "
        + (canManageBilling
            ? "Settings › Billing says why, and how to bring it back."
            : "Your account owner can bring it back from Billing.")
}

/// #523 — has this COMPLETED transfer delivered a line that is now on hold?
///
/// # The contradiction this closes
///
/// #523 admitted `suspended` rows to the number-card filter, so a held ported
/// line finally gets a card saying it is on hold. The transfer tracker beside it
/// was left alone, and a completed one draws "Ported" in the POSITIVE tone over
/// a fully filled olive stepper. One screen then said both "this line is on hold
/// and cannot send" and "Ported, all done" — two stories about one line, which
/// is worse than the single wrong story it replaced. The oldest-first restore
/// makes it the likely pairing rather than an exotic one: the number a workspace
/// ported in most recently is exactly the one left held.
///
/// # Why it is gated on the transfer being FINISHED
///
/// The pill it overrides is the completed one, and only that one. A transfer
/// still with the carriers has its own true story — where the order has got to —
/// and replacing that with "On hold" would be a fresh wrong story rather than a
/// fix. The gate also keeps one real collision out: a landline that was
/// text-enabled first (a `hosted` row, live, with this E.164 on it) and is being
/// ported for voice afterwards would otherwise let a hold on the hosted row
/// silence the in-flight tracker.
///
/// # Why it matches on the E.164
///
/// It is the one identifier the two rows are guaranteed to agree on after
/// cutover; `phone_numbers.porting_status` is never sent to a client. A row that
/// is `suspended` is by definition not `released`, so a number somebody gave up
/// cannot resolve here and put a hold note on a line nobody holds.
func portedLineIsOnHold(_ port: PortRequest, in numbers: [PhoneNumberSummary]) -> Bool {
    guard port.status == PortStatus.ported else { return false }
    return numbers.contains { number in
        number.number_e164 == port.phone_e164 && number.status == NumberStatus.suspended
    }
}

/// What the TRANSFER tracker says once the line it delivered is on hold.
///
/// It leads by naming which of the two things is held, because the card is
/// titled "Transfer: …" and the pill above now reads "On hold" — the same three
/// words the number card uses, so one line has one status word on this screen.
/// Without this sentence those words could be read as the transfer itself
/// stalling, which is a third wrong story and the one this card is least
/// entitled to tell: the stepper below it is fully filled and correct, because
/// the transfer genuinely did complete.
///
/// The rest is `heldNumberTail`, byte-identical to the number card's, so the two
/// cards about one line cannot disagree about what a hold is.
func portedLineOnHoldLine(canManageBilling: Bool) -> String {
    "The transfer finished — it's the line that's on hold. "
        + heldNumberTail(canManageBilling: canManageBilling)
}

/// #523 — may this number be given up right now? ONE RULE, THREE CLIENTS.
///
/// This control answered differently depending on which device was in the
/// owner's hand: web drew it for any row that was not released (a past-due
/// suspension included), iOS for active-or-suspended with no subscription check,
/// and Android for suspended only while the subscription was live. An
/// irreversible control that behaves three ways is three products. Android's is
/// the rule all three now share, and its argument is written out below.
///
/// ACTIVE, OR ON HOLD WHILE THE SUBSCRIPTION IS LIVE. The second half is the
/// #523 fix: gated on `active` alone, a held number could not be released from a
/// phone at all — and releasing it is the only way to stop us renting it from
/// the carrier for a workspace that has decided against it, the only way to free
/// the Starter slot, and the only way to clear the Pro-to-Starter downgrade
/// checklist, which counts every row that is not released. A mobile-only owner
/// had a line they could neither use nor end. `DELETE /v1/numbers/:id` has always
/// allowed it; it refuses only a row that is already released.
///
/// AND NOT WHILE THE PAYMENT IS THE PROBLEM. `subscriptionActive` is the same
/// field the server splits `over_plan_allowance` from `subscription_inactive` on,
/// so this admits exactly the #523 hold. A past-due workspace has every number
/// suspended at once, the real problem is the card, and offering "give it up for
/// good" to somebody in that state is a press made in a panic that nothing can
/// undo. `suspendedNumberLine` already tells them where the answer is.
///
/// A NUMBER WITH NO DIGITS IS NOT RELEASABLE either, and that is not cosmetic:
/// the sheet asks the reader to type the number back, which nobody can do for a
/// row that has not got one.
func mayReleaseNumber(
    status: String,
    numberE164: String?,
    subscriptionActive: Bool
) -> Bool {
    guard numberE164 != nil else { return false }
    switch status {
    case NumberStatus.active: return true
    case NumberStatus.suspended: return subscriptionActive
    default: return false
    }
}

/// What giving this number up MEANS — which is two different things.
///
/// # The held row is not the ordinary one
///
/// The ordinary sentence ends "It doesn't change your plan or what you pay — a
/// number is included, so you can set up a new one here afterward", and for a
/// line on hold the second half of that is false. A workspace is holding a
/// number precisely because the one its plan includes is already in use: release
/// the held row and the replacement it just promised is a paid extra. It is also
/// answering the wrong question. Somebody releasing a held number is not
/// swapping a working line for another one — they are choosing between the two
/// ways a hold can end, and the one this sheet performs is the permanent one.
///
/// # What the held sentence says instead
///
/// That the hold is not the loss — texts and calls still arrive today, and this
/// is what ends that — and that the other way out closes with it.
///
/// # It is `heldOverAllowance`, not `onHold`
///
/// The parameter used to be `status == suspended`, which cannot tell an
/// allowance hold from a past-due suspension — and the held sentence is written
/// for exactly one of those. "Bringing it back from Settings › Billing stops
/// being an option" describes a choice between two ways to end an allowance
/// hold; said to somebody whose card was declined it frames a billing failure as
/// a decision they are making, and the route it says is closing is one they
/// never had. Two things now keep them apart: `mayReleaseNumber` refuses to draw
/// the control at all while the subscription is down, so that reader cannot
/// reach this sheet, and the parameter names the state rather than the status,
/// so a future caller has to think about which one it means.
///
/// It still names no CAUSE beyond that. Whether an allowance hold came from a
/// win-back onto a smaller plan or from a plan change is decided by
/// `GET /v1/billing/held-numbers`, which this screen may not read.
///
/// # No figure appears in either branch
///
/// The price of the alternative belongs to the served answer on the billing
/// screen (`HeldNumbersCard`). A number typed here would be a second price book,
/// on a screen taking consent for something irreversible.
func releaseNumberMessage(heldOverAllowance: Bool) -> String {
    if heldOverAllowance {
        return "This gives the number up for good. It's on hold, not gone — texts "
            + "and calls still reach it, and releasing ends that too. You can't get "
            + "the same number back, and bringing it back from Settings › Billing "
            + "stops being an option. Type the number to confirm."
    }
    return "This gives the number up for good. Customers who text it won't reach "
        + "you, and you can't get the same number back. It doesn't change your plan "
        + "or what you pay — a number is included, so you can set up a new one here "
        + "afterward. Type the number to confirm."
}

// MARK: - #583 / D131 — the two sentences that promise a customer their money back

/// Hand-port of `prepaidConversionCopy` in
/// packages/shared/src/prepaid-conversion-copy.ts, held to it by `ParityVectorsTests`.
///
/// A plan change inside a prepaid window ends the year and credits the unconsumed
/// value back, and three clients ask for that consent. What they say is not
/// decoration — it is the promise — so it is composed once in the shared package and
/// the ports are checked against generated cases.
///
/// IT SAYS CREDIT AND AN AMOUNT, NEVER MONTHS OF FREE SERVICE. Stripe spends a credit
/// balance on the whole invoice, so a heavy month can consume it and leave the plan
/// fee on the card anyway; "two months of Pro free" is a promise the mechanism cannot
/// keep, and it is the same promise D107 rejected customer credit for making at the
/// other end of this feature.
struct PrepaidConversionCopy: Equatable, Sendable {
    let heading: String
    let explanation: String
    let acknowledgement: String
}

private func prepaidPlanLabel(_ plan: String) -> String {
    plan == "pro" ? "Pro" : "Starter"
}

/// - Parameter credit: already formatted for this reader by `formatMoneyIn`, or nil
///   when the server sent no figure. Nil promises no number, which is the only
///   honest thing to say without one.
func prepaidConversionCopy(
    from fromPlan: String,
    to toPlan: String,
    credit: String?
) -> PrepaidConversionCopy {
    let heading = "You have a prepaid \(prepaidPlanLabel(fromPlan)) year running."
    let target = prepaidPlanLabel(toPlan)
    guard let credit else {
        return PrepaidConversionCopy(
            heading: heading,
            explanation: "Switching ends the prepaid year. You then pay the normal "
                + "\(target) monthly price.",
            acknowledgement: "End my prepaid year"
        )
    }
    return PrepaidConversionCopy(
        heading: heading,
        explanation: "Switching ends the prepaid year and puts \(credit) back on your "
            + "account as credit, which comes off your next invoices. You then pay the "
            + "normal \(target) monthly price.",
        acknowledgement: "End my prepaid year and credit me \(credit)"
    )
}
