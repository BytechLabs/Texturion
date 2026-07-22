import SwiftUI

/// The default missed-call text-back shown as the placeholder (web parity).
private let defaultMctbMessage =
    "Sorry we missed your call! This is {business_name}. Reply here with your address "
        + "and what you need, and we'll get you booked in."

/// Call-screening values PATCH /v1/company accepts.
private enum CallScreening {
    static let off = "off"
    static let flag = "flag"
    static let divert = "divert"
}

/// All live numbers are text-enabled landlines — in-app calling won't apply.
private func onlyHostedNumbers(_ company: CompanyView) -> Bool {
    let live = company.numbers.filter { $0.status != NumberStatus.released }
    return !live.isEmpty && live.allSatisfy { $0.source == "hosted" }
}

/// Calling (#163): missed-call text-back, voicemail greeting, carrier call
/// screening, and caller ID — the D36..D43 voice surface, role-gated to O/A.
@MainActor
struct CallingSectionView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    var body: some View {
        if onlyHostedNumbers(company) {
            Text(
                "In-app calling needs a number whose calls come through Loonext. Calls to "
                    + "your text-enabled landline stay with your existing carrier, so these "
                    + "settings won't apply until you add or transfer a Loonext number."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 20)
            .padding(.vertical, 6)
        }
        TextBackCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        VoicemailCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        ScreeningCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        CallerIdCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        MinutesFooter(scope: scope)
    }
}

// MARK: - Missed-call text-back

