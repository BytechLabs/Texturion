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
                "Let the app pre-fill task details from a message. Every suggestion "
                    + "is yours to review and edit before you save — nothing is sent "
                    + "or applied on its own."
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
                        onChange: { save(address: $0, due: settings.enrich_task_due) }
                    )
                    RowDivider()
                    LabeledToggleRow(
                        label: "Suggest a due date & time",
                        supporting: "Turn phrases like \u{201C}tomorrow at 2pm\u{201D} "
                            + "or \u{201C}next Tuesday\u{201D} into a due date in your "
                            + "workspace's timezone. Always editable before you save.",
                        isOn: settings.enrich_task_due,
                        enabled: canEdit && !saving,
                        onChange: { save(address: settings.enrich_task_address, due: $0) }
                    )
                }
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
            state = .ready(try await scope.repo.aiSettings(scope.companyId))
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
    private func save(address: Bool, due: Bool) {
        guard case .ready(let previous) = state else { return }
        state = .ready(CompanyAiSettings(enrich_task_address: address, enrich_task_due: due))
        saving = true
        Task {
            do {
                let saved = try await scope.repo.updateAiSettings(
                    scope.companyId, enrichAddress: address, enrichDue: due
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
