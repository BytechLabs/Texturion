import SwiftUI

/// The stacked settings index (#163) — mirrors the Android twin's sections
/// and the web's mobile section list.
enum SettingsSection: String, CaseIterable, Identifiable, Hashable {
    case workspace
    case hours
    case calling
    case templates
    case ai
    case team
    case numbers
    case usage
    case billing
    /// #224 — text-to-pay. Directly after Billing because the two are the same
    /// subject seen from opposite ends: that one is what WE charge the business,
    /// this is what the business charges the homeowner. Adjacent so the
    /// distinction is legible; separate so neither screen has to explain it — a
    /// single screen would put "your plan renews on the 3rd" beside "your bank
    /// account" and make neither of them readable.
    case payments
    case notifications
    case profile
    /// #236: what is signed in right now. Directly after Profile & account
    /// because they are one question in two halves — how you get in, and what
    /// is currently in.
    case devices
    /// #382: the route to a human. Last because it is what you go looking
    /// for when something is wrong, not a screen you pass through.
    case help
    /// #321: improvement was invisible. The product ships almost daily and a
    /// customer who signed up in June would never encounter reply drafting,
    /// voicemail transcripts or saved views, because nothing pointed at them.
    /// Beside Help because both are what you go looking for.
    case whatsNew
    /// #243: where this workspace's own systems get told what happened. Last
    /// of the visible rows, beside Help and What's new, because all three are
    /// things a person goes LOOKING for rather than passes through — and
    /// because a row that sends customer messages to a third party should not
    /// sit in the middle of the list somebody scans while changing their hours.
    case webhooks
    /// #243: the other half of the integration story — what may reach IN.
    /// Directly after Connections because the two are one subject seen from
    /// opposite ends, and somebody setting up an integration needs both.
    case apiKeys
    /// #337: hidden until seven taps on the version footer unlock it, the same
    /// gesture and the same copy as Android's. Below Help because that is the
    /// order of escalation: try the humans first.
    case diagnostics

    var id: String { rawValue }

    /// #461/#315: the capability this section is SHOWN to.
    ///
    /// Hand-ported from packages/shared/src/settings-visibility.ts and covered
    /// by the same vectors. It began as a personal/business boolean, which
    /// stopped being expressible the moment a role existed that is neither
    /// above nor below a member: a bookkeeper holds billing and nothing else,
    /// so "is this the business's?" no longer answers "may they see it?".
    ///
    /// Visibility, not authorization — the API's gates are what protect
    /// anything, and they are unchanged. Hiding a row is a courtesy.
    var needs: String {
        switch self {
        // Yours by being in the workspace at all.
        case .profile, .notifications, .devices, .help, .whatsNew, .diagnostics:
            Capability.workspaceAccess
        // #286: reading who is in the crew, and changing who is in it, are
        // different rights. A new member could do neither — "identify the owner
        // and the rest of the crew without asking" had no screen behind it.
        // Every control on the section still asks SettingsRoleGate.canManageTeam,
        // and the API still refuses each write.
        case .team: Capability.workspaceAccess
        // The business's, each behind the axis that actually governs it.
        case .workspace, .hours, .calling, .templates, .ai:
            Capability.settingsManage
        // #243: the endpoint list names the third parties this workspace's
        // messages flow to, and those URLs routinely carry a per-tenant token
        // in the path — so the READ is gated exactly as the writes are, which
        // is what the API does too.
        case .webhooks: Capability.settingsManage
        // #243: a key list names what can reach this workspace's data, and
        // creating one mints a credential — so the READ is gated exactly as
        // the writes are, matching the API.
        case .apiKeys: Capability.settingsManage
        case .numbers: Capability.numbersManage
        // #224: `billing.manage` for payments, and NOT `workspace.own` — even
        // though CONNECTING the account is owner-only on the server. The two
        // answer different questions. Setting it up binds a legal entity and a
        // bank account, which is the owner's alone. OPENING the screen is how
        // the bookkeeper reaches the Stripe dashboard to issue a refund, which
        // is the whole reason that role exists (#315) — hiding the row from
        // them would send them back to sharing the owner's login for the one
        // task the role was created to make unnecessary.
        case .usage, .billing, .payments: Capability.billingManage
        }
    }

