import SwiftUI

/// #214 Settings → AI. Per-enrichment opt-in: when a teammate makes a task from
/// a message, optionally infer a structured job address and/or a due date/time
/// from the text (Cloudflare Workers AI). Every inference is a SUGGESTION the
/// person reviews before saving — nothing is auto-applied. Default OFF (it costs
/// money and the model sees message text). Reads are member-visible; the toggle
/// WRITES are admin-only (the server 403s a member; the UI disables + notes it).
/// Mirrors the web AI settings page.
@MainActor
struct AiSectionView: View {
    let scope: SettingsScope

    @State private var state: LoadState<CompanyAiSettings> = .loading
    @State private var saving = false
    @State private var description = ""
    @FocusState private var descriptionFocused: Bool
    @State private var reloadKey = 0

    @Environment(\.appLocale) private var appLocale

    private var canEdit: Bool { SettingsRoleGate.canManageAiSettings(scope.role) }

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading()
                    .frame(maxWidth: .infinity, minHeight: 220)
            case .failed(let message):
                CenteredError(message: message) { reloadKey += 1 }
                    .frame(maxWidth: .infinity, minHeight: 220)
            case .ready(let settings):
                content(settings)
            }
        }
        .task(id: "\(scope.companyId)|\(reloadKey)") { await load() }
    }

    @ViewBuilder
    private func content(_ settings: CompanyAiSettings) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(t("settings.aiIntro"))
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted600)
                .padding(.horizontal, 20)
                .padding(.top, 4)
                .padding(.bottom, 2)

            SettingsCard(title: t("settings.aiTaskCard")) {
                VStack(alignment: .leading, spacing: 0) {
                    LabeledToggleRow(
                        label: t("settings.aiSuggestAddress"),
                        supporting: t("settings.aiSuggestAddressHelp"),
                        isOn: settings.enrich_task_address,
                        enabled: canEdit && !saving,
                        onChange: {
                            save(
                                address: $0,
                                due: settings.enrich_task_due,
                                replies: settings.suggest_replies,
                                transcribe: settings.transcribe_voicemail,
                                intake: settings.voicemail_intake,
                                wrapup: settings.call_wrapup,
                                catchUp: settings.summarize_threads
                            )
                        }
                    )
                    RowDivider()
                    LabeledToggleRow(
                        label: t("settings.aiSuggestDue"),
                        supporting: t("settings.aiSuggestDueHelp"),
                        isOn: settings.enrich_task_due,
                        enabled: canEdit && !saving,
                        onChange: {
                            save(
                                address: settings.enrich_task_address,
                                due: $0,
                                replies: settings.suggest_replies,
                                transcribe: settings.transcribe_voicemail,
                                intake: settings.voicemail_intake,
                                wrapup: settings.call_wrapup,
                                catchUp: settings.summarize_threads
                            )
                        }
                    )
                }
            }

            SettingsCard(title: t("settings.aiBusinessCard")) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(t("settings.aiBusinessHelp"))
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.muted600)

                    // Held locally while typing and saved when focus leaves, so
                    // a settings screen does not write per keystroke and a
                    // half-typed sentence never reaches a draft.
                    TextField(
                        t("settings.aiBusinessPlaceholder"),
                        text: $description,
                        axis: .vertical
                    )
                    .lineLimit(2...4)
                    .textFieldStyle(.roundedBorder)
                    .disabled(!canEdit || saving)
                    .focused($descriptionFocused)
                    .onChange(of: description) { _, value in
                        if value.count > businessDescriptionMax {
                            description = String(value.prefix(businessDescriptionMax))
                        }
                    }
                    .onChange(of: descriptionFocused) { _, focused in
                        guard !focused, case .ready(let current) = state else { return }
                        let next = description.trimmingCharacters(in: .whitespacesAndNewlines)
                        let stored = (current.business_description ?? "")
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        if next != stored { saveDescription(next) }
                    }

                    Text(AppStrings.translate(
                        appLocale,
                        "settings.aiBusinessCount",
                        [
                            "count": "\(description.count)",
                            "max": "\(businessDescriptionMax)",
                        ]
                    ))
                        .font(.golos(10.5))
                        .foregroundStyle(BrandColor.muted500)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }

            SettingsCard(title: t("settings.aiReplyCard")) {
                LabeledToggleRow(
                    label: t("settings.aiDraftReplies"),
                    supporting: t("settings.aiDraftRepliesHelp"),
                    isOn: settings.suggest_replies,
                    enabled: canEdit && !saving,
                    onChange: {
                        save(
                            address: settings.enrich_task_address,
                            due: settings.enrich_task_due,
                            replies: $0,
                            transcribe: settings.transcribe_voicemail,
                            intake: settings.voicemail_intake,
                            wrapup: settings.call_wrapup,
                            catchUp: settings.summarize_threads
                        )
                    }
                )
            }

            SettingsCard(title: t("settings.aiVoicemailCard")) {
                LabeledToggleRow(
                    label: t("settings.aiTranscribe"),
                    supporting: t("settings.aiTranscribeHelp"),
                    isOn: settings.transcribe_voicemail,
                    enabled: canEdit && !saving,
                    onChange: {
                        save(
                            address: settings.enrich_task_address,
                            due: settings.enrich_task_due,
                            replies: settings.suggest_replies,
                            transcribe: $0,
                            intake: settings.voicemail_intake,
                            wrapup: settings.call_wrapup,
                            catchUp: settings.summarize_threads
                        )
                    }
                )
                // #367/D89. Grouped with transcription rather than given a card
                // of its own — same moment, and one is the other's input.
                // Divided, because this is the switch that changes what a
                // STRANGER hears, and the copy has to be read before it is
                // flipped.
                RowDivider()
                LabeledToggleRow(
                    label: t("settings.aiVoicemailIntake"),
                    supporting: t("settings.aiVoicemailIntakeHelp"),
                    isOn: settings.voicemail_intake,
                    enabled: canEdit && !saving,
                    onChange: {
                        save(
                            address: settings.enrich_task_address,
                            due: settings.enrich_task_due,
                            replies: settings.suggest_replies,
                            transcribe: settings.transcribe_voicemail,
                            intake: $0,
                            wrapup: settings.call_wrapup,
                            catchUp: settings.summarize_threads
                        )
                    }
                )
            }

            // #507/D117. Its own card rather than a row under voicemail: the
            // two share a microphone and nothing else, and filing them together
            // is the arrangement most likely to leave somebody thinking this
            // one reaches the caller.
            //
            // The supporting copy is doing real work. It names the moment (the
            // call is over), whose voice it is (yours), what starts it (a
            // button you hold) and what it will not do (the call itself). Any
            // of those left out is a sentence a member could read as "Loonext
            // hears my calls", which would be false — and this card is exactly
            // where somebody who believed that would come looking.
            SettingsCard(title: t("settings.aiWrapUpCard")) {
                LabeledToggleRow(
                    label: t("settings.aiWrapUp"),
                    supporting: t("settings.aiWrapUpHelp"),
                    isOn: settings.call_wrapup,
                    enabled: canEdit && !saving,
                    onChange: {
                        save(
                            address: settings.enrich_task_address,
                            due: settings.enrich_task_due,
                            replies: settings.suggest_replies,
                            transcribe: settings.transcribe_voicemail,
                            intake: settings.voicemail_intake,
                            wrapup: $0,
                            catchUp: settings.summarize_threads
                        )
                    }
                )
            }

            // #247. Its own card, and last, because it is the only Lou setting
            // about a conversation that has ALREADY happened — every other one
            // sits at a moment somebody is about to write something. It is also
            // the largest thing this product sends a model, so the copy has to
            // say what leaves and what the catch-up is not.
            //
            // "Never a record" is the load-bearing sentence. A wrong summary is
            // worse than none, because a crew ACTS on it, and this card is
            // exactly where somebody deciding whether to trust it would look.
            SettingsCard(title: t("settings.aiThreadCard")) {
                LabeledToggleRow(
                    label: t("settings.aiCatchUp"),
                    // The thresholds are interpolated from the shipped
                    // constants, never typed: a number in settings copy that
                    // disagrees with the rule is how somebody learns not to
                    // trust the settings screen.
                    supporting: AppStrings.translate(
                        appLocale,
                        "settings.aiCatchUpHelp",
                        [
                            "messages": "\(threadSummaryMinMessages)",
                            "days": "\(threadSummaryIdleDays)",
                        ]
                    ),
                    isOn: settings.summarize_threads,
                    enabled: canEdit && !saving,
                    onChange: {
                        save(
                            address: settings.enrich_task_address,
                            due: settings.enrich_task_due,
                            replies: settings.suggest_replies,
                            transcribe: settings.transcribe_voicemail,
                            intake: settings.voicemail_intake,
                            wrapup: settings.call_wrapup,
                            catchUp: $0
                        )
                    }
                )
            }

            if !canEdit {
                ReadOnlyLine(t("settings.aiReadOnly"))
                    .padding(.horizontal, 20)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Load + save

    private func load() async {
        if case .ready = state {} else { state = .loading }
        do {
            let loaded = try await scope.repo.aiSettings(scope.companyId)
            state = .ready(loaded)
            description = loaded.business_description ?? ""
        } catch {
            if case .ready = state {
                scope.showMessage(error.userMessage)
            } else {
                state = .failed(error.userMessage)
            }
        }
    }

    /// Optimistic flip + PATCH (the whole pair is sent). On failure, roll back
    /// and surface the server's message.
    /// Save just the description, leaving every toggle exactly as it is.
    private func saveDescription(_ next: String) {
        guard case .ready(let previous) = state else { return }
        saving = true
        Task {
            do {
                let saved = try await scope.repo.updateAiSettings(
                    scope.companyId,
                    enrichAddress: previous.enrich_task_address,
                    enrichDue: previous.enrich_task_due,
                    suggestReplies: previous.suggest_replies,
                    transcribeVoicemail: previous.transcribe_voicemail,
                    voicemailIntake: previous.voicemail_intake,
                    callWrapup: previous.call_wrapup,
                    summarizeThreads: previous.summarize_threads,
                    businessDescription: next
                )
                state = .ready(saved)
            } catch {
                state = .ready(previous)
                description = previous.business_description ?? ""
                scope.showMessage(error.userMessage)
            }
            saving = false
        }
    }

    /// Every toggle on every save, none of them defaulted.
    ///
    /// The whole pair-of-booleans shape is deliberate: the PATCH reads an ABSENT
    /// field as "leave it alone", so a defaulted parameter here would let a call
    /// site that forgot one silently write the default over somebody's choice. A
    /// new toggle is meant to break every call site until each has said what it
    /// means to do with it.
    private func save(
        address: Bool,
        due: Bool,
        replies: Bool,
        transcribe: Bool,
        intake: Bool,
        wrapup: Bool,
        catchUp: Bool
    ) {
        guard case .ready(let previous) = state else { return }
        state = .ready(
            CompanyAiSettings(
                enrich_task_address: address,
                enrich_task_due: due,
                suggest_replies: replies,
                business_description: previous.business_description,
                transcribe_voicemail: transcribe,
                voicemail_intake: intake,
                call_wrapup: wrapup,
                summarize_threads: catchUp
            )
        )
        saving = true
        Task {
            do {
                let saved = try await scope.repo.updateAiSettings(
                    scope.companyId,
                    enrichAddress: address,
                    enrichDue: due,
                    suggestReplies: replies,
                    transcribeVoicemail: transcribe,
                    voicemailIntake: intake,
                    callWrapup: wrapup,
                    summarizeThreads: catchUp
                )
                state = .ready(saved)
            } catch {
                state = .ready(previous)
                scope.showMessage(error.userMessage)
            }
            saving = false
        }
    }
}
