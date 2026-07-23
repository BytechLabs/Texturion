import SwiftUI

/// The default missed-call text-back shown as the placeholder (web parity).
let defaultMctbMessage =
    "Sorry we missed your call! This is {business_name}. Reply here with your address "
        + "and what you need, and we'll get you booked in."

/// #192: the template that actually sends for a (possibly blank) local edit. A
/// blank message is legal and resolves to the server's effective template
/// (custom else the shared default), falling back to the bundled default — the
/// toggle, never the message, decides whether the text-back fires.
func mctbSendTemplate(message: String, effectiveMessage: String?) -> String {
    let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty { return trimmed }
    return effectiveMessage ?? defaultMctbMessage
}

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

/// #192 autosave state: mirrors the Android savedState (idle/saving/saved).
private enum TextBackSaveState {
    case idle
    case saving
    case saved
}

private struct TextBackCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var enabled: Bool
    @State private var message: String
    /// Trimmed text last persisted — the autosave no-ops until it changes.
    @State private var lastSaved: String
    @State private var saveState: TextBackSaveState = .idle
    @State private var error: String?

    init(scope: SettingsScope, company: CompanyView, onCompanyUpdated: @escaping @MainActor (CompanyView) -> Void) {
        self.scope = scope
        self.company = company
        self.onCompanyUpdated = onCompanyUpdated
        _enabled = State(initialValue: company.mctb_enabled)
        _message = State(initialValue: company.mctb_message ?? "")
        _lastSaved = State(
            initialValue: (company.mctb_message ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var trimmed: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// #192: a blank message is legal and sends the shared product default. The
    /// live preview shows the local edit, else the server-resolved effective
    /// template (custom else default), falling back to the bundled default.
    private var previewTemplate: String {
        mctbSendTemplate(message: message, effectiveMessage: company.mctb_effective_message)
    }

    private var savingStatus: String {
        switch saveState {
        case .saving: " · Saving…"
        case .saved: " · Saved"
        case .idle: ""
        }
    }

    var body: some View {
        SettingsCard(
            title: "Text back a missed call",
            description: "When a call to your business number goes unanswered, we send the "
                + "caller one text so they can book by reply, instead of calling the next "
                + "number on their list."
        ) {
            // The toggle alone decides WHETHER the text-back fires; a blank
            // message means the default ships. The flip is optimistic, reverted
            // with the cause if the PATCH fails.
            LabeledToggleRow(
                label: "Text back missed calls",
                supporting: "Fires once per caller when a call goes unanswered.",
                isOn: enabled,
                enabled: canEdit
            ) { next in
                enabled = next
                error = nil
                Task {
                    do {
                        let updated = try await scope.repo.updateCompany(
                            scope.companyId,
                            patch: .object(["mctb_enabled": .bool(next)])
                        )
                        onCompanyUpdated(updated)
                    } catch {
                        enabled = !next
                        self.error = error.userMessage
                    }
                }
            }
            if enabled {
                if canEdit {
                    TextField(defaultMctbMessage, text: Binding(
                        get: { message },
                        set: { next in
                            if next.count <= 1000 { message = next }
                        }
                    ), axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3 ... 8)
                    .padding(.top, 6)
                    Text(
                        "Leave it empty to send the default. "
                            + "{business_name} fills in automatically." + savingStatus
                    )
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
                        previewTemplate,
                        contactName: nil,
                        businessName: company.name
                    )
                )
            }
            InlineError(error)
            if !canEdit {
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can change the missed-call text-back.")
            }
        }
        // #192 debounced autosave: a fresh keystroke cancels this task via
        // .task(id:) and starts the 800ms wait over. A blank message persists
        // as null, which the server resolves back to the shared default.
        .task(id: message) {
            guard canEdit else { return }
            guard trimmed != lastSaved else { return }
            try? await Task.sleep(for: .milliseconds(800))
            if Task.isCancelled { return }
            saveState = .saving
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["mctb_message": trimmed.isEmpty ? .null : .string(trimmed)])
                )
                lastSaved = trimmed
                error = nil
                saveState = .saved
                onCompanyUpdated(updated)
            } catch {
                saveState = .idle
                self.error = error.userMessage
            }
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
        detail: "The carrier's verdict shows on the call as “Spam likely”, but every "
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

/// #193: the change awaiting confirmation — value nil = back to the
/// company-name default.
private struct CallerIdChange {
    let value: String?
}

/// #193 mirror of the server's sanitizer (telnyx/voice.ts): the company name
/// reduced to the carrier CNAM alphabet — punctuation drops, whitespace
/// collapses, 15-char cut, no trailing space. Empty when nothing survives.
func cnamFromCompanyName(_ name: String) -> String {
    let alnum = name.replacingOccurrences(
        of: "[^A-Za-z0-9 ]+", with: " ", options: .regularExpression
    )
    let collapsed = alnum
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespaces)
    return String(collapsed.prefix(15)).trimmingCharacters(in: .whitespaces)
}

/// #193: how long a submitted CNAM change reads as "on its way" (carriers take
/// 1 to 3 days and report no completion, so this mirrors that window).
private let cnamPropagationSeconds: TimeInterval = 3 * 24 * 60 * 60

