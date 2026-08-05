import SwiftUI
// #277: the export offer on the cancel screen hands a real file to the real
// system share sheet, which is UIKit's.
import UIKit

private let fairUseUrl = "https://loonext.com/legal/fair-use"

/// #490: "today" / "yesterday" / "on 12 July".
///
/// A relative day rather than a timestamp: the reader's question is "is this
/// still happening?", and "yesterday" answers it where an ISO string makes them
/// work it out. Past a couple of days the date is the more useful answer,
/// because by then the question has become "how long has this been going on".
private func relativeDay(_ iso: String?) -> String? {
    guard let iso, let when = parseWireTimestamp(iso) else { return nil }
    let cal = Calendar.current
    if cal.isDateInToday(when) { return "today" }
    if cal.isDateInYesterday(when) { return "yesterday" }
    let fmt = DateFormatter()
    fmt.locale = Locale(identifier: "en_US_POSIX")
    fmt.dateFormat = "d MMMM"
    return "on " + fmt.string(from: when)
}

private func fullDate(_ iso: String?) -> String? {
    guard let iso, let date = parseWireTimestamp(iso) else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "MMMM d, yyyy"
    return formatter.string(from: date)
}

/// The day this workspace's number goes back to the carrier — "August 14,
/// 2026" — or nil when nothing has been cancelled.
///
/// ONE FUNCTION, because three surfaces on this screen name this same date: the
/// off-ramp card, the canceled-state Subscription card, and the win-back note
/// inside it. Three of them disagreeing about when somebody loses their
/// business number is worse than none of them saying it.
///
/// WITH THE YEAR, and in the same shape the mail uses. The day-27 grace email
/// prints "August 4, 2026" through `releaseDateLabel` in grace.ts and sends the
/// reader to this screen, which printed "4 August" — the same deadline in two
/// formats, one of them undated. The branch that suffers is the expired one
/// ("the hold ended on 3 September"), which is read by definition after the
/// deadline and can be read a year later by somebody signing back in to find
/// out what happened.
///
/// UTC, because that is the clock `runGraceJob` runs on and the zone
/// `releaseDateLabel` prints in. Rendering it in the reader's zone would show a
/// date a day either side of the one the job acts on — which is why this stays
/// separate from `fullDate` above despite the identical format string: that one
/// prints a billing period end, which is a moment in the reader's own life.
private func numberReleaseDay(_ canceledAt: String?) -> String? {
    guard let release = numberReleaseAt(canceledAt) else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "MMMM d, yyyy"
    return formatter.string(from: release)
}

/// Billing (#163): plan card (calling is INCLUDED on every plan — never an
/// add-on), honest status banners, in-app plan change, the add-on modules
/// card, and hosted Stripe surfaces which ALWAYS open in the external browser
/// (App Store rules — never a webview, never Apple IAP language).
///
/// `billing_writes_enabled` (#163) is the server's store-rules kill-switch:
/// when false, every in-app billing WRITE (plan change, module toggles) is
/// hidden and the card points at the external-browser Stripe portal instead —
/// reads and the always-external portal/checkout links are untouched.
@MainActor
struct BillingSectionView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onRefreshCompany: @MainActor () -> Void

    private var canManage: Bool { SettingsRoleGate.canManageBilling(scope.role) }

    var body: some View {
        StatusNotices(scope: scope, company: company, canManage: canManage)
        // #490: directly under the notice that says the line is off, because it
        // is the consequence of that sentence rather than a separate topic.
        MissedWhileOffNote(scope: scope, company: company)
        // #481: only for a workspace on its way out. Directly under the count
        // of customers who rang into nothing, because this is what to DO.
        OffRampCard(scope: scope, company: company)
        PlanCard(scope: scope, company: company, canManage: canManage, onRefreshCompany: onRefreshCompany)
        if canManage && company.billing_writes_enabled
            && company.plan != nil && company.subscriptionActive {
            ModulesCard(scope: scope)
        }
        if canManage {
            SettingsCard(
                title: "Payment & invoices",
                description: "Cards, receipts, and billing details live in the secure "
                    + "Stripe portal. It opens in your browser."
            ) {
                PortalButton(scope: scope, label: "Manage payment & invoices")
            }
            if company.subscriptionActive {
                CancelCard(scope: scope, company: company, onRefreshCompany: onRefreshCompany)
            }
        } else {
            SettingsCard(title: "Billing") {
                ReadOnlyLine("Only owners and admins can change billing.")
            }
        }
    }
}

// MARK: - Portal button

/// Open the hosted Stripe Billing Portal in the EXTERNAL browser.
private struct PortalButton: View {
    let scope: SettingsScope
    let label: String
    var solid: Bool = false

    @State private var opening = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if solid {
                Button(opening ? "Opening…" : label) { open() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(opening)
            } else {
                Button(opening ? "Opening…" : label) { open() }
                    .buttonStyle(.bordered)
                    .disabled(opening)
            }
            InlineError(error)
        }
    }

    private func open() {
        opening = true
        error = nil
        Task {
            do {
                let hosted = try await scope.repo.billingPortal(scope.companyId)
                openExternal(hosted.url)
            } catch {
                self.error = error.userMessage
            }
            opening = false
        }
    }
}

// MARK: - Status notices

private struct StatusNotices: View {
    let scope: SettingsScope
    let company: CompanyView
    let canManage: Bool

    private var notice: (String, String)? {
        if company.subscription_status == SubscriptionStatus.pastDue {
            return (
                "Your last payment didn't go through. Update your payment method to keep "
                    + "sending messages.",
                "Update payment method"
            )
        }
        if company.subscription_status == SubscriptionStatus.unpaid {
            return ("Sending is paused until your payment method is updated.", "Update payment method")
        }
        if company.subscriptionActive && company.cancel_at_period_end {
            let date = fullDate(company.current_period_end)
            // The hold is counted from the day cancelling was REQUESTED, not
            // from the day texting stops — `canceled_at` comes off Stripe's own
            // `subscription.canceled_at`. This notice used to read "texting
            // stops then; we hold your number for 30 days", which invites the
            // reader to count from the period end and can overstate the real
            // deadline by most of a month. The exact date cannot be shown here
            // (nothing has stamped `canceled_at` yet), so the anchor is named.
            return (
                "Your plan is set to cancel"
                    + (date.map { " on \($0)" } ?? " at the end of this period")
                    + ". Texting stops then. Your number is held for "
                    + "\(cancellationGraceDays) days from the day you cancelled — not "
                    + "from that date — so it can be released soon afterwards. You can "
                    + "undo this from the payment portal.",
                "Keep my plan"
            )
        }
        return nil
    }

