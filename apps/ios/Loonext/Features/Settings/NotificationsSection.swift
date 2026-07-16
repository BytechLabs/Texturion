import SwiftUI

/// Notifications (#163): hosts #162's embeddable card — per-user email/push
/// toggles plus this device's push-permission state (system prompt /
/// settings deep-link / honest "unavailable in this build" arm, with the
/// #143 self-healing token re-upsert) — and states the one exception
/// plainly: billing and registration emails always reach owners and admins.
@MainActor
struct NotificationsSectionView: View {
    let scope: SettingsScope

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
