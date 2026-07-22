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

    var body: some View {
        NameCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        BusinessIdentificationCard(scope: scope, company: company)
        TimezoneCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
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
