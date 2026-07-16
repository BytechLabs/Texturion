import SwiftUI
import UIKit

/// The 'You' sheet (#100): workspace tile + copyable numbers, workspace
/// switcher (multi-membership only), theme, sign out. Calls/Settings entries
/// land with their feature passes (#161/#163).
@MainActor
struct AccountSheet: View {
    @Bindable var prefs: AppPrefs
    let me: Me
    let companyId: String
    let onSwitchWorkspace: @MainActor (String) -> Void
    let onSignOut: @MainActor () -> Void

    @Environment(\.dismiss) private var dismiss

    private var membership: Membership? {
        me.memberships.first { $0.company_id == companyId }
    }

    private var displayName: String {
        me.display_name.isBlank ? (me.memberships.first?.name ?? "You") : me.display_name
    }

    private var activeNumbers: [PhoneNumberSummary] {
        me.company?.numbers.filter {
            $0.status == NumberStatus.active && $0.number_e164 != nil
        } ?? []
    }

    var body: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    InitialsAvatar(name: me.display_name.isBlank ? nil : me.display_name)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(displayName)
                            .font(.headline)
                        if let membership {
                            Text("\(membership.name) · \(membership.role)")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .listRowSeparator(.hidden)

                // Workspace numbers with copy buttons.
                ForEach(activeNumbers, id: \.id) { number in
                    HStack {
                        Text(formatPhone(number.number_e164))
                            .font(.body)
                        Spacer()
                        Button {
                            UIPasteboard.general.string = number.number_e164 ?? ""
                        } label: {
                            Image(systemName: "doc.on.doc")
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Copy number")
                    }
                }
            }

            // Workspace switcher only when >1 membership.
            if me.memberships.count > 1 {
                Section("Workspaces") {
                    ForEach(me.memberships, id: \.company_id) { workspace in
                        Button {
                            guard workspace.company_id != companyId else { return }
                            onSwitchWorkspace(workspace.company_id)
                            dismiss()
                        } label: {
                            HStack(spacing: 10) {
                                InitialsAvatar(name: workspace.name, size: 30)
                                Text(workspace.name)
                                    .foregroundStyle(.primary)
                                Spacer()
                                if workspace.company_id == companyId {
                                    Text("Current")
                                        .font(.caption)
                                        .foregroundStyle(BrandColor.petrol)
                                }
                            }
                        }
                        .disabled(workspace.company_id == companyId)
                    }
                }
            }

            Section("Theme") {
                Picker("Theme", selection: $prefs.theme) {
                    Text("System").tag(AppPrefs.Theme.system)
                    Text("Light").tag(AppPrefs.Theme.light)
                    Text("Dark").tag(AppPrefs.Theme.dark)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            Section {
                Button("Sign out", role: .destructive) {
                    onSignOut()
                    dismiss()
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
