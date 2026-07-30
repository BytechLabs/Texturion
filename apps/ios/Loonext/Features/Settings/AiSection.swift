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

    private var canEdit: Bool { SettingsRoleGate.canManageAiSettings(scope.role) }

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
            Text(
                "Lou is the assistant built into Loonext. It drafts replies and "
                    + "fills in task details from what a customer already wrote. "
                    + "Every suggestion is yours to review and edit; Lou never sends "
                    + "anything on its own."
            )
            .font(.golos(12.5))
            .foregroundStyle(BrandColor.muted600)
            .padding(.horizontal, 20)
            .padding(.top, 4)
            .padding(.bottom, 2)

            SettingsCard(title: "When you make a task from a message") {
                VStack(alignment: .leading, spacing: 0) {
                    LabeledToggleRow(
                        label: "Suggest an address",
                        supporting: "Read a job location out of the message (or fall "
                            + "back to the contact's address) and pre-fill the task's "
                            + "address. It shows where each part came from; you can "
                            + "edit or clear it before saving.",
                        isOn: settings.enrich_task_address,
                        enabled: canEdit && !saving,
                        onChange: {
                            save(
                                address: $0,
                                due: settings.enrich_task_due,
                                replies: settings.suggest_replies,
                                transcribe: settings.transcribe_voicemail,
                                intake: settings.voicemail_intake
                            )
                        }
                    )
                    RowDivider()
                    LabeledToggleRow(
                        label: "Suggest a due date & time",
                        supporting: "Turn phrases like \u{201C}tomorrow at 2pm\u{201D} "
                            + "or \u{201C}next Tuesday\u{201D} into a due date in your "
                            + "workspace's timezone. Always editable before you save.",
                        isOn: settings.enrich_task_due,
                        enabled: canEdit && !saving,
                        onChange: {
                            save(
                                address: settings.enrich_task_address,
                                due: $0,
                                replies: settings.suggest_replies,
                                transcribe: settings.transcribe_voicemail,
                                intake: settings.voicemail_intake
                            )
                        }
                    )
                }
            }

            SettingsCard(title: "What Lou knows about your business") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(
                        "One sentence, in your words. Without it Lou will not say "
                            + "what your business does, because anything it said would "
                            + "be guesswork. With it, drafts can answer \"do you do "
                            + "X?\" honestly."
                    )
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.muted600)

                    // Held locally while typing and saved when focus leaves, so
                    // a settings screen does not write per keystroke and a
                    // half-typed sentence never reaches a draft.
                    TextField(
                        "We paint houses and do small renovations in Calgary.",
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

                    Text("\(description.count) / \(businessDescriptionMax)")
                        .font(.golos(10.5))
                        .foregroundStyle(BrandColor.muted500)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }

            SettingsCard(title: "When you reply to a customer") {
                LabeledToggleRow(
                    label: "Let Lou draft replies",
                    supporting: "Offer a few short replies you can edit before "
                        + "sending, drawn from the conversation so far. Start typing "
                        + "and they finish what you started instead.",
                    isOn: settings.suggest_replies,
                    enabled: canEdit && !saving,
                    onChange: {
                        save(
                            address: settings.enrich_task_address,
                            due: settings.enrich_task_due,
                            replies: $0,
                            transcribe: settings.transcribe_voicemail,
                            intake: settings.voicemail_intake
                        )
                    }
                )
            }

            SettingsCard(title: "When someone leaves a voicemail") {
                LabeledToggleRow(
                    label: "Let Lou write voicemails down",
                    supporting: "Show what a voicemail says next to the recording, "
                        + "so you can read it when playing it isn't an option. The "
                        + "recording is always kept either way.",
                    isOn: settings.transcribe_voicemail,
                    enabled: canEdit && !saving,
                    onChange: {
                        save(
                            address: settings.enrich_task_address,
                            due: settings.enrich_task_due,
                            replies: settings.suggest_replies,
                            transcribe: $0,
                            intake: settings.voicemail_intake
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
                    label: "Ask callers what the job is",
                    supporting: "Your greeting adds one line asking for the problem "
                        + "and the address, and says a machine writes the answer "
                        + "down. Lou then shows what they said above the recording. "
                        + "Nothing books anything and nobody is put through a menu "
                        + "\u{2014} it is still a voicemail, with a better question "
                        + "in front of it.",
                    isOn: settings.voicemail_intake,
                    enabled: canEdit && !saving,
                    onChange: {
                        save(
                            address: settings.enrich_task_address,
                            due: settings.enrich_task_due,
                            replies: settings.suggest_replies,
                            transcribe: settings.transcribe_voicemail,
                            intake: $0
                        )
                    }
                )
            }

            if !canEdit {
                ReadOnlyLine("Only owners and admins can change these.")
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

    private func save(
        address: Bool,
        due: Bool,
        replies: Bool,
        transcribe: Bool,
        intake: Bool
    ) {
        guard case .ready(let previous) = state else { return }
        state = .ready(
            CompanyAiSettings(
                enrich_task_address: address,
                enrich_task_due: due,
                suggest_replies: replies,
                business_description: previous.business_description,
                transcribe_voicemail: transcribe,
                voicemail_intake: intake
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
                    voicemailIntake: intake
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
