import SwiftUI

/// #689 C: pick the people on a task. A search field over the active members,
/// a checkmark per person, a count, and an Apply button. Up to `taskAssigneeMax`
/// people; a tap past that does nothing but say why.
///
/// One sheet, two jobs: on the task detail it REPLACES the crew (so choosing
/// nobody and applying unassigns everyone), and on the bulk bar it ADDS these
/// people to every selected task (so it needs at least one person). Callers own
/// the fetch and the write; the sheet is pure UI, like `MemberPickerSheet`.
@MainActor
struct AssigneePickerSheet: View {
    let members: [Member]
    let meUserId: String
    let titleKey: String
    /// A line under the count that says what Apply will do.
    let noteKey: String?
    /// False on the bulk bar, where applying nobody would mean nothing.
    let allowEmpty: Bool
    let onApply: @MainActor (_ userIds: [String]) -> Void

    @State private var chosen: [String]
    @State private var query = ""
    @State private var capHit = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale

    init(
        members: [Member],
        meUserId: String,
        initial: [String],
        titleKey: String,
        noteKey: String? = nil,
        allowEmpty: Bool,
        onApply: @escaping @MainActor (_ userIds: [String]) -> Void
    ) {
        self.members = members
        self.meUserId = meUserId
        self.titleKey = titleKey
        self.noteKey = noteKey
        self.allowEmpty = allowEmpty
        self.onApply = onApply
        _chosen = State(initialValue: initial)
    }

    private var matches: [Member] {
        let active = members.filter { $0.deactivated_at == nil }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return active }
        return active.filter { $0.display_name.localizedCaseInsensitiveContains(trimmed) }
    }

    private var atCap: Bool { chosen.count >= taskAssigneeMax }

    var body: some View {
        VStack(spacing: 0) {
            header
            searchField
            statusLines
            peopleList
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text(AppStrings.translate(appLocale, titleKey))
                .font(.golos(17, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Spacer(minLength: 0)
            Button(AppStrings.translate(appLocale, "contactsTasks.assigneesApply")) {
                onApply(chosen)
                dismiss()
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandColor.olive)
            .disabled(!allowEmpty && chosen.isEmpty)
        }
        .padding(.horizontal, 16)
        .padding(.top, 18)
        .padding(.bottom, 4)
    }

    private var searchField: some View {
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
        .padding(.vertical, 10)
    }

    /// The running count, the cap message when it bites, and what Apply does.
    private var statusLines: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(
                AppStrings.translate(
                    appLocale,
                    "contactsTasks.assigneesCount",
                    ["count": String(chosen.count), "max": String(taskAssigneeMax)]
                )
            )
                .font(.golos(12, weight: .semibold))
                .foregroundStyle(BrandColor.muted700)
            if capHit || atCap {
                Text(
                    AppStrings.translate(
                        appLocale,
                        "contactsTasks.assigneesCap",
                        ["max": String(taskAssigneeMax)]
                    )
                )
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.overdueAmber)
            }
            if let noteKey {
                Text(AppStrings.translate(appLocale, noteKey))
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted500)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.bottom, 6)
    }

    private var peopleList: some View {
        List {
            ForEach(matches, id: \.user_id) { member in
                personRow(member)
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

    private func personRow(_ member: Member) -> some View {
        let base = member.display_name.isBlank
            ? AppStrings.translate(appLocale, "contactsTasks.teammate")
            : member.display_name
        let name = member.user_id == meUserId
            ? base + AppStrings.translate(appLocale, "contactsTasks.youSuffix")
            : base
        let selected = chosen.contains(member.user_id)
        return HStack(spacing: 12) {
            InitialsAvatar(name: member.display_name.isBlank ? nil : member.display_name, size: 32)
            Text(name)
                .font(.golos(13.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Spacer()
            if selected {
                Image(systemName: "checkmark")
                    .foregroundStyle(BrandColor.olive)
            }
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .onTapGesture { toggle(member.user_id) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAddTraits(selected ? AccessibilityTraits.isSelected : AccessibilityTraits())
    }

    private func toggle(_ id: String) {
        if let next = taskAssigneesToggled(chosen, id: id) {
            chosen = next
            capHit = false
        } else {
            capHit = true
        }
    }
}

// MARK: - Previews

#Preview("Assignee picker") {
    AssigneePickerSheet(
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
        ],
        meUserId: "u1",
        initial: ["u1"],
        titleKey: "contactsTasks.assigneesTitle",
        noteKey: nil,
        allowEmpty: true,
        onApply: { _ in }
    )
}
