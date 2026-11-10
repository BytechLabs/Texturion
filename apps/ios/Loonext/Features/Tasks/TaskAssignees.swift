import SwiftUI

// #689 C: a task can have a crew (up to 10 people). The pure rules live here as
// free functions so they unit-test without a view; the avatar stack is the one
// place a crew is drawn. The server's `assigned_user_id` stays the FIRST
// assignee, so a payload from before the crew existed still reads correctly.

/// The most people one task can carry. The server answers 422 past this.
let taskAssigneeMax = 10

/// How many avatars a stack draws before it says "+N".
let taskAssigneeStackMax = 3

/// One person on a task as a stack draws it: the id keeps the order stable and
/// the name (nil when blank or unknown) feeds the shared initials badge.
struct AssigneeFace: Equatable, Sendable {
    let id: String
    let name: String?
}

/// The crew of a payload: `assignee_ids` when the server sent it, else the one
/// legacy assignee. An older server that omits the field still reads right.
func taskAssigneeIds(_ ids: [String]?, assignedUserId: String?) -> [String] {
    if let ids { return ids }
    return assignedUserId.map { [$0] } ?? []
}

/// Whether `userId` is on the task. Membership in the crew, never "the first
/// assignee equals me": a task shared with me is mine too.
func taskIsAssignedTo(_ userId: String, ids: [String]?, assignedUserId: String?) -> Bool {
    taskAssigneeIds(ids, assignedUserId: assignedUserId).contains(userId)
}

/// The people to draw, in crew order. A name comes from the payload's own
/// `assignees` first (the server resolves it, so board and map cards need no
/// roster), then from `roster`; a blank name stays nil.
func taskAssigneeFaces(
    ids: [String],
    profiles: [TaskProfile]?,
    roster: (String) -> String?
) -> [AssigneeFace] {
    ids.map { id in
        let own = profiles?.first { $0.user_id == id }?.display_name
        let chosen = (own?.isBlank ?? true) ? roster(id) : own
        return AssigneeFace(id: id, name: (chosen?.isBlank ?? true) ? nil : chosen)
    }
}

/// Tap on one person in a picker. Removing always works; adding past the cap
/// returns nil so the caller can say why nothing happened.
func taskAssigneesToggled(_ current: [String], id: String) -> [String]? {
    if current.contains(id) { return current.filter { $0 != id } }
    guard current.count < taskAssigneeMax else { return nil }
    return current + [id]
}

/// PATCH `{"assignee_ids": [...]}`: replaces the whole crew, `[]` unassigns
/// everyone.
func taskAssigneesBody(_ ids: [String]) -> JSONValue {
    .object(["assignee_ids": .array(ids.map { .string($0) })])
}

/// POST /v1/tasks `assignee_ids` value, nil when the draft did not choose a
/// crew (the one-person shorthand then applies).
func taskAssigneesJSON(_ ids: [String]?) -> JSONValue? {
    guard let ids else { return nil }
    return .array(ids.map { JSONValue.string($0) })
}

/// "Assigned to Ana, Ben and Cy" or, past the stack, "Assigned to Ana, Ben,
/// Cy and 2 more". Nil when nobody is assigned.
func taskAssigneeSpoken(_ faces: [AssigneeFace], locale: String?) -> String? {
    guard !faces.isEmpty else { return nil }
    let fallback = AppStrings.translate(locale, "contactsTasks.teammate")
    let named = faces.prefix(taskAssigneeStackMax).map { face -> String in
        (face.name?.isBlank ?? true) ? fallback : (face.name ?? fallback)
    }
    let extra = faces.count - named.count
    if extra > 0 {
        return AppStrings.translate(
            locale,
            "contactsTasks.assignedToMore",
            ["names": named.joined(separator: ", "), "count": String(extra)]
        )
    }
    let joiner = AppStrings.translate(locale, "contactsTasks.andJoiner")
    let list: String
    if named.count > 1, let last = named.last {
        list = named.dropLast().joined(separator: ", ") + joiner + last
    } else {
        list = named.joined(separator: ", ")
    }
    return AppStrings.translate(locale, "contactsTasks.assignedTo", ["names": list])
}

