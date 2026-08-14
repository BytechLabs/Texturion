import SwiftUI

/// Workspace (#163): company name (O/A, 1-200, dirty save), the business
/// identification read card (full for O/A from the registration wizard data,
/// a redacted line for members), and the searchable IANA timezone picker with
/// a live local-time preview.
@MainActor
struct WorkspaceSectionView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void
    var onLeft: @MainActor () -> Void = {}

    var body: some View {
        NameCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        // #393: directly under the name, because it is the name this adds to a
        // first text — the strongest relationship on the screen.
        SignTextsCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        BusinessIdentificationCard(scope: scope, company: company)
        TimezoneCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        // #225: directly under the timezone card. Both answer "whose clock are
        // we on", and the pair reads as one idea — yours above, the customer's
        // here.
        QuietHoursCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        // #228: after the two clock cards because it is the same shape of
        // decision: those bend to the customer's hours, this bends to the
        // customer's language.
        LanguageCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        // #291: below the two clock cards because it is a different question —
        // those are about when we contact people, this is about what we know
        // about them.
        ContactFieldsCard(scope: scope)
        // #406: everyone except the owner can end their own access. An owner
        // leaving would strand a workspace nobody can administer (#332), which
        // is why they are the one person this is not offered to.
        if scope.role != "owner" {
            LeaveWorkspaceCard(scope: scope, company: company, onLeft: onLeft)
        }
    }
}

// MARK: - Name

