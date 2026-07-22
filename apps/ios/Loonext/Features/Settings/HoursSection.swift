import SwiftUI

/// The default owner-authored away text shown as the placeholder (web parity).
private let defaultAwayMessage =
    "Thanks for texting us. We're out of the office right now and will reply first thing. "
        + "For a no-heat or burst-pipe emergency, reply URGENT and we'll call you."

/// One weekday row's editable state.
struct DayForm: Equatable, Sendable {
    let weekday: String
    var enabled: Bool
    var open: String
    var close: String
}

func toFormState(_ hours: [String: DayHours?]) -> [DayForm] {
    weekdayKeys.map { key in
        let window = hours[key] ?? nil
        return DayForm(
            weekday: key,
            enabled: window != nil,
            open: window?.open ?? "09:00",
            close: window?.close ?? "17:00"
        )
    }
}

/// Business hours & away reply (#163): the per-weekday open/close grid with
/// enable switches, and the after-hours auto-reply with merge fields and a
/// live preview that matches the wire byte-for-byte.
@MainActor
struct HoursSectionView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    var body: some View {
        BusinessHoursCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        AwayReplyCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
    }
}

// MARK: - Business hours

private struct BusinessHoursCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var days: [DayForm]
    @State private var saving = false
    @State private var error: String?

    init(scope: SettingsScope, company: CompanyView, onCompanyUpdated: @escaping @MainActor (CompanyView) -> Void) {
        self.scope = scope
        self.company = company
        self.onCompanyUpdated = onCompanyUpdated
        _days = State(initialValue: toFormState(company.business_hours))
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var dirty: Bool { days != toFormState(company.business_hours) }
    private var allValid: Bool {
        days.allSatisfy { !$0.enabled || isValidDayWindow(open: $0.open, close: $0.close) }
    }

    var body: some View {
        SettingsCard(
            title: "Business hours",
            description: "When you're open, in \(company.timezone.replacingOccurrences(of: "_", with: " ")). "
                + "Texts that arrive outside these hours can get your away reply. This is "
                + "separate from each customer's texting quiet hours."
        ) {
            ForEach($days, id: \.weekday) { $day in
                HStack(spacing: 10) {
                    Toggle("", isOn: $day.enabled)
                        .labelsHidden()
                        .tint(BrandColor.olive)
                        .disabled(!canEdit || saving)
                    Text(weekdayLabels[day.weekday] ?? day.weekday)
                        .font(.callout)
                        .frame(width: 86, alignment: .leading)
                    if day.enabled {
                        TimeField(label: "Open", value: $day.open, enabled: canEdit && !saving)
                        Text("to")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        TimeField(label: "Close", value: $day.close, enabled: canEdit && !saving)
                    } else {
                        Text("Closed")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                }
                .padding(.vertical, 4)
            }
            if !allValid {
                ReadOnlyLine("Times are 24-hour HH:MM, and open and close can't match.")
            }
            InlineError(error)
            if canEdit {
                if dirty {
                    Button(saving ? "Saving…" : "Save hours") { save() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(!allValid || saving)
                        .padding(.top, 10)
                }
            } else {
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can change business hours.")
            }
        }
    }

    private func save() {
        error = nil
        saving = true
        var hours: [String: JSONValue] = [:]
        for day in days where day.enabled {
            hours[day.weekday] = .object(["open": .string(day.open), "close": .string(day.close)])
        }
        let body = JSONValue.object(["business_hours": .object(hours)])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
                scope.showMessage("Business hours saved.")
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

private struct TimeField: View {
    let label: String
    @Binding var value: String
    let enabled: Bool

    var body: some View {
        TextField(label, text: Binding(
            get: { value },
            set: { next in
                if next.count <= 5 { value = next }
            }
        ))
        .textFieldStyle(.roundedBorder)
        .font(.callout)
        .keyboardType(.numbersAndPunctuation)
        .disabled(!enabled)
        .foregroundStyle(isValidHhmm(value) ? Color.primary : BrandColor.destructive)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Away reply

private struct AwayReplyCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var enabled: Bool
    @State private var message: String
    @State private var saving = false
    @State private var error: String?

    init(scope: SettingsScope, company: CompanyView, onCompanyUpdated: @escaping @MainActor (CompanyView) -> Void) {
        self.scope = scope
        self.company = company
        self.onCompanyUpdated = onCompanyUpdated
        _enabled = State(initialValue: company.away_enabled)
        _message = State(initialValue: company.away_message ?? "")
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var trimmed: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var dirty: Bool {
        enabled != company.away_enabled
            || trimmed != (company.away_message ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        SettingsCard(
            title: "Away reply",
            description: "One automatic text back when someone reaches you outside your "
                + "business hours, in your words, so you never lose an after-hours emergency."
        ) {
            LabeledToggleRow(
                label: "Reply automatically after hours",
                supporting: "Fires once per conversation when a customer first texts "
                    + "outside your hours.",
                isOn: enabled,
                enabled: canEdit && !saving
            ) { enabled = $0 }
            if canEdit {
                TextField(defaultAwayMessage, text: Binding(
                    get: { message },
                    set: { next in
                        if next.count <= 1000 { message = next }
                    }
                ), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3 ... 8)
                .disabled(saving)
                .padding(.top, 6)
                Text("\(message.count)/1000 · {first_name} and {business_name} fill in automatically.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
            }
            // The preview reuses the wire's drop-empty semantics: {first_name}
            // resolves to a sample name here because the away reply DOES carry
            // the contact.
            PreviewBubble(
                label: "Preview",
                text: applyMergeFields(
                    trimmed.isEmpty ? defaultAwayMessage : trimmed,
                    contactName: sampleFirstName,
                    businessName: company.name
                )
            )
            InlineError(error)
            if canEdit {
                if dirty {
                    Button(saving ? "Saving…" : "Save away reply") { save() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(saving)
                        .padding(.top, 10)
                }
            } else {
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can change the away reply.")
            }
        }
    }

    private func save() {
        if enabled && trimmed.isEmpty {
            error = "Write your away message before turning it on."
            return
        }
        error = nil
        saving = true
        let body = JSONValue.object([
            "away_enabled": .bool(enabled),
            "away_message": trimmed.isEmpty ? .null : .string(trimmed),
        ])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
                scope.showMessage("Away reply saved.")
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}