/// The Assignee row's text on the detail card: "You", a name, "You, Ana" or
/// "Ana, Ben and 1 more", else Unassigned.
func taskAssigneeSummary(
    _ faces: [AssigneeFace],
    meUserId: String,
    locale: String?
) -> String {
    guard !faces.isEmpty else {
        return AppStrings.translate(locale, "contactsTasks.unassigned")
    }
    let fallback = AppStrings.translate(locale, "contactsTasks.teammate")
    let labels = faces.map { face -> String in
        if face.id == meUserId { return AppStrings.translate(locale, "contactsTasks.you") }
        return (face.name?.isBlank ?? true) ? fallback : (face.name ?? fallback)
    }
    let shown = labels.prefix(2)
    let extra = labels.count - shown.count
    let base = shown.joined(separator: ", ")
    guard extra > 0 else { return base }
    return AppStrings.translate(
        locale,
        "contactsTasks.assigneesSummaryMore",
        ["names": base, "count": String(extra)]
    )
}

extension TaskItem {
    /// Every assignee id, first assignee first.
    var assigneeIds: [String] {
        taskAssigneeIds(assignee_ids, assignedUserId: assigned_user_id)
    }

    func isAssigned(to userId: String) -> Bool {
        taskIsAssignedTo(userId, ids: assignee_ids, assignedUserId: assigned_user_id)
    }

    func assigneeFaces(roster: (String) -> String?) -> [AssigneeFace] {
        taskAssigneeFaces(ids: assigneeIds, profiles: assignees, roster: roster)
    }
}

extension TaskDetail {
    var assigneeIds: [String] {
        taskAssigneeIds(assignee_ids, assignedUserId: assigned_user_id)
    }

    func isAssigned(to userId: String) -> Bool {
        taskIsAssignedTo(userId, ids: assignee_ids, assignedUserId: assigned_user_id)
    }

    /// The detail also carries the legacy single `assignee` profile, which names
    /// the first assignee for a payload that predates the crew.
    func assigneeFaces(roster: (String) -> String?) -> [AssigneeFace] {
        var profiles = assignees ?? []
        if let first = assignee, !profiles.contains(where: { $0.user_id == first.user_id }) {
            profiles.append(first)
        }
        return taskAssigneeFaces(ids: assigneeIds, profiles: profiles, roster: roster)
    }
}

/// Up to three overlapping avatars, then a "+N" chip. Sized through the shared
/// initials badge, so the glyph bound (#569) and the one initials rule apply.
struct AssigneeStack: View {
    let faces: [AssigneeFace]
    var size: CGFloat = 28

    @Environment(\.appLocale) private var appLocale

    private var shown: [AssigneeFace] { Array(faces.prefix(taskAssigneeStackMax)) }
    private var extra: Int { max(0, faces.count - taskAssigneeStackMax) }

    var body: some View {
        if faces.isEmpty {
            EmptyView()
        } else {
            HStack(spacing: -size * 0.3) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, face in
                    InitialsAvatar(name: face.name, size: size)
                        .overlay(Circle().strokeBorder(BrandColor.paper, lineWidth: 1.5))
                        .zIndex(Double(shown.count - index))
                }
                if extra > 0 { overflowChip }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(taskAssigneeSpoken(faces, locale: appLocale) ?? "")
        }
    }

    private var overflowChip: some View {
        let rendered = TypeScale.boundedGlyph(box: size, wanted: size * 0.34)
        return Text("+\(extra)")
            .font(.boundedGlyph(rendered, face: .system, weight: .semibold))
            .lineLimit(1)
            .foregroundStyle(BrandColor.muted900)
            .frame(width: size, height: size)
            .background(BrandColor.avatarTint, in: Circle())
            .overlay(Circle().strokeBorder(BrandColor.paper, lineWidth: 1.5))
    }
}