private struct TextBackCard: View {
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
        _enabled = State(initialValue: company.mctb_enabled)
        _message = State(initialValue: company.mctb_message ?? "")
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var trimmed: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var dirty: Bool {
        enabled != company.mctb_enabled
            || trimmed != (company.mctb_message ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        SettingsCard(
            title: "Text back a missed call",
            description: "When a call to your business number goes unanswered, we send the "
                + "caller one text so they can book by reply, instead of calling the next "
                + "number on their list."
        ) {
            LabeledToggleRow(
                label: "Text back missed calls",
                supporting: "Fires once per caller when a call goes unanswered.",
                isOn: enabled,
                enabled: canEdit && !saving
            ) { enabled = $0 }
            if canEdit {
                TextField(defaultMctbMessage, text: Binding(
                    get: { message },
                    set: { next in
                        if next.count <= 1000 { message = next }
                    }
                ), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3 ... 8)
                .disabled(saving)
                .padding(.top, 6)
                Text("\(message.count)/1000 · {business_name} fills in automatically.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
            }
            // The server sends this with NO contact name (a missed call is
            // usually a brand-new caller) — the preview drops {first_name}
            // exactly as the wire does.
            PreviewBubble(
                label: "What the caller receives",
                text: applyMergeFields(
                    trimmed.isEmpty ? defaultMctbMessage : trimmed,
                    contactName: nil,
                    businessName: company.name
                )
            )
            InlineError(error)
            if canEdit {
                if dirty {
                    Button(saving ? "Saving…" : "Save text-back") { save() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(saving)
                        .padding(.top, 10)
                }
            } else {
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can change the missed-call text-back.")
            }
        }
    }

    private func save() {
        if enabled && trimmed.isEmpty {
            error = "Write your text-back message before turning it on."
            return
        }
        error = nil
        saving = true
        let body = JSONValue.object([
            "mctb_enabled": .bool(enabled),
            "mctb_message": trimmed.isEmpty ? .null : .string(trimmed),
        ])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
                scope.showMessage("Missed-call text-back saved.")
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

// MARK: - Voicemail

private struct VoicemailCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var greeting: String
    @State private var saving = false
    @State private var error: String?

    init(scope: SettingsScope, company: CompanyView, onCompanyUpdated: @escaping @MainActor (CompanyView) -> Void) {
        self.scope = scope
        self.company = company
        self.onCompanyUpdated = onCompanyUpdated
        _greeting = State(initialValue: company.voicemail_greeting ?? "")
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var trimmed: String { greeting.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var dirty: Bool {
        trimmed != (company.voicemail_greeting ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        SettingsCard(
            title: "Voicemail greeting",
            description: "When nobody answers in the app, the caller hears this greeting "
                + "and can leave a message up to two minutes. Voicemails land in the call "
                + "log and the caller's conversation, ready to play."
        ) {
            if canEdit {
                TextField(defaultVoicemailGreeting(companyName: company.name), text: Binding(
                    get: { greeting },
                    set: { next in
                        if next.count <= 500 { greeting = next }
                    }
                ), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(2 ... 6)
                .disabled(saving)
                Text("\(greeting.count)/500 · Spoken aloud to the caller. Leave it empty to use the default.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
            }
            PreviewBubble(
                label: "What callers hear",
                text: trimmed.isEmpty ? defaultVoicemailGreeting(companyName: company.name) : trimmed
            )
            InlineError(error)
            if canEdit {
                if dirty {
                    Button(saving ? "Saving…" : "Save greeting") { save() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(saving)
                        .padding(.top, 10)
                }
            } else {
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can change the voicemail greeting.")
            }
        }
    }

    private func save() {
        error = nil
        saving = true
        let body = JSONValue.object([
            "voicemail_greeting": trimmed.isEmpty ? .null : .string(trimmed),
        ])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
                scope.showMessage("Voicemail greeting saved.")
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

// MARK: - Call screening

private struct ScreeningChoice: Identifiable {
    let value: String
    let label: String
    let detail: String
    var id: String { value }
}

private let screeningChoices = [
    ScreeningChoice(
        value: CallScreening.off,
        label: "Off",
        detail: "Every call rings the team, no carrier verdict shown."
    ),
    ScreeningChoice(
        value: CallScreening.flag,
        label: "Label suspicious calls",
        detail: "The carrier's verdict shows on the call — “Spam likely” — but every "
            + "call still rings the team."
    ),
    ScreeningChoice(
        value: CallScreening.divert,
        label: "Send suspicious calls to voicemail",
        detail: "Flagged callers skip the ring and go straight to voicemail. A real customer "
            + "who gets misflagged can still leave a message."
    ),
]

private struct ScreeningCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var saving = false
    @State private var error: String?

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }

    var body: some View {
        SettingsCard(
            title: "Call screening",
            description: "What happens when the carrier thinks an incoming call is spam."
        ) {
            ForEach(screeningChoices) { choice in
                let selected = company.call_screening == choice.value
                Button {
                    guard !selected else { return }
                    save(choice.value)
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(selected ? BrandColor.olive : Color.secondary)
                            .padding(.top, 2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(choice.label)
                                .font(.body)
                                .foregroundStyle(Color.primary)
                            Text(choice.detail)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
                .disabled(!canEdit || saving)
            }
            InlineError(error)
            if !canEdit {
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can change call screening.")
            }
        }
    }

    private func save(_ value: String) {
        error = nil
        saving = true
        Task {
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["call_screening": .string(value)])
                )
                onCompanyUpdated(updated)
                scope.showMessage("Call screening updated.")
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

// MARK: - Caller ID

private struct CallerIdCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var display: String
    @State private var lookup: Bool
    @State private var saving = false
    @State private var error: String?

    init(scope: SettingsScope, company: CompanyView, onCompanyUpdated: @escaping @MainActor (CompanyView) -> Void) {
        self.scope = scope
        self.company = company
        self.onCompanyUpdated = onCompanyUpdated
        _display = State(initialValue: company.cnam_display_name ?? "")
        _lookup = State(initialValue: company.caller_id_lookup)
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var trimmed: String { display.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var dirty: Bool {
        trimmed != (company.cnam_display_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            || lookup != company.caller_id_lookup
    }

    private var cnamInvalid: Bool { !trimmed.isEmpty && !isValidCnam(trimmed) }

    private var placeholder: String {
        String(company.name.filter { $0.isLetter || $0.isNumber || $0 == " " }.prefix(15))
    }

    var body: some View {
        SettingsCard(
            title: "Caller ID",
            description: "What people see when you call them, and what you see when "
                + "they call you."
        ) {
            if canEdit {
                TextField(placeholder, text: Binding(
                    get: { display },
                    set: { next in
                        if next.count <= 15 { display = next }
                    }
                ))
                .textFieldStyle(.roundedBorder)
                .disabled(saving)
                Text(
                    cnamInvalid
                        ? "1 to 15 letters, digits, or spaces."
                        : "Shown on US caller ID when you call customers — letters, "
                            + "digits, and spaces, 15 characters max. Carriers take 1–3 "
                            + "days to pick up a change, and Canadian display names are set "
                            + "by the receiving carrier, so this mainly helps your US calls."
                )
                .font(.caption)
                .foregroundStyle(cnamInvalid ? AnyShapeStyle(BrandColor.destructive) : AnyShapeStyle(.secondary))
                .padding(.top, 2)
            } else {
                Text(trimmed.isEmpty ? "No display name set." : trimmed)
                    .font(.body)
            }
            LabeledToggleRow(
                label: "Look up who's calling",
                supporting: "Shows the caller's network-registered name on incoming calls "
                    + "when they aren't in your contacts yet.",
                isOn: lookup,
                enabled: canEdit && !saving
            ) { lookup = $0 }
            InlineError(error)
            if canEdit {
                if dirty {
                    Button(saving ? "Saving…" : "Save caller ID") { save() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(saving)
                        .padding(.top, 10)
                }
            } else {
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can change caller ID settings.")
            }
        }
    }

    private func save() {
        if cnamInvalid {
            error = "The display name must be 1 to 15 letters, digits, or spaces."
            return
        }
        error = nil
        saving = true
        let body = JSONValue.object([
            "cnam_display_name": trimmed.isEmpty ? .null : .string(trimmed),
            "caller_id_lookup": .bool(lookup),
        ])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
                scope.showMessage("Caller ID saved.")
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

// MARK: - Minutes footer

/// The quiet fair-use line — live figures from GET /v1/usage, hidden if it fails.
private struct MinutesFooter: View {
    let scope: SettingsScope

    @State private var usage: Usage?

    var body: some View {
        Group {
            if let voice = usage?.voice, voice.included_minutes > 0 {
                Text(
                    "Your plan includes \(groupDigits(voice.included_minutes)) "
                        + "calling minutes a month, both directions."
                        + (voice.overage_billed
                            ? " Past that, extra minutes bill at 1¢ each up to your spending cap."
                            : "")
                        + " Details live in Settings › Usage."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
            }
        }
        .task(id: scope.companyId) {
            usage = try? await scope.repo.usage(scope.companyId)
        }
    }
}
