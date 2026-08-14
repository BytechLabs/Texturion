import SwiftUI

/// Member picker: a sheet with a search field over the active members
/// (GET /v1/members), a "(you)" marker, and an optional Unassigned entry.
/// Callers own the fetch — the sheet is pure UI, mirroring the Android
/// MemberPickerSheet 1:1.
@MainActor
struct MemberPickerSheet: View {
    let members: [Member]
    let meUserId: String
    let selectedUserId: String?
    let showUnassigned: Bool
    let onPick: @MainActor (_ userId: String?) -> Void

    @State private var query = ""
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale

    private var matches: [Member] {
        let active = members.filter { $0.deactivated_at == nil }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return active }
        return active.filter { $0.display_name.localizedCaseInsensitiveContains(trimmed) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.scaled(14, weight: .medium))
                    .foregroundStyle(BrandColor.muted400)
                TextField(
                    AppStrings.translate(appLocale, "contactsTasks.searchTeammates"),
                    text: $query
                )
                    .font(.golos(13))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 10)
            .background(BrandColor.paper, in: Capsule())
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            List {
                if showUnassigned && query.isBlank {
                    pickerRow(
                        name: AppStrings.translate(appLocale, "contactsTasks.unassigned"),
                        avatarName: nil,
                        selected: selectedUserId == nil
                    ) {
                        onPick(nil)
                        dismiss()
                    }
                }
                ForEach(matches, id: \.user_id) { member in
                    let base = member.display_name.isBlank
                        ? AppStrings.translate(appLocale, "contactsTasks.teammate")
                        : member.display_name
                    let youSuffix = AppStrings.translate(
                        appLocale, "contactsTasks.youSuffix"
                    )
                    pickerRow(
                        name: member.user_id == meUserId ? base + youSuffix : base,
                        avatarName: member.display_name.isBlank ? nil : member.display_name,
                        selected: selectedUserId == member.user_id
                    ) {
                        onPick(member.user_id)
                        dismiss()
                    }
                }
                if matches.isEmpty {
                    Text(AppStrings.translate(appLocale, "contactsTasks.noTeammatesMatch"))
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.muted500)
                        .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        .presentationDetents([.medium, .large])
    }

    private func pickerRow(
        name: String,
        avatarName: String?,
        selected: Bool,
        onTap: @escaping @MainActor () -> Void
    ) -> some View {
        HStack(spacing: 12) {
            if let avatarName {
                InitialsAvatar(name: avatarName, size: 32)
            } else {
                Color.clear.frame(width: 32, height: 32)
            }
            Text(name)
                .font(.golos(13.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Spacer()
            if selected {
                Image(systemName: "checkmark")
                    .foregroundStyle(BrandColor.olive)
                    .accessibilityLabel(
                        AppStrings.translate(appLocale, "contactsTasks.selected")
                    )
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
    }
}

// MARK: - Previews

#Preview("Member picker") {
    MemberPickerSheet(
        members: [
            Member(
                id: "mb1",
                user_id: "u1",
                role: MemberRole.owner,
                deactivated_at: nil,
                created_at: "2026-06-01T12:00:00Z",
                display_name: "Sam Carpenter"
            ),
            Member(
                id: "mb2",
                user_id: "u2",
                role: MemberRole.member,
                deactivated_at: nil,
                created_at: "2026-06-02T12:00:00Z",
                display_name: "Alex Mason"
            ),
            Member(
                id: "mb3",
                user_id: "u3",
                role: MemberRole.member,
                deactivated_at: "2026-07-01T12:00:00Z", // filtered out (deactivated)
                created_at: "2026-06-03T12:00:00Z",
                display_name: "Former Teammate"
            ),
        ],
        meUserId: "u1",
        selectedUserId: "u2",
        showUnassigned: true,
        onPick: { _ in }
    )
}
