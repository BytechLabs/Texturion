import SwiftUI

/// #237 — the text that stops a no-show.
///
/// Design notes, and the principles behind them:
///
/// - **OFF is the honest starting state, and it says so.** No workspace sends
///   reminders until somebody here turns them on, because seeding them would
///   start texting a live customer base automatically. So the empty card is not
///   a form waiting to be filled — it is the current, correct answer — and it
///   reads as an offer. *Applying: Smart Defaults, without applying them.*
/// - **Two offsets, and the ceiling is shown rather than enforced by a
///   refusal.** The day before, so the customer can still move it, and a couple
///   of hours out, so somebody is home. A crew that texts five times is a crew
///   whose customers stop reading.
/// - **Chunking.** One row per rule: when it goes, whether it is on, and the
///   words. A picker with merge-field chips and a preview pane would be more
///   product than this decision has.
/// - **Ethical friction where it belongs.** Removing a rule is one tap and
///   undoable by adding it back; nothing has been sent. The friction is that
///   nothing saves until Save, so an owner editing a text that reaches every
///   customer can still walk away from it.
///
/// Sits at the bottom of the hours section rather than in a section of its own:
/// every card above it answers "what do we send automatically, and in whose
/// words", and the settings list is already long enough that a two-rule form
/// does not earn another row. Mirrors the web and Android cards.
@MainActor
struct ReminderRulesCard: View {
    let scope: SettingsScope

    @State private var loaded = false
    @State private var saved: [ReminderRule] = []
    @State private var draft: [ReminderRule] = []
    @State private var suggested: [ReminderRule] = []
    @State private var cap = AppointmentReminders.rulesCap
    @State private var saving = false

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var dirty: Bool { draft != saved }

    var body: some View {
        SettingsCard(
            title: t("settingsMore.remindersTitle"),
            description: t("settingsMore.remindersDesc")
        ) {
            if !loaded {
                Text(t("settingsMore.loading"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if draft.isEmpty {
                emptyState
            } else {
                rules
            }
        }
        .task(id: scope.companyId) { await load() }
    }

    /// The honest empty state: off is a state, not a gap.
    @ViewBuilder
    private var emptyState: some View {
        Text(t("settingsMore.remindersOffBody"))
            .font(.footnote)
            .foregroundStyle(.secondary)

        if canEdit, !suggested.isEmpty {
            Spacer().frame(height: 10)
            Button(t("settingsMore.remindersSetUpUsual")) {
                draft = suggested.map { rule in
                    var copy = rule
                    copy.enabled = true
                    return copy
                }
            }
            .buttonStyle(.borderedProminent)
        }
    }

    @ViewBuilder
    private var rules: some View {
        ForEach(Array(draft.enumerated()), id: \.element.rowId) { index, rule in
            ReminderRuleRow(
                rule: rule,
                canEdit: canEdit && !saving,
                takenOffsets: draft.map(\.offset_minutes),
                onChange: { updated in draft[index] = updated },
                onRemove: { draft.remove(at: index) }
            )
        }

        if canEdit, draft.count < cap {
            Spacer().frame(height: 8)
            Button(t("settingsMore.remindersAddAnother")) {
                let free = AppointmentReminders.offsetChoices.first { choice in
                    !draft.contains { $0.offset_minutes == choice }
                } ?? 120
                draft.append(
                    ReminderRule(
                        offset_minutes: free,
                        body: suggested.count > 1 ? suggested[1].body : "",
                        enabled: true
                    )
                )
            }
            .buttonStyle(.bordered)
        }

        if draft.count >= cap {
            // The ceiling, shown rather than enforced by a refusal at save.
            Spacer().frame(height: 8)
            Text(t("settingsMore.remindersCap"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }

        if canEdit {
            Spacer().frame(height: 10)
            HStack(spacing: 8) {
                Button(t("settingsMore.remindersSave")) { Task { await commit() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(!dirty || saving)
                if dirty {
                    Button(t("settingsMore.discard")) { draft = saved }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    private func load() async {
        guard let response = try? await scope.repo.reminderRules(scope.companyId)
        else {
            loaded = true
            return
        }
        saved = response.rules
        draft = response.rules
        suggested = response.suggested
        cap = response.cap
        loaded = true
    }

    private func commit() async {
        guard canEdit, !saving else { return }
        saving = true
        defer { saving = false }
        do {
            let result = try await scope.repo.saveReminderRules(
                scope.companyId,
                rules: draft
            )
            saved = result.rules
            draft = result.rules
            scope.showMessage(
                t(
                    result.rules.isEmpty
                        ? "settingsMore.remindersNowOff"
                        : "settingsMore.remindersSaved"
                )
            )
        } catch {
            scope.showMessage(error.userMessage)
        }
    }
}

@MainActor
private struct ReminderRuleRow: View {
    let rule: ReminderRule
    let canEdit: Bool
    let takenOffsets: [Int]
    let onChange: @MainActor (ReminderRule) -> Void
    let onRemove: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                // A fixed list rather than a free number field: "how many
                // minutes before?" is a question nobody in a van wants to
                // answer, and the ones that matter are already the industry's.
                Menu(AppointmentReminders.offsetLabel(rule.offset_minutes, locale: appLocale)) {
                    ForEach(AppointmentReminders.offsetChoices, id: \.self) { minutes in
                        Button(AppointmentReminders.offsetLabel(minutes, locale: appLocale)) {
                            var updated = rule
                            updated.offset_minutes = minutes
                            onChange(updated)
                        }
                        // Two rules at the same offset is the same reminder
                        // arriving twice, which is the failure a customer
                        // notices and blames the business for.
                        .disabled(
                            minutes != rule.offset_minutes
                                && takenOffsets.contains(minutes)
                        )
                    }
                }
                .disabled(!canEdit)

                Toggle(
                    "",
                    isOn: Binding(
                        get: { rule.enabled },
                        set: { enabled in
                            var updated = rule
                            updated.enabled = enabled
                            onChange(updated)
                        }
                    )
                )
                .labelsHidden()
                .disabled(!canEdit)

                Spacer()

                if canEdit {
                    Button(t("settingsMore.remove"), role: .destructive, action: onRemove)
                        .buttonStyle(.plain)
                        .font(.footnote)
                }
            }

            TextField(
                t("settingsMore.remindersBodyLabel"),
                text: Binding(
                    get: { rule.body },
                    set: { body in
                        var updated = rule
                        updated.body = body
                        onChange(updated)
                    }
                ),
                axis: .vertical
            )
            .textFieldStyle(.roundedBorder)
            .lineLimit(2 ... 4)
            .disabled(!canEdit)
        }
        .padding(.top, 12)
    }
}