    var body: some View {
        if let notice {
            VStack(alignment: .leading, spacing: 8) {
                Text(notice.0)
                    .font(.callout)
                    .foregroundStyle(BrandColor.ink)
                if canManage {
                    PortalButton(scope: scope, label: notice.1, solid: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(BrandColor.amberBg, in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
        }
    }
}

// MARK: - Plan card

private struct PlanCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let canManage: Bool
    let onRefreshCompany: @MainActor () -> Void

    @State private var opening = false
    @State private var error: String?
    @State private var changingPlan = false

    var body: some View {
        if company.subscription_status == SubscriptionStatus.canceled {
            SettingsCard(title: "Subscription") {
                Text("Your subscription is canceled.")
                    .font(.callout)
                // #277 follow-up: the answer to what they told us on the way
                // out, said once more while the number can still be saved.
                // ABOVE the hold sentence on purpose — the shared seasonal copy
                // points at "the date below", and that date is the next thing
                // in this card. Draws nothing for the four reasons we have
                // nothing honest to add to, once it has been waved away, and
                // once the hold has expired.
                if canManage {
                    WinbackNote(scope: scope, company: company)
                }
                Text(holdSentence)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
                InlineError(error)
                if canManage {
                    // Unchanged, and still the loud one: "come back on exactly
                    // what you had". The win-back's own control is quieter,
                    // because steering somebody who has already left toward the
                    // cheaper plan is a decision that should be theirs.
                    Button(opening ? "Opening…" : "Resubscribe") {
                        resubscribe(plan: company.plan ?? "starter")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(opening)
                    .padding(.top, 10)
                }
            }
        } else if let facts = planFacts(company.plan, company.billedIn) {
            SettingsCard(title: "Plan") {
                HStack(spacing: 10) {
                    // #328: priced in what this workspace's card is actually
                    // charged, not a hardcoded dollar sign. A Canadian owner
                    // read "Pro · $79/mo" here and "Starter is $39 a month
                    // instead of $109" in the cancel answer an inch below —
                    // two prices for the same plan, on one screen, one of them
                    // provably wrong, at the moment they are deciding whether
                    // to leave.
                    Text("\(facts.name) · \(facts.price)")
                        .font(.title3.weight(.semibold))
                    if company.subscriptionActive && !company.cancel_at_period_end {
                        StatusPill(label: "Active", tone: .positive)
                    }
                }
                Spacer().frame(height: 8)
                ForEach([
                    "Texting for your crew, bound by fair use",
                    "Calling included on every plan — it's never an add-on",
                    "Extra texts bill under fair use, up to a cap you control",
                    "\(facts.seats) team members",
                    "\(facts.numbers) phone number" + (facts.numbers == 1 ? "" : "s"),
                ], id: \.self) { line in
                    Text("· \(line)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 1)
                }
                Spacer().frame(height: 6)
                Button("Allowances reflect fair use. See the policy") {
                    openExternal(fairUseUrl)
                }
                .font(.subheadline)
                .buttonStyle(.borderless)
                if let date = fullDate(company.current_period_end) {
                    Text("Current period ends \(date).")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if canManage && company.subscriptionActive {
                    if company.billing_writes_enabled {
                        Button(company.plan == "pro" ? "Switch to Starter" : "Upgrade to Pro") {
                            changingPlan = true
                        }
                        .buttonStyle(.bordered)
                        .padding(.top, 10)
                    } else {
                        // #163 kill-switch: the in-app plan change is hidden;
                        // plan management rides the existing external-browser
                        // Stripe portal path (store-rules posture).
                        Spacer().frame(height: 10)
                        PortalButton(scope: scope, label: "Manage your plan in the browser")
                    }
                }
            }
            .sheet(isPresented: $changingPlan) {
                ChangePlanSheet(scope: scope, company: company) {
                    changingPlan = false
                    onRefreshCompany()
                } onDismiss: {
                    changingPlan = false
                }
            }
        } else {
            SettingsCard(title: "Plan") {
                Text("No plan yet. Finish setup on the web to pick one and get your number.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// What is true about the number on a workspace that has already left.
    ///
    /// Three states, because the hold really does have three and the sentence
    /// this replaced ("30 days after your last period") described none of them:
    ///
    ///   inside the hold   the date it goes, which is the only actionable fact.
    ///   past the hold     the hold ENDED. Deliberately not "your number has
    ///                     been released": the release job runs daily, so
    ///                     between the deadline and the next run the number may
    ///                     still be ours, and the honest claim at that boundary
    ///                     is about the hold rather than about the carrier.
    ///   no `canceled_at`  the general rule, with no date invented for it.
    ///
    /// THE EXPIRED BRANCH MAY NOT SPEAK IN THE PAST TENSE EITHER. It used to
    /// end "resubscribing now sets you up with a new number", which is the same
    /// claim in different words: this sentence flips on the DEVICE clock at
    /// `canceled_at + 30d`, while the release runs on a once-daily cron
    /// (`0 14 * * *`) that can also fail and retry. For up to a day the number
    /// is still suspended-not-released, and `runGraceJob` only ever looks at
    /// companies whose `subscription_status` is still `canceled` — so somebody
    /// who came back inside that window would keep the number we had just told
    /// them was gone. What is certain at that boundary is that we can no longer
    /// PROMISE it, and that is what it says. It does not promise the reverse
    /// either: inviting somebody to race a cron is not an offer.
    private var holdSentence: String {
        guard let day = numberReleaseDay(company.canceled_at) else {
            return "We hold your number for \(cancellationGraceDays) days from the day "
                + "you cancel. Resubscribe before then and everything picks up where it "
                + "left off."
        }
        if !isWithinCancellationGrace(company.canceled_at) {
            return "The \(cancellationGraceDays)-day hold on your number ended on \(day). "
                + "We can't promise it any more — once it goes back to the phone company, "
                + "resubscribing sets you up with a new number. Your message history is "
                + "still here either way."
        }
        return "We hold your number until \(day). Resubscribe before then and everything "
            + "picks up where it left off."
    }

    private func resubscribe(plan: String) {
        opening = true
        error = nil
        Task {
            do {
                let hosted = try await scope.repo.checkout(scope.companyId, plan: plan)
                openExternal(hosted.url)
            } catch {
                self.error = error.userMessage
            }
            opening = false
        }
    }
}

// MARK: - Change plan

private struct ChangePlanSheet: View {
    let scope: SettingsScope
    let company: CompanyView
    let onChanged: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    @State private var pending = false
    @State private var error: String?
    // Downgrade requirements from LIVE counts: numbers from the company view,
    // active members fetched fresh.
    @State private var activeMembers: Int?
    @State private var membersFailed = false

    private var upgrading: Bool { company.plan != "pro" }
    private var targetPlan: String { upgrading ? "pro" : "starter" }

    private var activeNumbers: Int {
        company.numbers.filter { $0.status != NumberStatus.released }.count
    }

    private var numbersOk: Bool { activeNumbers <= 1 }
    // #392: the Starter allowance, not a literal. A downgrade gate that
    // disagrees with the API blocks a plan change the server would allow.
    private var seatsOk: Bool { (activeMembers ?? Int.max) <= starterSeats }
    private var downgradeBlocked: Bool { !upgrading && (!numbersOk || !seatsOk || membersFailed) }

    var body: some View {
        ConfirmSheet(
            title: upgrading ? "Upgrade to Pro?" : "Switch to Starter?",
            message: upgrading
                ? "The upgrade happens right away. You're charged the prorated difference "
                    + "for the rest of this period, and your allowances go up immediately."
                : "Starter is smaller, so your workspace has to fit it first.",
            confirmLabel: upgrading ? "Upgrade now" : "Schedule the switch",
            pending: pending,
            error: error,
            confirmEnabled: !downgradeBlocked,
            onConfirm: { change() },
            onDismiss: { onDismiss() }
        ) {
            if !upgrading {
                VStack(alignment: .leading, spacing: 6) {
                    Spacer().frame(height: 10)
                    Text(
                        (numbersOk ? "✓" : "✗")
                            + (numbersOk
                                ? " 1 phone number. You're set."
                                : " Starter includes 1 phone number; you have \(activeNumbers). "
                                    + "Release under Settings › Numbers first.")
                    )
                    .font(.footnote)
                    Text(checklistMembersLine)
                        .font(.footnote)
                    Spacer().frame(height: 8)
                    Text(
                        "The change happens at the end of your current period. You keep Pro "
                            + "until then, and nothing is refunded mid-period."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
                .task {
                    do {
                        activeMembers = try await scope.repo.members(scope.companyId)
                            .data.filter { $0.deactivated_at == nil }.count
                    } catch {
                        membersFailed = true
                    }
                }
            }
        }
    }

    private var checklistMembersLine: String {
        if membersFailed { return "✗ Couldn't check your member count. Try again." }
        guard let activeMembers else { return "Checking your member count…" }
        if activeMembers <= 3 { return "✓ Up to 3 members; you have \(activeMembers)." }
        return "✗ Starter includes 3 members; you have \(activeMembers) active. "
            + "Deactivate \(activeMembers - 3) under Settings › Team first."
    }

    private func change() {
        pending = true
        error = nil
        Task {
            do {
                let result = try await scope.repo.changePlan(scope.companyId, plan: targetPlan)
                scope.showMessage(
                    result.effective == "now"
                        ? "You're on Pro now."
                        : "Switch to Starter scheduled for the end of this period."
                )
                onChanged()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}

// MARK: - Modules

private struct ModulesCard: View {
    let scope: SettingsScope

    @State private var state: LoadState<[BillingModule]> = .loading
    @State private var refreshKey = 0
    @State private var confirming: BillingModule?
    @State private var pending = false
    @State private var dialogError: String?

    var body: some View {
        Group {
            switch state {
            // Loading quietly and hiding an empty catalog are both correct: the
            // card only exists when there is something sellable (web parity).
            case .loading, .failed:
                EmptyView()
            case .ready(let modules):
                if !modules.isEmpty {
                    SettingsCard(
                        title: "Add-ons",
                        description: "Optional extras billed with your plan."
                    ) {
                        ForEach(modules, id: \.id) { module in
                            LabeledToggleRow(
                                label: "\(module.label) · \(formatMonthlyCents(module.monthly_cents))/mo",
                                supporting: module.blurb,
                                isOn: module.enabled,
                                enabled: module.available || module.enabled
                            ) { _ in
                                dialogError = nil
                                confirming = module
                            }
                        }
                    }
                }
            }
        }
        .task(id: "\(scope.companyId)|\(refreshKey)") {
            do {
                state = .ready(
                    try await scope.repo.modules(scope.companyId)
                        .modules.filter { $0.available || $0.enabled }
                )
            } catch {
                state = .failed(error.userMessage)
            }
        }
        .sheet(isPresented: Binding(
            get: { confirming != nil },
            set: { open in
                if !open { confirming = nil }
            }
        )) {
            if let module = confirming {
                let enabling = !module.enabled
                ConfirmSheet(
                    title: enabling ? "Add \(module.label)?" : "Remove \(module.label)?",
                    message: enabling
                        ? "\(formatMonthlyCents(module.monthly_cents))/mo is added to your plan. "
                            + "You're charged a prorated amount for the rest of this period today, "
                            + "then the full price each month."
                        : "\(module.label) comes off your plan now, with a prorated credit for "
                            + "the unused part of this period on your next invoice.",
                    confirmLabel: enabling ? "Add it" : "Remove it",
                    pending: pending,
                    error: dialogError,
                    onConfirm: { toggle(module, enabling: enabling) },
                    onDismiss: { confirming = nil }
                )
            }
        }
    }

    private func toggle(_ module: BillingModule, enabling: Bool) {
        pending = true
        dialogError = nil
        Task {
            do {
                try await scope.repo.setModule(scope.companyId, module: module.id, enabled: enabling)
                confirming = nil
                scope.showMessage(enabling ? "\(module.label) added." : "\(module.label) removed.")
                refreshKey += 1
            } catch {
                dialogError = error.userMessage
            }
            pending = false
        }
    }
}

/// #490 — how many customers rang while the line could not take them.
///
/// Shown only on a workspace whose subscription is not active, and only when
/// the number is greater than zero. It is the argument for coming back with
/// evidence attached: before this the business was never told those calls had
/// happened at all.
///
/// WHAT THIS IS NOT: a scare banner. It does not use the word "lost". The
/// reader has almost certainly stopped paying because money is tight, and a
/// product that shouts about what their lapse cost them is kicking somebody
/// already down. The bare number is more persuasive than any sentence we could
/// write about it.
///
/// Zero renders NOTHING — an empty state here would be an argument AGAINST
/// reinstating. A failed read renders nothing too: this is a supporting fact on
/// somebody else's screen, and a billing page showing a broken box looks like
/// the billing itself is broken.
@MainActor
private struct MissedWhileOffNote: View {
    let scope: SettingsScope
    let company: CompanyView

    @State private var missed: MissedWhileOff?

    private var show: Bool { !company.subscriptionActive }

    var body: some View {
        Group {
            if let missed, missed.total > 0 {
                VStack(alignment: .leading, spacing: 3) {
                    Text(
                        missed.total == 1
                            ? "1 customer called while your number was off"
                            : "\(missed.total) customers called while your number was off"
                    )
                    .font(.golos(13, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    Text(
                        "They heard that the number isn't taking calls."
                            + (relativeDay(missed.last_at).map { " The most recent was \($0)." } ?? "")
                    )
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted600)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(
                    BrandColor.inset,
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
            }
        }
        .task(id: show) {
            guard show else { return }
            missed = try? await scope.repo.missedWhileOff(scope.companyId)
        }
    }
}

/// #481 — what a departing crew's customers are told, while we still hold the
/// number.
///
/// THE DEADLINE IS THE FEATURE. After release the number belongs to somebody
/// else and nothing can answer from it, so this is not forwarding — it is
/// "tell the people who text you, while we still can". The copy leads with when
/// it stops, because an owner who believes this outlives their account has been
/// misled at the worst possible moment.
///
/// THE WORDS ARE THEIRS: an empty box with an example placeholder, never a
/// draft. Writing the message IS the opt-in, so there is no separate switch to
/// leave somebody unsure whether they set this up.
///
/// NO PERSUASION. A business is winding down, and how we behave on the way out
/// is the referral channel (#399).
@MainActor
private struct OffRampCard: View {
    let scope: SettingsScope
    let company: CompanyView

    private static let maxCharacters = 320

    @State private var draft = ""
    @State private var busy = false

    private var saved: String? { company.offramp_message }
    private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Group {
            if company.subscription_status == SubscriptionStatus.canceled,
               SettingsRoleGate.canManageBilling(scope.role) {
                SettingsCard(title: "Tell your customers where you went") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(blurb)
                            .font(.golos(12.5))
                            .foregroundStyle(BrandColor.muted600)
                            .fixedSize(horizontal: false, vertical: true)

                        TextField(
                            "We've moved to (416) 555-0123 — call or text us there and we'll pick right up.",
                            text: $draft,
                            axis: .vertical
                        )
                        .lineLimit(3...6)
                        .font(.golos(13))
                        .disabled(busy)
                        .onChange(of: draft) { _, next in
                            if next.count > Self.maxCharacters {
                                draft = String(next.prefix(Self.maxCharacters))
                            }
                        }

                        Text(
                            trimmed.isEmpty
                                ? "Nothing is sent until you write something here."
                                : "\(trimmed.count) of \(Self.maxCharacters) characters. Your words, sent as they are."
                        )
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted600)

                        HStack(spacing: 12) {
                            Button(saved == nil ? "Start sending this" : "Save") {
                                Task { await save(trimmed) }
                            }
                            .font(.golos(13, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                            .buttonStyle(.plain)
                            .disabled(busy || trimmed.isEmpty || trimmed == (saved ?? ""))

                            if saved != nil {
                                Button("Turn off") {
                                    draft = ""
                                    Task { await save(nil) }
                                }
                                .font(.golos(13, weight: .semibold))
                                .foregroundStyle(BrandColor.muted600)
                                .buttonStyle(.plain)
                                .disabled(busy)
                            }
                        }
                    }
                }
                .task(id: saved) { draft = saved ?? "" }
            }
        }
    }

    private var blurb: String {
        // Through `numberReleaseDay`, which is the one place on this screen the
        // release date is computed. This card used to add its own 30 days in
        // its own arithmetic; the Subscription card above it now names the same
        // day, and two independently-derived deadlines is one drift away from
        // telling an owner two different days they lose their number.
        let stops = numberReleaseDay(company.canceled_at)
            .map { "It stops on \($0), when " } ?? "It stops when "
        return "Anyone who texts your old number gets this back, once each. "
            + stops
            + "the number goes back to the phone company. After that we can't "
            + "answer it, and texts to it reach whoever gets it next."
    }

    private func save(_ message: String?) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await scope.repo.updateCompany(
                scope.companyId,
                patch: .object(["offramp_message": message.map { .string($0) } ?? .null])
            )
            scope.showMessage(
                message == nil
                    ? "Turned off."
                    : "Saved. We'll send this once to each customer who texts you."
            )
        } catch {
            scope.showMessage("Couldn't save that. Try again.")
        }
    }
}

// MARK: - Cancelling (#277)

/// The whole cancellation, rendered OPEN on the billing screen.
///
/// WHY IT EXISTS. Ten cancellations for ten different reasons are noise; ten for
/// the same reason are a roadmap, and until this card both looked identical from
/// here, because the only thing that ever reached us was a webhook. The question
/// has to be asked BEFORE the handoff: afterwards the person is gone, and nobody
/// answers a survey about a product they have just left.
///
/// WHY IT IS NOT A TRIGGER. There is no expand, no sheet, no "are you sure". A
/// control that reveals the screen holding the cancel button is itself a step,
/// and it makes leaving cost two taps where "Manage payment & invoices" directly
/// above costs one. Deliberate friction belongs on deleting an account, which
/// cannot be undone; a subscription can be restarted in a minute, and friction
/// there is a regulatory problem in several of the markets this sells into
/// rather than a kindness. Do not copy the collapse from a destructive control
/// into this card: they are opposite cases.
///
/// ONE TAP THROUGH. From landing on the billing screen, somebody who answers
/// nothing reaches Stripe with a single press of "Continue to cancel". Nothing
/// is pre-selected, and the ONLY thing that may ever disable that button is the
/// request already in flight: never the reason, never the note. A default answer
/// would be a reason nobody gave, and every count built on it would be wrong in
/// the direction we chose.
///
/// THE QUESTION IS QUIET. It sits under the consequence copy in the same muted
/// voice as the rest of the supporting text here. A billing screen should not
/// shout "why are you leaving?" at somebody who came to check their plan, and it
/// must not hide the exit either.
///
/// NO "NEVER MIND" BESIDE IT. With nothing expanded there is nothing to back out
/// of, and a second button next to the confirm is where the asymmetry creeps in:
/// a loud stay and a quiet leave is the pattern this card exists to avoid.
///
/// NOTHING WAITS ON US. The reason is posted on its own task that is never
/// awaited, so a slow, failing or entirely dead endpoint of ours cannot stop
/// somebody cancelling.
///
/// OWNER ONLY, SAID OUT LOUD. POST /v1/billing/portal mints the full portal for
/// an owner and a `payment_method_update` session for everybody else, and that
/// Stripe flow carries no cancellation surface at all. An admin or a bookkeeper
/// offered this button would be walked to a page where the promised thing does
/// not exist, and the reason they typed on the way would be filed against a
/// cancellation that could never be confirmed. They are told who can instead,
/// and nothing is recorded for them.
///
/// The export offer is here because somebody leaving still needs their customer
/// list, and "they made it hard to leave with our data" is a story a trade tells
/// about a supplier for years.
///
/// THE ANSWER SITS BELOW THE BUTTON THAT LEAVES (#277 follow-up), and that is
/// arithmetic rather than taste. Picking a reason can produce a true and useful
/// thing to say back, but it is four or five lines plus a control. This card is
/// the LAST thing on the billing screen, so somebody who has scrolled to it is
/// at the bottom of a scroll view with "Continue to cancel" near the foot of
/// the viewport. Inserting the answer above that button pushes it off the
/// bottom of the screen and asks for another scroll — in direct response to
/// having answered an OPTIONAL question. Answering must never cost more than
/// skipping. So the answer renders last, the exit does not move, and a plain
/// arrival on this screen is byte-for-byte the screen it was before.
@MainActor
private struct CancelCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onRefreshCompany: @MainActor () -> Void

    @State private var chosen: String?
    @State private var detail = ""
    @State private var opening = false
    @State private var error: String?
    @State private var exporting = false
    @State private var exportError: String?
    @State private var exported: StagedContactsCsv?

    private var canCancel: Bool { SettingsRoleGate.canCancelSubscription(scope.role) }

    /// Already scheduled to end. The notice at the top of this screen says so
    /// and offers the way back, so a second set of controls starting the same
    /// journey would read as though the first one had not worked.
    private var alreadyEnding: Bool { company.cancel_at_period_end }

    /// What is true FOR THE READER, which is not the same sentence for
    /// everybody. "Cancel anytime" is a promise an admin or a bookkeeper cannot
    /// keep, and making it and then withdrawing it one line later reads as a
    /// runaround. The facts are identical either way; only the person they
    /// happen to changes.
    ///
    /// THE HOLD IS ANCHORED TO THE CANCELLATION, and this is the sentence that
    /// got it wrong. It read "texting stops at the end of your billing period,
    /// and we hold your number for 30 days" — two clauses in one breath, which
    /// invites the reader to count the 30 from the period end. The clock does
    /// not start there: `runGraceJob` measures `now - canceled_at`, and
    /// `startCancellationLifecycle` stamps that column from Stripe's
    /// `canceled_at`, which on a `cancel_at_period_end` cancellation is the
    /// time of the REQUEST. Somebody cancelling on day 2 of a month counted
    /// about 59 days and had about 30, and what they lose at the end of the
    /// miscount is the number on the side of the van and on their invoices.
    ///
    /// The wrong anchor is named in order to deny it, because the reader
    /// already has it in their head — it is the date in the sentence before.
    /// The same correction is made in the scheduled-cancellation notice at the
    /// top of this screen and in the shared seasonal answer, and all three now
    /// say it the same way round.
    private var consequence: String {
        canCancel
            ? "Cancel anytime. Texting stops at the end of your billing period. Your "
                + "number is held for \(cancellationGraceDays) days from the day you "
                + "cancel — not from the day texting stops — so it can go back to the "
                + "phone company soon after. After that it is released for good."
            : "Only the owner can cancel this plan. When they do, texting stops at the "
                + "end of the billing period. The number is held for "
                + "\(cancellationGraceDays) days from the day they cancel — not from the "
                + "day texting stops — so it can go back to the phone company soon "
                + "after. After that it is released for good."
    }

    var body: some View {
        SettingsCard(title: "Cancel", description: consequence) {
            if !canCancel {
                // Said out loud rather than by omission: being sent to hunt for
                // a button that is not on that page is worse than being told.
                // "above", not "an admin reaches": a bookkeeper reads this line
                // too, and lands on the same card-only portal an admin does.
                ReadOnlyLine(
                    "The payment portal above is for cards and invoices and has no "
                        + "cancellation on it, so this is not something to go looking for there."
                )
            } else if alreadyEnding {
                EmptyView()
            } else {
                leaving
            }
        }
        .sheet(item: $exported) { file in
            ContactsCsvShareSheet(url: file.url) { exported = nil }
        }
    }

    /// The question, the export offer and the way out, all visible at once and
    /// in that order, because the half that serves us comes after the halves
    /// that serve them.
    private var leaving: some View {
        VStack(alignment: .leading, spacing: 0) {
            reasonQuestion
            Spacer().frame(height: 20)
            exportOffer
            Spacer().frame(height: 20)
            Text("Nothing above has to be filled in. This opens the secure Stripe portal "
                + "in your browser, where you finish cancelling.")
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
            Button(opening ? "Opening…" : "Continue to cancel") { handOff() }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.olive)
                // The request already in flight, and nothing else, ever.
                .disabled(opening)
                .padding(.top, 10)
            InlineError(error)
            // LAST, and after the exit on purpose — see the card's docblock.
            // Computed from the LOCAL selection rather than read back from the
            // server: the answer belongs to the tap, and a round trip would put
            // a spinner in the middle of a cancel screen.
            if let offer = cancellationOffer(
                reason: chosen,
                plan: company.plan,
                billingCurrency: company.billing_currency,
                country: company.country,
                registrationFeePaidAt: company.registration_fee_paid_at
            ) {
                CancellationAnswerNote(
                    offer: offer,
                    scope: scope,
                    company: company,
                    onRefreshCompany: onRefreshCompany
                )
                .padding(.top, 20)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Asked in the supporting voice rather than as a heading. This card is on
    /// the screen somebody opens to look at their plan, so the question is the
    /// quietest thing on it; a bold "Why are you leaving?" printed above a
    /// button reads as a gate until it says otherwise, and it says otherwise
    /// on the very next line.
    private var reasonQuestion: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 12, not larger: SettingsCard renders its description at 12, and a
            // question subordinate to that copy cannot be set above it. Colour
            // alone was carrying the hierarchy while the type contradicted it.
            Text("If you want to say why, it helps us fix it.")
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
            Text("Optional, and it changes nothing about cancelling.")
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted500)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
            Spacer().frame(height: 4)
            ForEach(cancellationReasons) { reason in
                CancellationReasonRow(reason: reason, selected: chosen == reason.code) {
                    // Tapping the chosen one CLEARS it. An answer given by a
                    // stray thumb has to be removable, or "optional" stops
                    // being true the moment the list is touched.
                    chosen = chosen == reason.code ? nil : reason.code
                }
                .disabled(opening)
            }
            Spacer().frame(height: 8)
            TextField(
                "Anything you want to add (optional)",
                text: Binding(
                    get: { detail },
                    // Capped where the server caps it, the same way the invite
                    // note is: an over-long paste stops taking characters
                    // rather than coming back as a 422 with the words lost.
                    set: { detail = truncatedCancellationDetail($0) }
                ),
                axis: .vertical
            )
            .textFieldStyle(.roundedBorder)
            .lineLimit(2 ... 4)
            .font(.golos(13))
            .disabled(opening)
        }
    }

    private var exportOffer: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Take your contacts with you")
                .font(.golos(13.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            // The columns are named because this is a promise to somebody who is
            // leaving and cannot come back to check it. GET /v1/contacts/export
            // carries name, phone, tags, consent source and dates. Custom fields
            // are not in it, so nothing here may imply they are.
            Text("Every contact in this workspace as a CSV: names, numbers, tags and when "
                + "they opted in. AirDrop it, mail it, or save it to Files. Yours either way.")
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
            Button(exporting ? "Preparing…" : "Export contacts") { exportContacts() }
                .buttonStyle(.bordered)
                .disabled(exporting)
                .padding(.top, 10)
            InlineError(exportError)
        }
    }

    /// Record what they said, then go, in that order and without ever waiting
    /// for the first to finish.
    ///
    /// The reason rides an UNSTRUCTURED task deliberately: `.task` would be
    /// cancelled the moment the browser comes forward and takes this screen
    /// with it, which is the very next thing that happens. Its failure is
    /// swallowed for the same reason the caller does not wait on it: there is
    /// nothing a person cancelling their subscription can usefully do about our
    /// own bookkeeping being down.
    ///
    /// A retry after a failed handoff posts again. The route upserts the open
    /// row, so that stays one statement rather than becoming three.
    ///
    /// Nothing is recorded for somebody who cannot cancel. The button is not
    /// rendered for them, and the guard says so here as well, because a row
    /// written for a walk that ends on a Stripe page with no cancel button on
    /// it can never be confirmed, and it would sit in the report as somebody
    /// who said why and stayed.
    private func handOff() {
        guard canCancel else { return }
        opening = true
        error = nil
        let saidReason = chosen
        let saidDetail = detail
        Task {
            try? await scope.repo.recordCancellationReason(
                scope.companyId,
                reason: saidReason,
                detail: saidDetail
            )
        }
        Task {
            do {
                let hosted = try await scope.repo.billingPortal(scope.companyId)
                openExternal(hosted.url)
            } catch {
                self.error = error.userMessage
            }
            opening = false
        }
    }

    private func exportContacts() {
        exporting = true
        exportError = nil
        Task {
            do {
                let csv = try await scope.repo.contactsCsvExport(scope.companyId)
                exported = StagedContactsCsv(url: try stageContactsCsv(csv))
            } catch {
                exportError = error.userMessage
            }
            exporting = false
        }
    }
}

/// One reason, offered as a radio row: the shape the after-hours and voicemail
/// pickers already use on this screen, so a choice looks like a choice.
private struct CancellationReasonRow: View {
    let reason: CancellationReason
    let selected: Bool
    let onTap: @MainActor () -> Void

    var body: some View {
        Button {
            onTap()
        } label: {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(selected ? BrandColor.olive : Color.secondary)
                Text(reason.label)
                    .font(.body)
                    .foregroundStyle(Color.primary)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // SwiftUI reads a plain Button as a button, which says nothing about
        // whether this one is currently the answer.
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

// MARK: - Answering that reason (#277 follow-up)

/// The muted note box the two answers share.
///
/// The same one `MissedWhileOffNote` uses at the top of this screen, and a NOTE
/// rather than a card on purpose: the cards here are the workspace's own state,
/// and these are things we know that the reader does not. A second SettingsCard
/// would read as a competing offer on a screen somebody came to leave from.
private extension View {
    func cancellationNoteBox() -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                BrandColor.inset,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
    }
}

/// The words of one offer: heading and body, tight together because they are
/// one thought. Every sentence comes from `cancellationOffer`, which reads the
/// price book and the plan limits rather than restating them — there is no
/// fallback string anywhere in this file, because a client that substituted its
/// own copy for a nil would be inventing the retention offer the shared module
/// exists to prevent.
private struct CancellationAnswerText: View {
    let offer: CancellationOffer

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(offer.heading)
                .font(.golos(13.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(offer.body)
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The answer to the reason just picked, on the cancel card.
///
/// IT ADDS NOTHING TO LEAVING. No confirmation, no disabled state, and nothing
/// on the exit above it changes because this appeared — the one control here is
/// an outline button under a paragraph. The sheet below belongs to "Switch to
/// Starter" and sits nowhere near the path to Stripe; it is the same
/// `ChangePlanSheet` the plan card already opens, so the downgrade checklist
/// (numbers, seats) is the one that already tells the truth about what fits.
///
/// The button is deliberately NOT the prominent olive. That is reserved for
/// "Continue to cancel" on this card: a loud stay above a quiet leave is the
/// asymmetry the card's own docblock exists to avoid.
@MainActor
private struct CancellationAnswerNote: View {
    let offer: CancellationOffer
    let scope: SettingsScope
    let company: CompanyView
    let onRefreshCompany: @MainActor () -> Void

    @State private var changingPlan = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CancellationAnswerText(offer: offer)
            if let action = offer.action, let label = offer.actionLabel {
                control(action, label: label)
                    .padding(.top, 10)
            }
        }
        .cancellationNoteBox()
        .sheet(isPresented: $changingPlan) {
            ChangePlanSheet(scope: scope, company: company) {
                changingPlan = false
                onRefreshCompany()
            } onDismiss: {
                changingPlan = false
            }
        }
    }

    /// The control the offer NAMES, with the offer's own words on it. An
    /// unhandled action renders nothing rather than guessing: a fallback
    /// control would be a button that does something other than its label says.
    @ViewBuilder
    private func control(_ action: CancellationOfferAction, label: String) -> some View {
        switch action {
        case .changePlan:
            Button(label) { changingPlan = true }
                .buttonStyle(.bordered)
        case .openHelp:
            NavigationLink(label, value: SettingsSection.help)
                .buttonStyle(.bordered)
        // `resubscribeStarter` cannot reach this phase — the subscription is
        // still live here, so there is nothing to come back from.
        case .resubscribeStarter:
            EmptyView()
        }
    }
}

/// The same answer again, while the number can still be saved.
///
/// # Why here and not in the mail
///
/// The day 1/15/27 grace emails already point at this screen, so it receives
/// win-back traffic on a cadence and had nothing to say when they arrived. It
/// stays IN THE APP for reasons that are legal rather than tasteful:
/// `MAILING_ADDRESS` is null in business-identity.ts and our one commercial
/// sender refuses on that basis; the grace emails ride the critical reputation
/// stream and carry no unsubscribe by design; and the only opt-out list is
/// global, so declining a win-back by email would also silence that workspace's
/// payment-failure and security mail. A card is not an electronic message and
/// carries none of that.
///
/// # Why not in OffRampCard
///
/// That card's docblock forbids persuasion in as many words — "a screen that
/// argues with them about leaving... is the last thing they will remember about
/// us" — and it is right. This sits in the Subscription card beside
/// Resubscribe, which is the control it is about.
///
/// # The three gates, in the order they cost something
///
///   1. dismissed        a press this session, or a stored stamp NEWER than
///                       this cancellation. The comparison is what makes a
///                       dismissal belong to ONE cancellation.
///   2. within grace     past the release the number is back in carrier
///                       inventory and reassignable to another business (#413),
///                       so "come back and keep your number" stops being true
///                       at exactly that boundary.
///   3. a stated reason  asked only once gates 1 and 2 have passed, so a
///                       healthy workspace never asks and a dismissed one stops
///                       asking. Nil renders nothing: they said "switched", or
///                       "not using it", or they are already on the cheapest
///                       plan, and there is nothing honest to add.
///
/// NO SPINNER AND NO ERROR BOX around the read, for the reason
/// `MissedWhileOffNote` gives: this is a supporting note on somebody else's
/// screen, and a broken box where a sentence should be makes the billing itself
/// look broken.
@MainActor
private struct WinbackNote: View {
    let scope: SettingsScope
    let company: CompanyView

    @State private var stated: String?
    @State private var dismissed = false
    @State private var opening = false
    @State private var error: String?

    /// Worth asking the server anything about.
    private var open: Bool {
        !dismissed
            && !winbackIsDismissed(
                canceledAt: company.canceled_at,
                dismissedAt: company.winback_dismissed_at
            )
            && isWithinCancellationGrace(company.canceled_at)
    }

    private var offer: CancellationOffer? {
        guard open else { return nil }
        return cancellationOffer(
            reason: stated,
            plan: company.plan,
            phase: .grace,
            billingCurrency: company.billing_currency,
            country: company.country,
            registrationFeePaidAt: company.registration_fee_paid_at
        )
    }

    var body: some View {
        Group {
            if let offer {
                VStack(alignment: .leading, spacing: 0) {
                    CancellationAnswerText(offer: offer)
                    HStack(spacing: 16) {
                        if let action = offer.action, let label = offer.actionLabel {
                            control(action, label: label)
                        }
                        Button {
                            waveAway()
                        } label: {
                            Text("No thanks")
                                .font(.golos(13, weight: .semibold))
                                .foregroundStyle(BrandColor.muted600)
                                .padding(.vertical, 8)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.top, 6)
                    InlineError(error)
                }
                .cancellationNoteBox()
                .padding(.top, 12)
            }
        }
        .task(id: open) {
            guard open else { return }
            stated = try? await scope.repo.cancellationReason(scope.companyId).reason
        }
    }

    @ViewBuilder
    private func control(_ action: CancellationOfferAction, label: String) -> some View {
        switch action {
        // STARTER, not `company.plan`. They left because Pro was too expensive,
        // and the one control that answers that must not put them back on Pro.
        //
        // THIS BUTTON ENFORCES NOTHING, and the copy above it is written to
        // that. It opens Stripe checkout, whose only gates are "one live
        // subscription" and the US registration draft — no seat count, no
        // number count — and `checkout.session.completed` then un-suspends
        // every suspended number with no plan filter. So a Pro workspace with
        // two numbers and eight members can land on Starter holding two and
        // eight. The shared grace copy therefore names the PRICE and nothing
        // else; a caption promising "3 people and 1 business number" here would
        // be a ceiling nobody applies. The under-enforcement is an API bug and
        // belongs in the API — do not paper it over from this file.
        //
        // The button stays regardless: change-plan 409s a canceled subscription
        // outright, so checkout is the only way back, and removing this would
        // leave the win-back with nothing to press at the one moment it is
        // worth anything.
        case .resubscribeStarter:
            Button(opening ? "Opening…" : label) { comeBack(on: "starter") }
                .buttonStyle(.bordered)
                .disabled(opening)
        case .openHelp:
            NavigationLink(label, value: SettingsSection.help)
                .buttonStyle(.bordered)
        // `changePlan` cannot reach this phase — there is no live subscription
        // to switch, so nothing is rendered rather than a guessed control.
        case .changePlan:
            EmptyView()
        }
    }

    /// "Stop showing me this."
    ///
    /// HIDDEN FIRST, SENT SECOND — the same order the cancel card uses for the
    /// reason, and for the same reason: a press must never wait on a round
    /// trip. A failed dismissal is said quietly rather than as an alert telling
    /// somebody who has already left that our server would not take their "no
    /// thanks".
    ///
    /// IT CAN COME BACK BEFORE THE APP IS CLOSED, and saying otherwise would be
    /// a promise about a flag that cannot keep it. `dismissed` is `@State`, so
    /// it dies with this view: leaving the billing screen and returning inside
    /// the same session rebuilds `WinbackNote` with `dismissed == false`, and
    /// the cached `CompanyView` still carries the `winback_dismissed_at` it was
    /// fetched with — nothing refetches the company on a dismissal, and the
    /// only write is the POST. So the second gate has not learned about the
    /// press either, and the note draws again.
    ///
    /// Left as it is rather than fixed, because every fix is worse than the
    /// symptom. Refetching the company would put a load on the press this
    /// docblock exists to keep instant; hoisting the flag into a session-scoped
    /// store would make one workspace's "no thanks" outlive the cancellation it
    /// was made on, which is the exact thing `winbackIsDismissed` compares
    /// timestamps to prevent. A note seen twice in one sitting is a small cost;
    /// it is honest about being one, and it stops for good on the next launch.
    private func waveAway() {
        dismissed = true
        Task {
            do {
                try await scope.repo.dismissWinback(scope.companyId)
            } catch {
                scope.showMessage("Couldn't save that — you may see this again.")
            }
        }
    }

    private func comeBack(on plan: String) {
        opening = true
        error = nil
        Task {
            do {
                let hosted = try await scope.repo.checkout(scope.companyId, plan: plan)
                openExternal(hosted.url)
            } catch {
                self.error = error.userMessage
            }
            opening = false
        }
    }
}

// MARK: - Handing the export to the phone

/// One finished export, staged on disk for the share sheet.
private struct StagedContactsCsv: Identifiable {
    let id = UUID()
    let url: URL
}

/// Stage the CSV as `contacts.csv` in a unique temp folder so the share sheet
/// offers a well-named file rather than a wall of text.
///
/// The server emits a UTF-8 BOM so Excel round-trips accents; it is re-attached
/// defensively here in case a transport layer stripped it, which is the same
/// thing the contacts screen does with the same bytes.
private func stageContactsCsv(_ text: String) throws -> URL {
    var data = Data([0xEF, 0xBB, 0xBF])
    var body = text
    if body.hasPrefix("\u{FEFF}") { body.removeFirst() }
    data.append(Data(body.utf8))

    let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appendingPathComponent("contacts.csv")
    try data.write(to: url)
    return url
}

/// The real system share sheet (AirDrop, Messages, Mail, Save to Files), where
/// a file exporter could only save.
private struct ContactsCsvShareSheet: UIViewControllerRepresentable {
    let url: URL
    let onFinish: @MainActor () -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        let onFinish = onFinish
        controller.completionWithItemsHandler = { _, _, _, _ in
            // UIKit calls this on the main thread.
            MainActor.assumeIsolated { onFinish() }
        }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

// MARK: - Previews

/// The reason list as it is first seen: six choices, NOTHING pre-selected.
/// A default here would be a reason we invented on somebody's behalf and then
/// counted, so the empty state is the one worth being able to look at.
#Preview("Cancellation reasons · nothing chosen") {
    VStack(alignment: .leading, spacing: 0) {
        ForEach(cancellationReasons) { reason in
            CancellationReasonRow(reason: reason, selected: false) {}
        }
    }
    .padding(20)
    .frame(width: 390)
    .background(BrandColor.paper)
}

#Preview("Cancellation reasons · one chosen") {
    VStack(alignment: .leading, spacing: 0) {
        ForEach(cancellationReasons) { reason in
            CancellationReasonRow(reason: reason, selected: reason.code == "seasonal") {}
        }
    }
    .padding(20)
    .frame(width: 390)
    .background(BrandColor.paper)
}

/// Every answer that exists, on the cancel card. Three of the six reasons are
/// missing from this preview and that is the point: `switched`, `not_using` and
/// `other` have nothing honest to add, so they draw nothing at all.
#Preview("Cancellation answers · before leaving") {
    ScrollView {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(cancellationReasons) { reason in
                if let offer = cancellationOffer(
                    reason: reason.code,
                    plan: "pro",
                    billingCurrency: "usd",
                    country: "US",
                    registrationFeePaidAt: "2026-01-05T00:00:00Z"
                ) {
                    CancellationAnswerText(offer: offer)
                        .cancellationNoteBox()
                }
            }
        }
        .padding(20)
    }
    .frame(width: 390)
    .background(BrandColor.paper)
}

/// The same answers during the grace window, where the verb changes from
/// "switch" to "come back". A Canadian workspace, so the prices in the first
/// one are the ones that workspace is actually charged.
#Preview("Cancellation answers · during the grace window") {
    ScrollView {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(cancellationReasons) { reason in
                if let offer = cancellationOffer(
                    reason: reason.code,
                    plan: "pro",
                    phase: .grace,
                    billingCurrency: "cad",
                    country: "CA",
                    registrationFeePaidAt: nil
                ) {
                    CancellationAnswerText(offer: offer)
                        .cancellationNoteBox()
                }
            }
        }
        .padding(20)
    }
    .frame(width: 390)
    .background(BrandColor.paper)
}