func cnamChangePending(submittedAt: String?, now: Date = Date()) -> Bool {
    guard let submittedAt, let submitted = parseWireTimestamp(submittedAt) else { return false }
    return now.timeIntervalSince(submitted) < cnamPropagationSeconds
}

/// #193: caller ID defaults to the company name platform-wide. The card shows
/// the server-resolved EFFECTIVE name; changing it is an explicit Change flow
/// with a confirmation step, because CNAM changes crawl through carrier
/// databases for days with no completion signal. The inbound name dip stays a
/// switch that saves on flip.
private struct CallerIdCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var editing = false
    @State private var draft = ""
    @State private var confirming: CallerIdChange?
    @State private var saving = false
    @State private var error: String?

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var usingCompanyName: Bool { company.caller_id_source == "company_name" }
    private var trimmedDraft: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var draftInvalid: Bool { !trimmedDraft.isEmpty && !isValidCnam(trimmedDraft) }

    var body: some View {
        SettingsCard(
            title: "Caller ID",
            description: "What people see when you call them, and what you see when "
                + "they call you."
        ) {
            Text("Your outbound display name")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.primary)
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(company.caller_id_effective ?? "No display name")
                        .font(.body)
                    Text(usingCompanyName ? "Using your company name" : "Custom display name")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if canEdit && !editing {
                    Button("Change") {
                        draft = company.cnam_display_name ?? ""
                        error = nil
                        confirming = nil
                        editing = true
                    }
                    .buttonStyle(.bordered)
                    .tint(BrandColor.olive)
                    .disabled(saving)
                }
            }
            .padding(.top, 4)
            if cnamChangePending(submittedAt: company.cnam_submitted_at) {
                Text(
                    "Caller ID update submitted. Carriers usually show the new name "
                        + "within 1 to 3 days."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
            }

            if editing && confirming == nil {
                TextField(cnamFromCompanyName(company.name), text: Binding(
                    get: { draft },
                    set: { next in
                        if next.count <= 15 { draft = next }
                    }
                ))
                .textFieldStyle(.roundedBorder)
                .disabled(saving)
                .padding(.top, 10)
                Text(
                    draftInvalid
                        ? "1 to 15 letters, digits, or spaces."
                        : "Shown on US caller ID when you call customers. Letters, "
                            + "digits, and spaces, 15 characters max. Canadian display "
                            + "names are set by the receiving carrier, so this mainly "
                            + "helps your US calls."
                )
                .font(.caption)
                .foregroundStyle(draftInvalid ? AnyShapeStyle(BrandColor.destructive) : AnyShapeStyle(.secondary))
                .padding(.top, 2)
                if !usingCompanyName {
                    Button("Use company name instead") { confirming = CallerIdChange(value: nil) }
                        .buttonStyle(.borderless)
                        .tint(BrandColor.olive)
                        .disabled(saving)
                }
                HStack(spacing: 8) {
                    Button("Review change") {
                        if draftInvalid || trimmedDraft.isEmpty {
                            error = "The display name must be 1 to 15 letters, digits, or spaces."
                            return
                        }
                        if trimmedDraft == company.cnam_display_name {
                            editing = false
                            return
                        }
                        error = nil
                        confirming = CallerIdChange(value: trimmedDraft)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(saving)
                    Button("Cancel") { editing = false }
                        .buttonStyle(.bordered)
                        .disabled(saving)
                }
                .padding(.top, 4)
            }

            if let change = confirming {
                let target = change.value ?? cnamFromCompanyName(company.name)
                VStack(alignment: .leading, spacing: 2) {
                    Text(
                        "Update your caller ID to \"\(target)\""
                            + (change.value == nil ? " (your company name)?" : "?")
                    )
                    .font(.body)
                    Text(
                        "Carriers refresh their name databases on their own schedule, "
                            + "so the new name can take a few days to show on calls."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
                    HStack(spacing: 8) {
                        Button(saving ? "Submitting…" : "Update caller ID") { submit(change) }
                            .buttonStyle(.borderedProminent)
                            .tint(BrandColor.olive)
                            .disabled(saving)
                        Button("Go back") { confirming = nil }
                            .buttonStyle(.bordered)
                            .disabled(saving)
                    }
                    .padding(.top, 8)
                }
                .padding(.top, 10)
            }

            LabeledToggleRow(
                label: "Look up who's calling",
                supporting: "Shows the caller's network-registered name on incoming calls "
                    + "when they aren't in your contacts yet.",
                isOn: company.caller_id_lookup,
                enabled: canEdit && !saving
            ) { saveLookup($0) }
            InlineError(error)
            if !canEdit {
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can change caller ID settings.")
            }
        }
    }

    private func submit(_ change: CallerIdChange) {
        error = nil
        saving = true
        let body = JSONValue.object([
            "cnam_display_name": change.value.map { JSONValue.string($0) } ?? .null,
        ])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
                editing = false
                confirming = nil
                scope.showMessage("Caller ID update submitted to carriers.")
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }

    private func saveLookup(_ next: Bool) {
        error = nil
        saving = true
        Task {
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["caller_id_lookup": .bool(next)])
                )
                onCompanyUpdated(updated)
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
