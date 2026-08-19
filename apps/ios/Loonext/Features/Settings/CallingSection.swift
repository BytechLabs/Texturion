import SwiftUI

/// #228: the key holding the default missed-call text-back, in both languages.
///
/// THE CATALOGUE ENTRY IS THE SENT MESSAGE, not a description of it. Both
/// languages are Android's `settings.textBackDefault` character for character,
/// which took them from `packages/shared/src/locale.ts` — what the SERVER
/// actually puts on the wire. So the French reads without accents and inside
/// GSM-7, exactly as the text a customer receives does. A prettier French here
/// would preview a message this product never sends, which is worse than no
/// preview at all.
///
/// `{business_name}` is a merge field the send path fills in rather than a
/// catalogue token: `AppStrings.translate` leaves an unknown token untouched,
/// which is why the placeholder can show it and the preview can substitute it.
private let mctbDefaultKey = "settings.textBackDefault"

/// The ENGLISH default, which is what `mctbSendTemplate` falls back to.
///
/// It stays a constant rather than becoming a lookup with a locale, because it
/// is the last resort of a function with no reader in scope: `SettingsLogicTests`
/// pins `mctbSendTemplate(message: "", effectiveMessage: nil)` against it, and
/// the shipped screens never reach this branch — they hand the function the
/// reader's own default instead (see `previewTemplate`).
let defaultMctbMessage = AppStrings.translate(MessageLocale.en, mctbDefaultKey)

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

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        if onlyHostedNumbers(company) {
            Text(AppStrings.translate(appLocale, "settings.callingHostedOnly"))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 20)
                .padding(.vertical, 6)
        }
        TextBackCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        VoicemailCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
        // #309: directly under the written greeting, because it answers
        // the same question in a better way. The written one stays as the
        // zero-setup default and the runtime fallback.
        VoiceGreetingCard(scope: scope, canEdit: SettingsRoleGate.canEditWorkspace(scope.role))
        // #278: after the voicemail cards, before screening — it is a routing
        // decision about the SAME calls those describe, so it reads as a
        // qualifier on them rather than a new subject.
        AfterHoursCard(scope: scope, company: company, onCompanyUpdated: onCompanyUpdated)
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

    @Environment(\.appLocale) private var appLocale

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

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var trimmed: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The default the reader sees, rather than the English constant.
    private var readerDefault: String { t(mctbDefaultKey) }

    /// #192: a blank message is legal and sends the shared product default. The
    /// live preview shows the local edit, else the server-resolved effective
    /// template (custom else default), falling back to the reader's default.
    private var previewTemplate: String {
        mctbSendTemplate(
            message: message,
            effectiveMessage: company.mctb_effective_message ?? readerDefault
        )
    }

    private var savingStatus: String {
        switch saveState {
        case .saving: t("settings.textBackStatusSaving")
        case .saved: t("settings.textBackStatusSaved")
        case .idle: ""
        }
    }

    var body: some View {
        SettingsCard(
            title: t("settings.textBackTitle"),
            description: t("settings.textBackIntro")
        ) {
            // The toggle alone decides WHETHER the text-back fires; a blank
            // message means the default ships. The flip is optimistic, reverted
            // with the cause if the PATCH fails.
            LabeledToggleRow(
                label: t("settings.textBackSwitch"),
                supporting: t("settings.textBackSwitchHelp"),
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
            // The send gates refuse a US destination until the campaign is
            // approved, and the text-back is skipped without a trace when they
            // do. A caller who is never texted back is the whole point of the
            // feature.
            if enabled, !usSendApproved(company) {
                ReachNote(
                    text: t(
                        usTextingOff(company)
                            ? "settings.textBackUsTextingOff"
                            : "settings.textBackUsPending"
                    )
                )
            }
            if enabled {
                if canEdit {
                    TextField(readerDefault, text: Binding(
                        get: { message },
                        set: { next in
                            if next.count <= 1000 { message = next }
                        }
                    ), axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3 ... 8)
                    .padding(.top, 6)
                    Text(t("settings.textBackHint") + savingStatus)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 2)
                }
                // The server sends this with NO contact name (a missed call is
                // usually a brand-new caller) — the preview drops {first_name}
                // exactly as the wire does.
                PreviewBubble(
                    label: t("settings.textBackPreviewLabel"),
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
                ReadOnlyLine(t("settings.textBackReadOnly"))
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

    @Environment(\.appLocale) private var appLocale

    init(scope: SettingsScope, company: CompanyView, onCompanyUpdated: @escaping @MainActor (CompanyView) -> Void) {
        self.scope = scope
        self.company = company
        self.onCompanyUpdated = onCompanyUpdated
        _greeting = State(initialValue: company.voicemail_greeting ?? "")
    }

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var trimmed: String { greeting.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var dirty: Bool {
        trimmed != (company.voicemail_greeting ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The spoken default, in the WORKSPACE's language (#228).
    ///
    /// `apps/api/src/messaging/inbound-ring.ts` speaks `defaultGreeting()` to
    /// the caller, and since `8b4e052a` it picks the words from
    /// `companies.locale`. So the preview follows the workspace rather than the
    /// member reading it: an English-reading owner of a French workspace is
    /// shown the French their callers actually hear.
    ///
    /// This docblock previously argued the opposite, correctly, for as long as
    /// the server took no locale.
    private var spokenDefault: String {
        defaultVoicemailGreeting(companyName: company.name, locale: company.locale)
    }

    var body: some View {
        SettingsCard(
            title: t("settings.voicemailTitle"),
            description: t("settings.voicemailIntro")
        ) {
            if canEdit {
                TextField(spokenDefault, text: Binding(
                    get: { greeting },
                    set: { next in
                        if next.count <= 500 { greeting = next }
                    }
                ), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(2 ... 6)
                .disabled(saving)
                Text(
                    AppStrings.translate(
                        appLocale,
                        "settings.voicemailCount",
                        ["count": "\(greeting.count)"]
                    )
                )
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
            }
            PreviewBubble(
                label: t("settings.voicemailPreviewLabel"),
                text: trimmed.isEmpty ? spokenDefault : trimmed
            )
            InlineError(error)
            if canEdit {
                if dirty {
                    Button(saving ? t("common.saving") : t("settings.voicemailSaveAction")) {
                        save()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(saving)
                    .padding(.top, 10)
                }
            } else {
                Spacer().frame(height: 4)
                ReadOnlyLine(t("settings.voicemailReadOnly"))
            }
        }
    }

    private func save() {
        error = nil
        saving = true
        let locale = appLocale
        let body = JSONValue.object([
            "voicemail_greeting": trimmed.isEmpty ? .null : .string(trimmed),
        ])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
                scope.showMessage(
                    AppStrings.translate(locale, "settings.voicemailSaved")
                )
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

// MARK: - Call screening

/**
 #278 — what an inbound call does after hours.

 Hand-port of `apps/web/src/components/settings/after-hours-calls-card.tsx`
 and `CallingSection.kt`, keeping the three rules that shape it:

 - **The default is the product as it was.** #278's own devil's-advocate
   section is right that a badly-built phone tree makes a small business sound
   like a call centre, so ring-all stays the recommended shape and is first.
 - **Each option states its CONSEQUENCE.** "On-call only" is a label;
   "everyone else's phone stays quiet" is the decision being made.
 - **A setting that cannot fire says so.** With no business hours there is no
   after-hours, and an owner who picks "take a message" and watches nothing
   happen has been failed silently — the worst way to fail somebody.
 */
private struct AfterHoursCard: View {
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
    private var hoursSet: Bool {
        company.business_hours.values.contains { $0 != nil }
    }

    var body: some View {
        SettingsCard(
            title: t("settings.afterHoursTitle"),
            description: t("settings.afterHoursIntro")
        ) {
            if !hoursSet {
                Text(t("settings.afterHoursNoHours"))
                    .font(.footnote)
                    .padding(.bottom, 8)
            }
            ForEach(afterHoursChoices) { choice in
                let selected = company.after_hours_calls == choice.value
                Button {
                    guard !selected else { return }
                    save(choice.value)
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(selected ? BrandColor.olive : Color.secondary)
                            .padding(.top, 2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t(choice.labelKey))
                                .font(.body)
                                .foregroundStyle(Color.primary)
                            Text(t(choice.detailKey))
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
                ReadOnlyLine(t("settings.afterHoursReadOnly"))
            }
        }
    }

    private func save(_ value: String) {
        error = nil
        saving = true
        let locale = appLocale
        Task {
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["after_hours_calls": .string(value)])
                )
                onCompanyUpdated(updated)
                scope.showMessage(
                    AppStrings.translate(locale, "settings.afterHoursUpdated")
                )
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

/// #228: a choice is now a wire value and two catalogue KEYS.
///
/// The words moved out but the list stayed a list, deliberately: the order of
/// these three is the design (the recommended shape first), and a `ForEach` over
/// a table keeps that order in one readable place instead of spreading it down
/// the body of the card.
private struct AfterHoursChoice: Identifiable {
    let value: String
    let labelKey: String
    let detailKey: String
    var id: String { value }
}

/**
 The three shapes, in the order an owner grows through them.

 The middle option's second sentence is the one that stops somebody choosing it
 by mistake: with nobody on call it behaves like the first, because every
 uncertainty widens.
 */
private let afterHoursChoices = [
    AfterHoursChoice(
        value: "ring_everyone",
        labelKey: "settings.afterHoursRingEveryone",
        detailKey: "settings.afterHoursRingEveryoneDetail"
    ),
    AfterHoursChoice(
        value: "on_call_only",
        labelKey: "settings.afterHoursOnCallOnly",
        detailKey: "settings.afterHoursOnCallOnlyDetail"
    ),
    AfterHoursChoice(
        value: "voicemail",
        labelKey: "settings.afterHoursVoicemail",
        detailKey: "settings.afterHoursVoicemailDetail"
    ),
]

private struct ScreeningChoice: Identifiable {
    let value: String
    let labelKey: String
    let detailKey: String
    var id: String { value }
}

private let screeningChoices = [
    ScreeningChoice(
        value: CallScreening.off,
        labelKey: "settings.screeningOff",
        detailKey: "settings.screeningOffDetail"
    ),
    ScreeningChoice(
        value: CallScreening.flag,
        labelKey: "settings.screeningFlag",
        detailKey: "settings.screeningFlagDetail"
    ),
    ScreeningChoice(
        value: CallScreening.divert,
        labelKey: "settings.screeningDivert",
        detailKey: "settings.screeningDivertDetail"
    ),
]

private struct ScreeningCard: View {
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
            title: t("settings.screeningTitle"),
            description: t("settings.screeningIntro")
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
                            Text(t(choice.labelKey))
                                .font(.body)
                                .foregroundStyle(Color.primary)
                            Text(t(choice.detailKey))
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
                ReadOnlyLine(t("settings.screeningReadOnly"))
            }
        }
    }

    private func save(_ value: String) {
        error = nil
        saving = true
        let locale = appLocale
        Task {
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["call_screening": .string(value)])
                )
                onCompanyUpdated(updated)
                scope.showMessage(
                    AppStrings.translate(locale, "settings.screeningUpdated")
                )
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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var usingCompanyName: Bool { company.caller_id_source == "company_name" }
    private var trimmedDraft: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var draftInvalid: Bool { !trimmedDraft.isEmpty && !isValidCnam(trimmedDraft) }

    var body: some View {
        SettingsCard(
            title: t("settings.callerIdTitle"),
            description: t("settings.callerIdIntro")
        ) {
            Text(t("settings.callerIdOutboundHeading"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.primary)
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(company.caller_id_effective ?? t("settings.callerIdNone"))
                        .font(.body)
                    Text(
                        t(
                            usingCompanyName
                                ? "settings.callerIdUsingCompanyName"
                                : "settings.callerIdCustom"
                        )
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if canEdit && !editing {
                    Button(t("settings.callerIdChange")) {
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
                Text(t("settings.callerIdPending"))
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
                    t(
                        draftInvalid
                            ? "settings.callerIdInvalid"
                            : "settings.callerIdNewNameHelp"
                    )
                )
                .font(.caption)
                .foregroundStyle(draftInvalid ? AnyShapeStyle(BrandColor.destructive) : AnyShapeStyle(.secondary))
                .padding(.top, 2)
                if !usingCompanyName {
                    Button(t("settings.callerIdUseCompanyName")) {
                        confirming = CallerIdChange(value: nil)
                    }
                    .buttonStyle(.borderless)
                    .tint(BrandColor.olive)
                    .disabled(saving)
                }
                HStack(spacing: 8) {
                    Button(t("settings.callerIdReview")) {
                        if draftInvalid || trimmedDraft.isEmpty {
                            error = t("settings.callerIdInvalidError")
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
                    Button(t("common.cancel")) { editing = false }
                        .buttonStyle(.bordered)
                        .disabled(saving)
                }
                .padding(.top, 4)
            }

            if let change = confirming {
                let target = change.value ?? cnamFromCompanyName(company.name)
                VStack(alignment: .leading, spacing: 2) {
                    // Two whole questions rather than a stem plus a suffix: the
                    // parenthetical lands in a different place in French, and a
                    // concatenation would nail it to where English puts it.
                    Text(
                        AppStrings.translate(
                            appLocale,
                            change.value == nil
                                ? "settings.callerIdConfirmCompanyName"
                                : "settings.callerIdConfirm",
                            ["name": target]
                        )
                    )
                    .font(.body)
                    Text(t("settings.callerIdConfirmNote"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 2)
                    HStack(spacing: 8) {
                        Button(
                            saving
                                ? t("settings.callerIdSubmitting")
                                : t("settings.callerIdSubmit")
                        ) { submit(change) }
                            .buttonStyle(.borderedProminent)
                            .tint(BrandColor.olive)
                            .disabled(saving)
                        Button(t("settings.callerIdGoBack")) { confirming = nil }
                            .buttonStyle(.bordered)
                            .disabled(saving)
                    }
                    .padding(.top, 8)
                }
                .padding(.top, 10)
            }

            LabeledToggleRow(
                label: t("settings.callerIdLookup"),
                supporting: t("settings.callerIdLookupHelp"),
                isOn: company.caller_id_lookup,
                enabled: canEdit && !saving
            ) { saveLookup($0) }
            InlineError(error)
            if !canEdit {
                Spacer().frame(height: 4)
                ReadOnlyLine(t("settings.callerIdReadOnly"))
            }
        }
    }

    private func submit(_ change: CallerIdChange) {
        error = nil
        saving = true
        let locale = appLocale
        let body = JSONValue.object([
            "cnam_display_name": change.value.map { JSONValue.string($0) } ?? .null,
        ])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
                editing = false
                confirming = nil
                scope.showMessage(
                    AppStrings.translate(locale, "settings.callerIdSubmitted")
                )
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

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Group {
            if let voice = usage?.voice, voice.included_minutes > 0 {
                // Two whole sentences rather than one with a clause spliced into
                // the middle: French does not put "Past that…" where English
                // does, and gluing it between two halves would fix the word
                // order of the translation to the word order of the original.
                Text(
                    AppStrings.translate(
                        appLocale,
                        voice.overage_billed
                            ? "settings.minutesFooterOverage"
                            : "settings.minutesFooter",
                        ["minutes": groupDigits(voice.included_minutes)]
                    )
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
