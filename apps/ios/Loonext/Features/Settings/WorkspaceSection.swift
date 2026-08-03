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

    init(scope: SettingsScope, company: CompanyView, onCompanyUpdated: @escaping @MainActor (CompanyView) -> Void) {
        self.scope = scope
        self.company = company
        self.onCompanyUpdated = onCompanyUpdated
        _name = State(initialValue: company.name)
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var dirty: Bool { trimmed != company.name }
    private var valid: Bool { (1 ... 200).contains(trimmed.count) }

    var body: some View {
        SettingsCard(
            title: "Workspace name",
            description: "The name your customers know you by — used on your carrier "
                + "registration and available as {business_name} in your texts."
        ) {
            if SettingsRoleGate.canEditWorkspace(scope.role) {
                TextField("Workspace name", text: $name)
                    .textFieldStyle(.roundedBorder)
                if dirty && !valid {
                    Text("1 to 200 characters.")
                        .font(.footnote)
                        .foregroundStyle(BrandColor.destructive)
                        .padding(.top, 4)
                }
                InlineError(error)
                if dirty {
                    Button(saving ? "Saving…" : "Save") { save() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(!valid || saving)
                        .padding(.top, 10)
                }
            } else {
                Text(company.name)
                    .font(.body)
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can rename the workspace.")
            }
        }
    }

    private func save() {
        error = nil
        saving = true
        let value = trimmed
        Task {
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["name": .string(value)])
                )
                onCompanyUpdated(updated)
                scope.showMessage("Workspace name saved.")
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

    var body: some View {
        SettingsCard(
            title: "Business identification",
            description: "What carriers have on file for your business. "
                + "It comes from your texting registration."
        ) {
            switch state {
            case .loading:
                Text("Loading…")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            case .failed(let message):
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Try again") { refreshKey += 1 }
                    .buttonStyle(.bordered)
                    .padding(.top, 8)
            case .ready(let pair):
                if let brand = pair.brand {
                    if SettingsRoleGate.canEditWorkspace(scope.role) {
                        IdentityRows(brand: brand, country: company.country)
                        Spacer().frame(height: 8)
                        ReadOnlyLine("Need to change something? Manage registration under Numbers.")
                    } else {
                        Text(
                            "Registration is "
                                + (brand.status == RegistrationStatus.approved ? "approved" : "on file")
                                + ". Owners and admins can see the full details."
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                } else {
                    Text(
                        company.country == "CA" && !company.us_texting_enabled
                            ? "No registration needed. Canadian texting works without one. "
                                + "Enabling US texting adds it."
                            : "No registration details on file yet. "
                                + "Manage registration under Numbers."
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

    private func field(_ key: String) -> String {
        brand.data?[key]?.stringValue ?? ""
    }

    private var rows: [(String, String)] {
        let legalName = brand.sole_proprietor
            ? "\(field("firstName")) \(field("lastName"))".trimmingCharacters(in: .whitespaces)
            : field("companyName")
        let identifierLabel: String
        if brand.sole_proprietor && country == "US" {
            identifierLabel = "SSN (last 4)"
        } else if brand.sole_proprietor {
            identifierLabel = "SIN (last 4)"
        } else if country == "US" {
            identifierLabel = "EIN"
        } else {
            identifierLabel = "Business number"
        }
        let address = [field("street"), field("city"), field("state"), field("postalCode")]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        return [
            ("Legal name", legalName),
            (identifierLabel, field("ein")),
            ("Address", address),
            ("Website", field("website")),
            ("Contact", field("email")),
        ].filter { !$0.1.isEmpty }
    }

    var body: some View {
        if rows.isEmpty {
            Text("Registration details are being prepared.")
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

    var body: some View {
        SettingsCard(
            title: "Timezone",
            description: "Dates in emails about your workspace are framed in your "
                + "business's local time."
        ) {
            Text(company.timezone)
                .font(.body)
            // Live "It's 3:42 PM in …" preview — ticks with the clock.
            TimelineView(.periodic(from: .now, by: 15)) { context in
                if let localTime = localTimeString(zoneId: company.timezone, at: context.date) {
                    Text("It's \(localTime) in \(company.timezone) right now.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer().frame(height: 6)
            ReadOnlyLine("Texting quiet hours use each customer's local time, not this timezone.")
            InlineError(error)
            if SettingsRoleGate.canEditWorkspace(scope.role) {
                Button(saving ? "Saving…" : "Change timezone") { picking = true }
                    .buttonStyle(.bordered)
                    .disabled(saving)
                    .padding(.top, 10)
            } else {
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can change the timezone.")
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
        Task {
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["timezone": .string(zoneId)])
                )
                onCompanyUpdated(updated)
                scope.showMessage("Timezone saved.")
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

private struct TimezonePickerSheet: View {
    let current: String
    let onPick: @MainActor (String) -> Void
    let onDismiss: @MainActor () -> Void

    @State private var query = ""

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
                    Text("No timezone matches \"\(query)\".")
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
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search, e.g. Toronto")
            .navigationTitle("Choose a timezone")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDismiss() }
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
            title: "Sign your texts",
            description: "Add your business name to the first text you send "
                + "someone, so a message from an unknown number says who it is from."
        ) {
            LabeledToggleRow(
                label: "Sign the first text to a new customer",
                supporting: "Once per customer. Replies and later texts are never signed.",
                isOn: company.first_message_identification,
                enabled: canEdit && !saving
            ) { next in
                save(next)
            }

            if let signature {
                PreviewBubble(label: "What gets added", text: signature)
                Spacer().frame(height: 6)
                ReadOnlyLine(
                    "That is \(signature.count) characters, so a long first text "
                        + "can be sent in two parts instead of one."
                )
            }

            InlineError(error)

            if !canEdit {
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can change how texts are signed.")
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

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }

    var body: some View {
        SettingsCard(
            title: "Texting a new customer at night",
            description: "Starting a brand-new conversation between 8pm and 8am "
                + "the customer's time asks you to confirm first."
        ) {
            LabeledToggleRow(
                label: "Ask me to confirm",
                supporting: "Only when you start the conversation. Replying to a "
                    + "customer who texted or called you is never interrupted.",
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
                    label: "With this off",
                    text: "You will not be asked. A text you start at 2am goes "
                        + "straight out, and it is on you that the customer wanted "
                        + "to hear from you then."
                )
                Spacer().frame(height: 6)
                ReadOnlyLine(
                    "This does not change automated texts. Reminders and anything "
                        + "else we send on your behalf still wait for the "
                        + "customer's morning, whatever this is set to."
                )
            }

            InlineError(error)

            if !canEdit {
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can change this.")
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
