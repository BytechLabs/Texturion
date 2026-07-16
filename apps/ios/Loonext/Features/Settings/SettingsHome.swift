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
        }
        .tint(BrandColor.petrol)
        .overlay(alignment: .bottom) { toastOverlay }
        .task(id: "\(companyId)|\(refreshKey)") { await load() }
        .task(id: companyId) {
            // Provisioning completion / 10DLC approval appear live (SPEC §8).
            for await event in await graph.realtime.events()
                where event.event == "number.updated" || event.event == "registration.updated" {
                refreshKey += 1
            }
        }
    }

    // MARK: - Index

    private func indexList(_ company: CompanyView) -> some View {
        List {
            Section {
                ForEach(SettingsSection.allCases) { section in
                    NavigationLink(value: section) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(section.title)
                                .font(.body)
                            Text(section.blurb)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                }
            } header: {
                Text(company.name)
                    .font(.subheadline)
                    .textCase(nil)
            }
        }
        .listStyle(.insetGrouped)
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
        }
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
