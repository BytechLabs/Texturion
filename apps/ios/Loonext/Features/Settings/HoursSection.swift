import SwiftUI


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
    @State private var emergency: Bool
    @State private var saving = false
    @State private var error: String?

    init(scope: SettingsScope, company: CompanyView, onCompanyUpdated: @escaping @MainActor (CompanyView) -> Void) {
        self.scope = scope
        self.company = company
        self.onCompanyUpdated = onCompanyUpdated
        _enabled = State(initialValue: company.away_enabled)
        _message = State(initialValue: company.away_message ?? "")
        _emergency = State(initialValue: company.emergency_keyword_enabled)
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var trimmed: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var dirty: Bool {
        enabled != company.away_enabled
            || trimmed != (company.away_message ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            || emergency != company.emergency_keyword_enabled
    }

    /// What actually goes out — the owner's text if they wrote one, else the
    /// product default. The preview and the #414 emergency check both read
    /// THIS, so the screen can never approve of a message that isn't sending.
    // #414 ask 5: the SERVER says what will actually send.
    private var effectiveMessage: String {
        trimmed.isEmpty ? company.away_effective_message : trimmed
    }
    private var emergencyNotice: AwayEmergencyNotice? {
        awayEmergencyNotice(emergencyEnabled: emergency, awayMessage: effectiveMessage)
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
            // The send gates refuse a US destination until the campaign is
            // approved, and the away reply is best-effort: a refusal is
            // swallowed so it never breaks inbound ingest. A switch reading ON
            // while every US customer gets silence is the first week of every
            // US workspace.
            if enabled, !usSendApproved(company) {
                ReachNote(text: usTextingOff(company)
                    ? "Customers with US numbers won't get this reply: US texting isn't on for this workspace. Canadian numbers get it now."
                    : "Customers with US numbers won't get this reply until your registration is approved. Canadian numbers get it now.")
            }
            if canEdit {
                TextField(company.away_effective_message, text: Binding(
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
            // #414: the switch sits with the message that makes the offer, not
            // on a separate notifications screen. They are one decision — a
            // message inviting URGENT with the mechanism off is the exact
            // defect this issue is about, and an owner can only see it if the
            // two are on screen together.
            LabeledToggleRow(
                label: "Treat a reply of URGENT as an emergency",
                supporting: "Texts back starting with URGENT, EMERGENCY, 911 or SOS reach "
                    + "everyone on the crew straight away, at the priority that wakes a phone — "
                    + "no away reply, and never held back by your daily notification limit.",
                isOn: emergency,
                enabled: canEdit && !saving
            ) { emergency = $0 }
            // #453: which sentence appears is decided in SettingsLogic,
            // mirroring shared, so this screen, web and Android cannot drift
            // into three wordings of the same warning. Only the tone-to-colour
            // mapping is ours.
            if let notice = emergencyNotice {
                ReachNote(
                    text: notice.text,
                    tone: notice.tone == .warn ? .warn : .neutral
                )
            }
            // The preview reuses the wire's drop-empty semantics: {first_name}
            // resolves to a sample name here because the away reply DOES carry
            // the contact.
            PreviewBubble(
                label: "Preview",
                text: applyMergeFields(
                    effectiveMessage,
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
            "emergency_keyword_enabled": .bool(emergency),
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
