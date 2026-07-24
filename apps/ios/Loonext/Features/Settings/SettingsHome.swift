import SwiftUI

/// The stacked settings index (#163) — mirrors the Android twin's nine
/// sections and the web's mobile section list.
enum SettingsSection: String, CaseIterable, Identifiable, Hashable {
    case workspace
    case hours
    case calling
    case team
    case numbers
    case usage
    case billing
    case notifications
    case profile

    var id: String { rawValue }

    var title: String {
        switch self {
        case .workspace: "Workspace"
        case .hours: "Business hours & away reply"
        case .calling: "Calling"
        case .team: "Team"
        case .numbers: "Numbers"
        case .usage: "Usage"
        case .billing: "Billing"
        case .notifications: "Notifications"
        case .profile: "Profile & account"
        }
    }

    var blurb: String {
        switch self {
        case .workspace: "Name, business identification, timezone"
        case .hours: "When you're open, and what after-hours texters hear"
        case .calling: "Missed-call text-back, voicemail, screening, caller ID"
        case .team: "Who can see and answer your customers' texts"
        case .numbers: "Your numbers, ports, text-enablement, registration"
        case .usage: "Messages, minutes, and your overage cap"
        case .billing: "Plan, payment, and invoices"
        case .notifications: "Email and push for new conversations"
        case .profile: "Your name, theme, email, and password"
        }
    }

    /// Outline SF Symbol for the spec-28 icon tile.
    var icon: String {
        switch self {
        case .workspace: "building.2"
        case .hours: "clock"
        case .calling: "phone"
        case .team: "person.2"
        case .numbers: "number"
        case .usage: "chart.bar"
        case .billing: "creditcard"
        case .notifications: "bell"
        case .profile: "person.crop.circle"
        }
    }
}

/// Everything a section needs, threaded once instead of six parameters.
@MainActor
struct SettingsScope {
    let graph: AppGraph
    let repo: SettingsRepository
    let companyId: String
    let me: Me
    let role: String?
    let showMessage: (String) -> Void
}