    /// #228: the CATALOGUE KEY for the row's name, and the same key Android's
    /// `SettingsSection.titleKey` holds. Two properties rather than one
    /// translated string, because this enum is reached from places that have no
    /// reader — see `title` below.
    var titleKey: String {
        switch self {
        case .workspace: "settingsMore.sectionWorkspace"
        case .hours: "settingsMore.sectionHours"
        case .calling: "settingsMore.sectionCalling"
        case .templates: "settingsMore.sectionTemplates"
        case .ai: "settingsMore.sectionAi"
        case .team: "settingsMore.sectionTeam"
        case .numbers: "settingsMore.sectionNumbers"
        case .usage: "settingsMore.sectionUsage"
        case .billing: "settingsMore.sectionBilling"
        case .payments: "settingsMore.sectionPayments"
        case .notifications: "settingsMore.sectionNotifications"
        case .profile: "settingsMore.sectionProfile"
        case .devices: "settingsMore.sectionDevices"
        case .help: "settingsMore.sectionHelp"
        case .whatsNew: "settingsMore.sectionWhatsNew"
        case .webhooks: "webhooks.navWebhooks"
        case .apiKeys: "apiKeys.navApiKeys"
        case .diagnostics: "settingsMore.diagnostics"
        }
    }

    var blurbKey: String {
        switch self {
        case .workspace: "settingsMore.sectionWorkspaceBlurb"
        case .hours: "settingsMore.sectionHoursBlurb"
        case .calling: "settingsMore.sectionCallingBlurb"
        case .templates: "settingsMore.sectionTemplatesBlurb"
        case .ai: "settingsMore.sectionAiBlurb"
        case .team: "settingsMore.sectionTeamBlurb"
        case .numbers: "settingsMore.sectionNumbersBlurb"
        case .usage: "settingsMore.sectionUsageBlurb"
        case .billing: "settingsMore.sectionBillingBlurb"
        case .payments: "settingsMore.sectionPaymentsBlurb"
        case .notifications: "settingsMore.sectionNotificationsBlurb"
        case .profile: "settingsMore.sectionProfileBlurb"
        case .devices: "settingsMore.sectionDevicesBlurb"
        case .help: "settingsMore.sectionHelpBlurb"
        case .whatsNew: "settingsMore.sectionWhatsNewBlurb"
        case .webhooks: "webhooks.navWebhooksDesc"
        case .apiKeys: "apiKeys.navApiKeysDesc"
        case .diagnostics: "settingsMore.sectionDiagnosticsBlurb"
        }
    }

    /// The English words, for callers with no reader to ask — previews, and any
    /// guard that compares this enum against the shared tables. A View shows
    /// `t(section.titleKey)` instead, which is the reader's language. Android
    /// keeps exactly this pair for exactly this reason.
    var title: String { AppStrings.translate(nil, titleKey) }

    var blurb: String { AppStrings.translate(nil, blurbKey) }

