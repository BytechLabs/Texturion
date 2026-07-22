import SwiftUI

private let fairUseUrl = "https://loonext.com/legal/fair-use"

private func fullDate(_ iso: String?) -> String? {
    guard let iso, let date = parseWireTimestamp(iso) else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "MMMM d, yyyy"
    return formatter.string(from: date)
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
                SettingsCard(title: "Cancel") {
                    Text(
                        "Cancel anytime from the payment portal. Texting stops at the end "
                            + "of your billing period, and we hold your number for 30 days in "
                            + "case you change your mind. After that it's released for good."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
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
            return (
                "Your plan is set to cancel"
                    + (date.map { " on \($0)" } ?? " at the end of this period")
                    + ". Texting stops then; we hold your number for 30 days in case you come "
                    + "back. You can undo this from the payment portal.",
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
                Text(
                    "Your subscription is canceled. We hold your number for 30 days after "
                        + "your last period. Resubscribe before then and everything picks up "
                        + "where it left off."
                )
                .font(.callout)
                InlineError(error)
                if canManage {
                    Button(opening ? "Opening…" : "Resubscribe") { resubscribe() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(opening)
                        .padding(.top, 10)
                }
            }
        } else if let facts = planFacts(company.plan) {
            SettingsCard(title: "Plan") {
                HStack(spacing: 10) {
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

    private func resubscribe() {
        opening = true
        error = nil
        Task {
            do {
                let hosted = try await scope.repo.checkout(scope.companyId, plan: company.plan ?? "starter")
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
    private var seatsOk: Bool { (activeMembers ?? Int.max) <= 3 }
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
