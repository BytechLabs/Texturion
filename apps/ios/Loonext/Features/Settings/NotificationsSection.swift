import SwiftUI

/// #388: the wording is deliberately the SAME sentence as web and Android.
/// Three hand-written descriptions of one behaviour is how three clients end
/// up explaining a feature three different ways, and this one is about when a
/// customer's phone is answered — the copy has to be exact.
///
/// Two and five mirror LEAD_CHASE_NUDGE_MINUTES / LEAD_CHASE_WIDEN_MINUTES in
/// packages/shared/src/lead-chase.ts, which the server reads. Swift cannot
/// import them; if they ever change, this string and the Kotlin one change
/// with them.
private let nudgeMinutes = 2
private let widenMinutes = 5

/// Notifications (#163): hosts #162's embeddable card — per-user email/push
/// toggles plus this device's push-permission state (system prompt /
/// settings deep-link / honest "unavailable in this build" arm, with the
/// #143 self-healing token re-upsert) — and states the one exception
/// plainly: billing and registration emails always reach owners and admins.
///
/// #388 adds the workspace-wide lead-chasing card BELOW the personal one, in
/// its own card and labelled with its scope. The card above is about this
/// person and this device; silently mixing the two would leave a member
/// thinking they had turned something off for themselves.
@MainActor
struct NotificationsSectionView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            NotificationPrefsCard(graph: scope.graph, companyId: scope.companyId)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color(.separator).opacity(0.5), lineWidth: 1)
        )
        .padding(.horizontal, 16)
        .padding(.vertical, 6)

        LeadChaseCardView(
            scope: scope,
            company: company,
            onCompanyUpdated: onCompanyUpdated
        )

        Text(
            "Billing, usage, and registration emails always go to owners and admins — "
                + "they can't be turned off."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
    }
}

@MainActor
private struct LeadChaseCardView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var saving = false
    @State private var error: String?

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }

    var body: some View {
        SettingsCard(
            title: "Chasing unanswered leads",
            description: "Applies to everyone in the workspace. Only owners and admins "
                + "can change it."
        ) {
            LabeledToggleRow(
                label: "Buzz again after \(nudgeMinutes) minutes",
                supporting: "When a new customer texts and nobody has replied, send the "
                    + "same people one more notification. A phone in a pocket misses the "
                    + "first one, and the job usually goes to whoever answers first.",
                isOn: company.lead_chase_enabled,
                enabled: canEdit && !saving
            ) { save(chase: $0, crew: company.lead_chase_crew_enabled) }

            LabeledToggleRow(
                label: "Tell the whole crew after \(widenMinutes) minutes",
                supporting: "If a conversation is assigned to one person and they still "
                    + "haven't replied, notify everyone who can see it. This one reaches "
                    + "people who weren't told the first time, so it's off unless you "
                    + "turn it on.",
                isOn: company.lead_chase_crew_enabled,
                // Off entirely when chasing is off: the second rung is only
                // ever reached through the first, so leaving it live would let
                // an owner switch on something that cannot fire.
                enabled: canEdit && company.lead_chase_enabled && !saving
            ) { save(chase: company.lead_chase_enabled, crew: $0) }

            InlineError(error)

            Text(
                "Only during your business hours, and never to anyone who has turned "
                    + "their own notifications off. Outside hours your away reply answers "
                    + "instead."
            )
            .font(.golos(12))
            .foregroundStyle(BrandColor.muted600)
            .padding(.top, 8)

            if !canEdit {
                Text("Only owners and admins can change this.")
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                    .padding(.top, 4)
            }
        }
    }

    // Saves on toggle rather than behind a Save button, unlike the away
    // message next door: there is no text to get wrong and no preview to
    // check, so a two-step commit would be ceremony around a switch.
    private func save(chase: Bool, crew: Bool) {
        error = nil
        saving = true
        let body = JSONValue.object([
            "lead_chase_enabled": .bool(chase),
            "lead_chase_crew_enabled": .bool(crew),
        ])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}
