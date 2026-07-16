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
                    .foregroundStyle(.secondary)
                TextField("Search teammates", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            List {
                if showUnassigned && query.isBlank {
                    pickerRow(
                        name: "Unassigned",
                        avatarName: nil,
                        selected: selectedUserId == nil
                    ) {
                        onPick(nil)
                        dismiss()
                    }
                }
                ForEach(matches, id: \.user_id) { member in
                    let base = member.display_name.isBlank ? "Teammate" : member.display_name
                    pickerRow(
                        name: member.user_id == meUserId ? "\(base) (you)" : base,
                        avatarName: member.display_name.isBlank ? nil : member.display_name,
                        selected: selectedUserId == member.user_id
                    ) {
                        onPick(member.user_id)
                        dismiss()
                    }
                }
                if matches.isEmpty {
                    Text("No teammates match.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
        }
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
                .font(.body)
            Spacer()
            if selected {
                Image(systemName: "checkmark")
                    .foregroundStyle(BrandColor.petrol)
                    .accessibilityLabel("Selected")
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
    }
}