private struct NameCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var name: String
    @State private var saving = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    init(scope: SettingsScope, company: CompanyView, onCompanyUpdated: @escaping @MainActor (CompanyView) -> Void) {
        self.scope = scope
        self.company = company
        self.onCompanyUpdated = onCompanyUpdated
        _name = State(initialValue: company.name)
    }

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var dirty: Bool { trimmed != company.name }
    private var valid: Bool { (1 ... 200).contains(trimmed.count) }

    var body: some View {
        SettingsCard(
            title: t("settingsMore.workspaceName"),
            description: t("settingsMore.workspaceNameDesc")
        ) {
            if SettingsRoleGate.canEditWorkspace(scope.role) {
                TextField(t("settingsMore.workspaceName"), text: $name)
                    .textFieldStyle(.roundedBorder)
                if dirty && !valid {
                    Text(t("settingsMore.nameLength200"))
                        .font(.footnote)
                        .foregroundStyle(BrandColor.destructive)
                        .padding(.top, 4)
                }
                InlineError(error)
                if dirty {
                    Button(saving ? t("common.saving") : t("common.save")) { save() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(!valid || saving)
                        .padding(.top, 10)
                }
            } else {
                Text(company.name)
                    .font(.body)
                Spacer().frame(height: 4)
                ReadOnlyLine(t("settingsMore.onlyAdminsRename"))
            }
        }
    }

    private func save() {
        error = nil
        saving = true
        let value = trimmed
        // Read before the hop: `appLocale` is the environment of this view, and
        // the confirmation is composed inside a detached Task.
        let locale = appLocale
        Task {
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["name": .string(value)])
                )
                onCompanyUpdated(updated)
                scope.showMessage(
                    AppStrings.translate(locale, "settingsMore.workspaceNameSaved")
                )
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

// MARK: - Business identification

private struct BusinessIdentificationCard: View {
    let scope: SettingsScope
    let company: CompanyView

    @State private var state: LoadState<RegistrationDetailPair> = .loading
    @State private var refreshKey = 0

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        SettingsCard(
            title: t("settingsMore.businessIdCard"),
            description: t("settingsMore.businessIdCardDesc")
        ) {
            switch state {
            case .loading:
                Text(t("settingsMore.businessIdLoading"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            case .failed(let message):
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button(t("common.retry")) { refreshKey += 1 }
                    .buttonStyle(.bordered)
                    .padding(.top, 8)
            case .ready(let pair):
                if let brand = pair.brand {
                    if SettingsRoleGate.canEditWorkspace(scope.role) {
                        IdentityRows(brand: brand, country: company.country)
                        Spacer().frame(height: 8)
                        ReadOnlyLine(t("settingsMore.changeRegistrationUnderNumbers"))
                    } else {
                        // One sentence with the state interpolated rather than
                        // three fragments glued together: French does not put
                        // "approuvée" where English puts "approved", and a
                        // concatenation hard-codes English word order.
                        Text(
                            AppStrings.translate(
                                appLocale,
                                "settingsMore.registrationIs",
                                [
                                    "state": t(
                                        brand.status == RegistrationStatus.approved
                                            ? "settingsMore.registrationApproved"
                                            : "settingsMore.registrationOnFile"
                                    ),
                                ]
                            )
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                } else {
                    Text(
                        t(
                            company.country == "CA" && !company.us_texting_enabled
                                ? "settingsMore.noRegistrationNeeded"
                                : "settingsMore.noRegistrationYet"
                        )
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .task(id: "\(scope.companyId)|\(refreshKey)") {
            if case .ready = state {} else { state = .loading }
            do {
                state = .ready(try await scope.repo.registration(scope.companyId))
            } catch {
                state = .failed(error.userMessage)
            }
        }
    }
}

private struct IdentityRows: View {
    let brand: RegistrationDetail
    let country: String

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private func field(_ key: String) -> String {
        brand.data?[key]?.stringValue ?? ""
    }

    private var rows: [(String, String)] {
        let legalName = brand.sole_proprietor
            ? "\(field("firstName")) \(field("lastName"))".trimmingCharacters(in: .whitespaces)
            : field("companyName")
        let identifierLabel: String
        if brand.sole_proprietor && country == "US" {
            identifierLabel = t("settingsMore.ssnLast4")
        } else if brand.sole_proprietor {
            identifierLabel = t("settingsMore.sinLast4")
        } else if country == "US" {
            identifierLabel = t("settingsMore.einLabel")
        } else {
            identifierLabel = t("settingsMore.businessNumberLabel")
        }
        let address = [field("street"), field("city"), field("state"), field("postalCode")]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        return [
            (t("settingsMore.legalName"), legalName),
            (identifierLabel, field("ein")),
            (t("settingsMore.addressLabel"), address),
            (t("settingsMore.websiteLabel"), field("website")),
            (t("settingsMore.contactLabel"), field("email")),
        ].filter { !$0.1.isEmpty }
    }

    var body: some View {
        if rows.isEmpty {
            Text(t("settingsMore.registrationBeingPrepared"))
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(rows, id: \.0) { row in
                    HStack(alignment: .top, spacing: 12) {
                        Text(row.0)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(width: 110, alignment: .leading)
                        Text(row.1)
                            .font(.callout)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }
}

// MARK: - Timezone

private func localTimeString(zoneId: String, at date: Date) -> String? {
    guard let zone = TimeZone(identifier: zoneId) else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = zone
    formatter.dateFormat = "h:mm a"
    return formatter.string(from: date)
}

private struct TimezoneCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var picking = false
    @State private var saving = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        SettingsCard(
            title: t("settingsMore.timezone"),
            description: t("settingsMore.timezoneDesc")
        ) {
            Text(company.timezone)
                .font(.body)
            // Live "It's 3:42 PM in …" preview — ticks with the clock.
            TimelineView(.periodic(from: .now, by: 15)) { context in
                if let localTime = localTimeString(zoneId: company.timezone, at: context.date) {
                    Text(
                        AppStrings.translate(
                            appLocale,
                            "settingsMore.localTimeNow",
                            ["time": localTime, "zone": company.timezone]
                        )
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
            }
            Spacer().frame(height: 6)
            ReadOnlyLine(t("settingsMore.quietHoursNote"))
            InlineError(error)
            if SettingsRoleGate.canEditWorkspace(scope.role) {
                Button(saving ? t("common.saving") : t("settingsMore.changeTimezone")) {
                    picking = true
                }
                .buttonStyle(.bordered)
                .disabled(saving)
                .padding(.top, 10)
            } else {
                Spacer().frame(height: 4)
                ReadOnlyLine(t("settingsMore.onlyAdminsTimezone"))
            }
        }
        .sheet(isPresented: $picking) {
            TimezonePickerSheet(current: company.timezone) { picked in
                picking = false
                save(picked)
            } onDismiss: {
                picking = false
            }
        }
    }

    private func save(_ zoneId: String) {
        error = nil
        saving = true
        let locale = appLocale
        Task {
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["timezone": .string(zoneId)])
                )
                onCompanyUpdated(updated)
                scope.showMessage(
                    AppStrings.translate(locale, "settingsMore.timezoneSaved")
                )
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

/// #307 reuses this for a single line's timezone, so it is no longer private.
struct TimezonePickerSheet: View {
    let current: String
    let onPick: @MainActor (String) -> Void
    let onDismiss: @MainActor () -> Void

    @State private var query = ""

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var filtered: [String] {
        let all = TimeZone.knownTimeZoneIdentifiers.sorted()
        let needle = query.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "_")
        if needle.isEmpty { return all }
        return all.filter { $0.range(of: needle, options: .caseInsensitive) != nil }
    }

    var body: some View {
        NavigationStack {
            List {
                if filtered.isEmpty {
                    Text(
                        AppStrings.translate(
                            appLocale,
                            "settingsMore.noTimezoneMatch",
                            ["query": query]
                        )
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                } else {
                    ForEach(filtered, id: \.self) { zoneId in
                        Button {
                            onPick(zoneId)
                        } label: {
                            HStack {
                                Text(zoneId)
                                    .font(.callout)
                                    .foregroundStyle(zoneId == current ? BrandColor.olive : Color.primary)
                                Spacer()
                                if let time = localTimeString(zoneId: zoneId, at: Date()) {
                                    Text(time)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: t("settingsMore.timezoneSearchHint")
            )
            .navigationTitle(t("settingsMore.chooseTimezone"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { onDismiss() }
                }
            }
        }
    }
}

// MARK: - Sign your texts (#393)

/// Sign the first text to a new customer with the business name.
///
/// Deliberately NOT titled "identification" — the card below uses that word for
/// carrier registration data, and two cards saying it would read as one thing.
/// The part cost is disclosed because it is real: the signature can push a long
/// first text into a second part, and the customer pays per part.
private struct SignTextsCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var saving = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }

    /// Server-resolved, and only shown once the server confirms — composing the
    /// signature here could drift from what actually sends and gets billed.
    private var signature: String? {
        guard company.first_message_identification,
              let suffix = company.first_message_identification_suffix
        else { return nil }
        let trimmed = suffix.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? nil : trimmed
    }

    var body: some View {
        SettingsCard(
            title: t("settingsMore.signTextsTitle"),
            description: t("settingsMore.signTextsDesc")
        ) {
            LabeledToggleRow(
                label: t("settingsMore.signFirstText"),
                supporting: t("settingsMore.signFirstTextSupporting"),
                isOn: company.first_message_identification,
                enabled: canEdit && !saving
            ) { next in
                save(next)
            }

            if let signature {
                PreviewBubble(label: t("settingsMore.whatGetsAdded"), text: signature)
                Spacer().frame(height: 6)
                ReadOnlyLine(
                    AppStrings.translate(
                        appLocale,
                        "settingsMore.signatureLength",
                        ["count": "\(signature.count)"]
                    )
                )
            }

            InlineError(error)

            if !canEdit {
                Spacer().frame(height: 4)
                ReadOnlyLine(t("settingsMore.onlyAdminsSigning"))
            }
        }
    }

    private func save(_ next: Bool) {
        error = nil
        saving = true
        let body = JSONValue.object(["first_message_identification": .bool(next)])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

/// #225 ask 5 — the quiet-hours confirmation, for the trade that works nights.
///
/// COPY DISCIPLINE, AND IT IS THE WHOLE DESIGN. This must never read as "turn off
/// quiet hours". Automated texts are held to the customer's window no matter what
/// this says, and an owner who believed otherwise would be relying on a permission
/// we did not grant. Every sentence names the PROMPT, and the consequence block
/// says out loud what the switch does not do. Copy is identical to the web and
/// Android cards on purpose.
private struct QuietHoursCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var saving = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }

    var body: some View {
        SettingsCard(
            title: t("settingsMore.nightTextTitle"),
            description: t("settingsMore.nightTextDesc")
        ) {
            LabeledToggleRow(
                label: t("settingsMore.askMeToConfirm"),
                supporting: t("settingsMore.askMeToConfirmSupporting"),
                isOn: company.quiet_hours_confirm_enabled,
                enabled: canEdit && !saving
            ) { next in
                save(next)
            }

            // The consequence, inline and at the moment of the decision. The
            // second line is the one that matters: it forecloses the reading that
            // this permits automated night texts.
            if !company.quiet_hours_confirm_enabled {
                PreviewBubble(
                    label: t("settingsMore.withThisOff"),
                    text: t("settingsMore.withThisOffBody")
                )
                Spacer().frame(height: 6)
                ReadOnlyLine(t("settingsMore.nightTextAutomatedNote"))
            }

            InlineError(error)

            if !canEdit {
                Spacer().frame(height: 4)
                ReadOnlyLine(t("settingsMore.onlyAdminsThis"))
            }
        }
    }

    private func save(_ next: Bool) {
        error = nil
        saving = true
        let body = JSONValue.object(["quiet_hours_confirm_enabled": .bool(next)])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

// MARK: - Language (#228)

/// #228: the sentence that stops this card being a broken promise.
///
/// An owner reading "language" reasonably expects the app to change language.
/// It does not: four automated texts change, and nothing else. Naming the four
/// in the card's own description, and naming the two things it does NOT do
/// directly under the choice, is the whole design. Somebody who expected a
/// French app and received four French texts was misled by us.
///
/// The other two clients carry this same caveat. Three screens describing the
/// reach of one setting differently is how an owner ends up trusting the most
/// generous of the three.
///
/// #228: the sentence itself now lives in the catalogue under the key Android
/// already uses, `settingsMore.automatedLanguageNotApp`, and the card renders
/// the READER's language. This constant survives as the ENGLISH of it, because
/// `LocaleCopyTests` reads it alongside `localeContactScopeNote` to assert both
/// screens still say the two things a misled owner would need — that the app
/// itself does not change, and that nothing somebody typed is rewritten. A
/// catalogue key cannot be asserted that way from a test that has no locale, and
/// turning this into a function would break the array that test iterates.
let localeScopeCaveat = AppStrings.translate(
    MessageLocale.en,
    "settingsMore.automatedLanguageNotApp"
)

/// #228: which language the automated texts go out in.
///
/// TWO states, and neither of them is "unset": a business always works in some
/// language, so there is nothing here to clear. The per-contact override in
/// Contacts is the one with three.
private struct LanguageCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var saving = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }

    var body: some View {
        SettingsCard(
            title: t("settingsMore.automatedLanguageTitle"),
            description: t("settingsMore.automatedLanguageDesc")
        ) {
            ForEach(MessageLocale.all, id: \.self) { locale in
                // #228: resolve rather than compare raw. A row carrying a
                // locale this build does not know would leave EVERY circle
                // empty here while the contact screen falls back to English for
                // the same row, so the two screens would disagree about one
                // workspace and the setting would look unset.
                let selected = MessageLocale.resolve(contact: nil, company: company.locale) == locale
                Button {
                    guard !selected else { return }
                    save(locale)
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(selected ? BrandColor.olive : Color.secondary)
                            .padding(.top, 2)
                        Text(MessageLocale.label(locale))
                            .font(.body)
                            .foregroundStyle(Color.primary)
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
                .disabled(!canEdit || saving)
            }
            Spacer().frame(height: 6)
            ReadOnlyLine(t("settingsMore.automatedLanguageNotApp"))
            Spacer().frame(height: 6)
            // Discoverability for the other half of the feature: an owner who
            // needs one language for the business and another for one customer
            // would otherwise conclude the product cannot do it.
            ReadOnlyLine(t("settingsMore.automatedLanguagePerContact"))
            InlineError(error)
            if !canEdit {
                Spacer().frame(height: 4)
                ReadOnlyLine(t("settingsMore.onlyAdminsLanguage"))
            }
        }
    }

    private func save(_ locale: String) {
        error = nil
        saving = true
        let reader = appLocale
        Task {
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["locale": .string(locale)])
                )
                onCompanyUpdated(updated)
                scope.showMessage(
                    AppStrings.translate(reader, "settingsMore.languageUpdated")
                )
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}