    /// Outline SF Symbol for the spec-28 icon tile.
    var icon: String {
        switch self {
        case .workspace: "building.2"
        case .hours: "clock"
        case .calling: "phone"
        case .templates: "text.bubble"
        case .ai: "circle.hexagongrid"
        case .team: "person.2"
        case .numbers: "number"
        case .usage: "chart.bar"
        case .billing: "creditcard"
        // A card is what somebody pays US with; a dollar sign is money coming
        // IN. The neighbouring rows have to be told apart at a glance, which is
        // the whole reason they are neighbours.
        case .payments: "dollarsign.circle"
        case .notifications: "bell"
        case .profile: "person.crop.circle"
        case .devices: "laptopcomputer.and.iphone"
        case .help: "lifepreserver"
        case .whatsNew: "sparkles"
        case .webhooks: "powerplug"
        case .apiKeys: "key"
        case .diagnostics: "stethoscope"
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
/// into its sections. The company view loads once here and refreshes on
/// `number.updated` / `registration.updated` realtime events (payloads are
/// ID-only by design — always refetch, never patch from the event); sections
/// patch it back via the onCompanyUpdated merge.
@MainActor
struct SettingsHome: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    let onSignOut: @MainActor () -> Void
    /// Open straight at this section instead of the index.
    var initialSection: SettingsSection? = nil

    @State private var path = NavigationPath()
    @State private var companyState: LoadState<CompanyView> = .loading
    @State private var refreshKey = 0
    @State private var toast: String?
    @State private var toastTask: Task<Void, Never>?
    // #337: the version-footer easter egg. `diagnosticsUnlocked` mirrors the
    // persisted flag so the index re-renders the moment it flips.
    @State private var versionTaps = 0
    @State private var lastVersionTap = Date.distantPast
    @State private var diagnosticsUnlocked = DiagnosticsAccess.isUnlocked
    /// #330: the truck-phone handover, and what it would cost right now.
    @State private var askingToHandOver = false
    @State private var unsentAtHandover = 0

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

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
        NavigationStack(path: $path) {
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
                        // Seeded HERE, not on the stack itself, and only once.
                        // The destination is declared in this branch, so a push
                        // made while the company was still loading had nothing
                        // to resolve against and opened an empty screen: a tap
                        // on an offer to change one setting landed on nothing.
                        // Pushing on every appear would fight the back button.
                        .task {
                            guard let initialSection, path.isEmpty else { return }
                            path.append(initialSection)
                        }
                }
            }
            .navigationTitle(t("shell.settings"))
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

    /// Every section this role may see, plus Diagnostics once it has been
    /// unlocked (#337).
    ///
    /// #461: a member used to see all of them and could act on almost none —
    /// a plan they cannot change, a registration they cannot file, roles they
    /// cannot set. An unknown or absent role is treated as a member, which is
    /// the safe way for a missing membership to fail.
    /// #461/#315: a section that needs only `workspace.access` is shown to ANY
    /// role, including one this build has never heard of — reaching this screen
    /// means the server already authorized a session in this workspace, and
    /// these rows are the reader's own. The alternative is an empty settings
    /// index, which reads as a broken app. Every row that belongs to the
    /// BUSINESS still asks the capability table.
    private var visibleSections: [SettingsSection] {
        SettingsSection.allCases.filter { section in
            guard section != .diagnostics || diagnosticsUnlocked else { return false }
            return section.needs == Capability.workspaceAccess
                || MemberRole.has(role, section.needs)
        }
    }

    /// The seven-tap gesture. Taps must be within `tapWindow` of each other, so
    /// scrolling past the footer and touching it twice an hour apart never
    /// counts toward anything.
    private func registerVersionTap() {
        let now = Date()
        versionTaps = now.timeIntervalSince(lastVersionTap) <= DiagnosticsAccess.tapWindow
            ? versionTaps + 1
            : 1
        lastVersionTap = now
        guard versionTaps >= DiagnosticsAccess.tapsToUnlock else { return }
        versionTaps = 0
        let next = !diagnosticsUnlocked
        DiagnosticsAccess.isUnlocked = next
        diagnosticsUnlocked = next
        scope.showMessage(DiagnosticsAccess.message(unlocked: next))
    }

    private func indexList(_ company: CompanyView) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 13) {
                ScreenTitle(text: t("shell.settings"))
                identityCard(company)
                // Directly under the identity card and tight against it, because it
                // belongs to "you are signed in as this person" — which is the
                // thought somebody is having when they hand the phone on.
                handOverRow
                // #515: a handover addressed to the reader, above the section
                // list they may not be able to use. The index is the one
                // surface every role reaches — it is the whole app for a
                // bookkeeper — and the named backup owner is routinely a plain
                // member with no Team row. Draws nothing when nothing is
                // theirs.
                OwnershipPrompt(scope: scope) { refreshKey += 1 }
                PaperCard {
                    ForEach(Array(visibleSections.enumerated()), id: \.element.id) { index, section in
                        if index > 0 { RowDivider() }
                        NavigationLink(value: section) {
                            SettingsSectionRow(
                                section: section,
                                showMarker: section == .whatsNew
                                    && hasUnseenWhatsNew(
                                        lastSeen: readWhatsNewSeen(),
                                        joinedAt: company.created_at
                                    )
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                // #337: the easter egg. Seven quick taps flips the pref, and the
                // counting is SILENT -- no haptic, no ripple, nothing for a
                // stray tap. Only the seventh says anything, and it says exactly
                // what Android says.
                VersionFooter()
                    .contentShape(Rectangle())
                    .onTapGesture { registerVersionTap() }
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
            .padding(.bottom, 24)
            // Cap + center the index on a regular-width (iPad) window so it
            // doesn't stretch edge-to-edge (#180).
            .contentMaxWidth()
        }
        .background(BrandColor.canvas)
        .toolbar(.hidden, for: .navigationBar)
    }

    /// #330 — the handover, on the screen every role lands on.
    ///
    /// ## Evaluation
    ///
    /// D12's customer is a crew texting from personal handsets, and a spare phone
    /// lives in the truck. Handing it to whoever is covering the evening meant
    /// Settings, Profile, a scroll and "Sign out on this device" — four steps against
    /// a fast path of just passing the phone over still signed in, which attributes
    /// every reply to the wrong person and gives them permissions that are not theirs.
    ///
    /// ## What binds it
    ///
    /// *Prioritize Intent* — the label is the sentence already in somebody's head.
    /// "Sign out on this device" describes the mechanism; this describes the act.
    ///
    /// *Relationship Strength* — directly under the identity card and tight against
    /// it, because it belongs to "you are signed in as this person".
    ///
    /// *Zen of Clarity* — one quiet row, not a card. Findable in a second, and not
    /// competing with the workspace settings that fill this screen.
    ///
    /// *Ethical Friction, and only as much as it earns* — one confirmation, because a
    /// mis-tap on a job site costs a full sign-in. It says what leaves the phone, and
    /// counts anything that would be discarded with it.
    private var handOverRow: some View {
        Button {
            // Read when the sheet opens rather than on every redraw of the hub: this
            // touches disk, and the number is only shown inside the confirmation.
            unsentAtHandover = Outbox().all().count
            askingToHandOver = true
        } label: {
            HStack(spacing: 9) {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                    .font(.scaled(15))
                    .foregroundStyle(BrandColor.muted600)
                Text(HandOverPhone.localizedAction(locale: appLocale))
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .alert(HandOverPhone.localizedTitle(locale: appLocale), isPresented: $askingToHandOver) {
            Button(HandOverPhone.localizedCancel(locale: appLocale), role: .cancel) {}
            Button(
                HandOverPhone.localizedConfirm(locale: appLocale),
                // Destructive only when something would actually be lost. Colouring a
                // clean handover as a danger teaches people to ignore the colour on
                // the day it means something.
                role: HandOverPhone.costs(unsent: unsentAtHandover)
                    ? ButtonRole.destructive
                    : nil
            ) {
                onSignOut()
            }
        } message: {
            Text(HandOverPhone.body(unsent: unsentAtHandover, locale: appLocale))
        }
    }

    /// Spec-28 ink identity card: who you are, your role, and the workspace
    /// number one tap from the clipboard.
    private func identityCard(_ company: CompanyView) -> some View {
        HStack(spacing: 13) {
            InitialsAvatar(
                name: me.display_name.isBlank ? company.name : me.display_name,
                size: 46,
                glyph: 13,
                typeface: .golos,
                tint: BrandColor.paper.opacity(0.14),
                content: BrandColor.paper
            )
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
                    showToast(t("settingsMore.numberCopied"))
                } label: {
                    HStack(spacing: 6) {
                        Text(formatPhone(number))
                            .font(.golos(11, weight: .semibold))
                            .monospacedDigit()
                        Image(systemName: "doc.on.doc")
                            .font(.scaled(10))
                    }
                    .foregroundStyle(BrandColor.paper)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(BrandColor.paper.opacity(0.1), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(t("settingsMore.copyNumber"))
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
                    WorkspaceSectionView(
                        scope: scope,
                        company: company,
                        onCompanyUpdated: onCompanyUpdated,
                        // #406: leaving ends the session, so it lands exactly
                        // where signing out does.
                        onLeft: onSignOut
                    )
                case .hours:
                    HoursSectionView(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
                case .calling:
                    CallingSectionView(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
                case .templates:
                    TemplatesSectionView(
                        scope: scope,
                        company: company,
                        onCompanyUpdated: onCompanyUpdated
                    )
                case .ai:
                    AiSectionView(scope: scope)
                case .team:
                    TeamSectionView(scope: scope, company: company)
                case .numbers:
                    NumbersSectionView(scope: scope, company: company, onRefreshCompany: refreshCompany)
                case .usage:
                    UsageSectionView(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
                case .billing:
                    BillingSectionView(scope: scope, company: company, onRefreshCompany: refreshCompany)
                case .payments:
                    // #224. Takes only the scope: everything on it comes from
                    // Stripe through /v1/payments/account, and nothing it shows
                    // is on the company view — so threading `company` in would
                    // be an argument the screen never reads.
                    PaymentsSectionView(scope: scope)
                case .notifications:
                    NotificationsSectionView(
                        scope: scope, company: company, onCompanyUpdated: onCompanyUpdated
                    )
                case .profile:
                    ProfileSectionView(scope: scope, onSignOut: onSignOut)
                case .devices:
                    DevicesSectionView(scope: scope)
                case .help:
                    HelpSectionView(scope: scope, company: company)
                case .whatsNew:
                    WhatsNewSectionView(joinedAt: company.created_at)
                case .webhooks:
                    WebhooksSectionView(scope: scope)
                case .apiKeys:
                    ApiKeysSectionView(scope: scope)
                case .diagnostics:
                    DiagnosticsSectionView(graph: graph, companyId: companyId)
                }
            }
            .padding(.vertical, 10)
            // Same iPad cap as the index, so a section's rows/forms stay a
            // readable column instead of spanning the full width (#180).
            .contentMaxWidth()
        }
        .background(BrandColor.canvas)
        .navigationTitle(t(section.titleKey))
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
    /// #321: true only for the What's new row, and only when unseen.
    var showMarker: Bool = false

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: section.icon)
                .font(.scaled(15))
                .foregroundStyle(BrandColor.muted900)
                .frame(width: 36, height: 36)
                .background(
                    BrandColor.inset,
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
            VStack(alignment: .leading, spacing: 1) {
                Text(AppStrings.translate(appLocale, section.titleKey))
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Text(AppStrings.translate(appLocale, section.blurbKey))
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted400)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            // #321: a dot, and nothing else. The audience is holding a phone on
            // a job site, so this marks that there is something behind a row
            // they choose to open, never anything that arrives over the top.
            if showMarker {
                Circle()
                    .fill(BrandColor.ink)
                    .frame(width: 8, height: 8)
            }
            Image(systemName: "chevron.right")
                .font(.scaled(12, weight: .semibold))
                .foregroundStyle(BrandColor.muted250)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 11)
        .contentShape(Rectangle())
    }
}

// MARK: - Previews

/// The settings index grammar (title + every section row), rendered from
/// the real `SettingsSection` metadata inside the app's card + scroll shell.
/// #180 responsive matrix — fixed frames prove every row stays reachable via
/// scroll at each ratio.
private struct SettingsIndexPreview: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 13) {
                ScreenTitle(text: AppStrings.translate(nil, "shell.settings"))
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
            .contentMaxWidth()
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

/// The shipped version at the foot of Settings.
///
/// A crew reporting a problem, and whoever answers them, both need to know
/// what they are actually running — Android has said so for a while and iOS
/// said nothing. Read from the bundle, so it is exactly what was built.
///
/// The wordmark rule holds (brand/README.md): the SECOND o in the accent, as
/// text, never an image.
@MainActor
struct VersionFooter: View {
    private var version: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        switch (short, build) {
        case let (short?, build?) where short != build: return "\(short) (\(build))"
        case let (short?, _): return short
        case let (_, build?): return build
        default: return ""
        }
    }

    var body: some View {
        if !version.isEmpty {
            HStack(spacing: 0) {
                Text("Lo")
                Text("o").foregroundStyle(BrandColor.olive)
                Text("next \(version)")
            }
            .font(.golos(11))
            .foregroundStyle(BrandColor.muted400)
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
            .textSelection(.enabled)
        }
    }
}