/// Settings entry (#163): a stacked index list navigating (NavigationStack)
/// into the nine sections. The company view loads once here and refreshes on
/// `number.updated` / `registration.updated` realtime events (payloads are
/// ID-only by design — always refetch, never patch from the event); sections
/// patch it back via the onCompanyUpdated merge.
@MainActor
struct SettingsHome: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    let onSignOut: @MainActor () -> Void

    @State private var companyState: LoadState<CompanyView> = .loading
    @State private var refreshKey = 0
    @State private var toast: String?
    @State private var toastTask: Task<Void, Never>?

    private var repo: SettingsRepository {
        SettingsRepository(api: graph.api, sessionStore: graph.sessionStore)
    }

    private var role: String? {
        me.memberships.first { $0.company_id == companyId }?.role
    }

    private var scope: SettingsScope {
        SettingsScope(
            graph: graph,
            repo: repo,
            companyId: companyId,
            me: me,
            role: role,
            showMessage: { showToast($0) }
        )
    }

    var body: some View {
        NavigationStack {
            Group {
                switch companyState {
                case .loading:
                    CenteredLoading()
                case .failed(let message):
                    CenteredError(message: message) { refreshKey += 1 }
                case .ready(let company):
                    indexList(company)
                        .navigationDestination(for: SettingsSection.self) { section in
                            sectionScreen(section, company: company)
                        }
                }
            }
            .navigationTitle("Settings")
            .background(BrandColor.canvas.ignoresSafeArea())
        }
        .tint(BrandColor.olive)
        .overlay(alignment: .bottom) { toastOverlay }
        .task(id: "\(companyId)|\(refreshKey)") { await load() }
        .task(id: companyId) {
            // Provisioning completion / 10DLC approval appear live (SPEC §8).
            for await event in await graph.realtime.events()
                where event.event == "number.updated" || event.event == "registration.updated" {
                refreshKey += 1
            }
        }
        // #215: a socket re-JOIN (frames missed while offline) refetches the
        // company view; Part A does the same on foreground return.
        .task(id: companyId) {
            for await _ in await graph.realtime.reconnected() {
                refreshKey += 1
            }
        }
        .resyncOnForeground { refreshKey += 1 }
    }

    // MARK: - Index

    private func indexList(_ company: CompanyView) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 13) {
                ScreenTitle(text: "Settings")
                identityCard(company)
                PaperCard {
                    ForEach(Array(SettingsSection.allCases.enumerated()), id: \.element.id) { index, section in
                        if index > 0 { RowDivider() }
                        NavigationLink(value: section) {
                            SettingsSectionRow(section: section)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
            .padding(.bottom, 24)
            // Cap + center the index on a regular-width (iPad) window so it
            // doesn't stretch edge-to-edge (#180).
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(BrandColor.canvas)
        .toolbar(.hidden, for: .navigationBar)
    }

    /// Spec-28 ink identity card: who you are, your role, and the workspace
    /// number one tap from the clipboard.
    private func identityCard(_ company: CompanyView) -> some View {
        HStack(spacing: 13) {
            Text(initialsOf(me.display_name.isBlank ? company.name : me.display_name))
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.paper)
                .frame(width: 46, height: 46)
                .background(BrandColor.paper.opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(me.display_name.isBlank ? company.name : me.display_name)
                    .font(.golos(15, weight: .semibold))
                    .foregroundStyle(BrandColor.paper)
                    .lineLimit(1)
                Text(roleLine(company))
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.paper.opacity(0.55))
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if let number = activeNumber(company) {
                Button {
                    copyToClipboard(number)
                    showToast("Number copied.")
                } label: {
                    HStack(spacing: 6) {
                        Text(formatPhone(number))
                            .font(.golos(11, weight: .semibold))
                            .monospacedDigit()
                        Image(systemName: "doc.on.doc")
                            .font(.system(size: 10))
                    }
                    .foregroundStyle(BrandColor.paper)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(BrandColor.paper.opacity(0.1), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Copy number")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandColor.ink, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func roleLine(_ company: CompanyView) -> String {
        if let role, !role.isEmpty {
            return "\(role.capitalized) · \(company.name)"
        }
        return company.name
    }

    private func activeNumber(_ company: CompanyView) -> String? {
        company.numbers.first { $0.status == NumberStatus.active && $0.number_e164 != nil }?.number_e164
    }

    // MARK: - Section screens

    @ViewBuilder
    private func sectionScreen(_ section: SettingsSection, company: CompanyView) -> some View {
        let onCompanyUpdated: @MainActor (CompanyView) -> Void = { patched in
            // PATCH /v1/company returns scalar columns only — keep the
            // embedded numbers/modules/registration from the last GET.
            var merged = patched
            merged.numbers = company.numbers
            merged.enabled_modules = company.enabled_modules
            merged.registration = company.registration
            companyState = .ready(merged)
        }
        let refreshCompany: @MainActor () -> Void = { refreshKey += 1 }

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                switch section {
                case .workspace:
                    WorkspaceSectionView(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
                case .hours:
                    HoursSectionView(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
                case .calling:
                    CallingSectionView(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
                case .team:
                    TeamSectionView(scope: scope, company: company)
                case .numbers:
                    NumbersSectionView(scope: scope, company: company, onRefreshCompany: refreshCompany)
                case .usage:
                    UsageSectionView(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
                case .billing:
                    BillingSectionView(scope: scope, company: company, onRefreshCompany: refreshCompany)
                case .notifications:
                    NotificationsSectionView(scope: scope)
                case .profile:
                    ProfileSectionView(scope: scope, onSignOut: onSignOut)
                }
            }
            .padding(.vertical, 10)
            // Same iPad cap as the index, so a section's rows/forms stay a
            // readable column instead of spanning the full width (#180).
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(BrandColor.canvas)
        .navigationTitle(section.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Load + toast

    private func load() async {
        if case .ready = companyState {} else { companyState = .loading }
        do {
            companyState = .ready(try await repo.company(companyId))
        } catch {
            if case .ready = companyState {
                showToast(error.userMessage)
            } else {
                companyState = .failed(error.userMessage)
            }
        }
    }

    private func showToast(_ message: String) {
        toastTask?.cancel()
        withAnimation { toast = message }
        toastTask = Task {
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled {
                withAnimation { toast = nil }
            }
        }
    }

    @ViewBuilder
    private var toastOverlay: some View {
        if let toast {
            Text(toast)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}

/// Spec-28 index row: inset icon tile, 13.5 semibold title, 11 muted blurb.
/// Standalone so the responsive index preview can render the real section
/// grammar without the (heavily-defaulted) `CompanyView` the live screen loads.
private struct SettingsSectionRow: View {
    let section: SettingsSection

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: section.icon)
                .font(.system(size: 15))
                .foregroundStyle(BrandColor.muted900)
                .frame(width: 36, height: 36)
                .background(
                    BrandColor.inset,
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
            VStack(alignment: .leading, spacing: 1) {
                Text(section.title)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Text(section.blurb)
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted400)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BrandColor.muted250)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 11)
        .contentShape(Rectangle())
    }
}

// MARK: - Previews

/// The settings index grammar (title + all nine section rows), rendered from
/// the real `SettingsSection` metadata inside the app's card + scroll shell.
/// #180 responsive matrix — fixed frames prove every row stays reachable via
/// scroll at each ratio.
private struct SettingsIndexPreview: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 13) {
                ScreenTitle(text: "Settings")
                PaperCard {
                    ForEach(Array(SettingsSection.allCases.enumerated()), id: \.element.id) { index, section in
                        if index > 0 { RowDivider() }
                        SettingsSectionRow(section: section)
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
            .padding(.bottom, 24)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(BrandColor.canvas)
    }
}

#Preview("Settings index · tall phone") {
    SettingsIndexPreview()
        .frame(width: 390, height: 720)
}

#Preview("Settings index · 1:1 square") {
    SettingsIndexPreview()
        .frame(width: 380, height: 380)
}

#Preview("Settings index · iPad width") {
    SettingsIndexPreview()
        .frame(width: 900, height: 820)
}
