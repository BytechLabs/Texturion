import SwiftUI

// MARK: - Pure create-on-attach resolution (Android TagLogic.kt twin)

/// Server-mirrored limit (SPEC §7: tag names are ≤50 chars).
let tagNameMax = 50

/// What attaching the sheet's text input should do — pure, so the
/// create-on-attach decision is unit-tested. The server ALSO matches
/// case-insensitively on create-on-attach; resolving here lets the sheet
/// attach by id (skipping the create path) and show the existing chip it's
/// about to attach.
enum TagAttachPlan {
    /// The input names a tag the company already has — attach it by id.
    case existing(Tag)

    /// No such tag yet — POST { name } and let the server create-on-attach.
    case createNew(String)
}

extension TagAttachPlan: Equatable {
    static func == (lhs: TagAttachPlan, rhs: TagAttachPlan) -> Bool {
        switch (lhs, rhs) {
        case (.existing(let a), .existing(let b)): a.id == b.id
        case (.createNew(let a), .createNew(let b)): a == b
        default: false
        }
    }
}

/// Resolve free-typed tag input against the loaded tag list: trim, reject
/// blank/oversized input (nil = the Add affordance stays disabled), match
/// case-insensitively (tags_name_uq is on lower(name)), else create.
func resolveTagInput(_ input: String, existing: [Tag]) -> TagAttachPlan? {
    let name = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if name.isEmpty || name.count > tagNameMax { return nil }
    if let match = existing.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) {
        return .existing(match)
    }
    return .createNew(name)
}

// MARK: - Tags row

/// The header tags row: attached chips (each with an inline remove) + the
/// Tags affordance opening `TagManageSheet`. Renders nothing but the
/// affordance while untagged — the row must never look like content.
@MainActor
struct ThreadTagsRow: View {
    let tags: [Tag]
    let onManage: @MainActor () -> Void
    let onRemove: @MainActor (Tag) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(tags, id: \.id) { tag in
                    HStack(spacing: 2) {
                        Text(tag.name)
                            .font(.golos(11, weight: .medium))
                            .foregroundStyle(BrandColor.muted700)
                        Button {
                            onRemove(tag)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.scaled(10, weight: .semibold))
                                .foregroundStyle(BrandColor.muted500)
                                .frame(width: 18, height: 18)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove tag \(tag.name)")
                    }
                    .padding(.leading, 10)
                    .padding(.trailing, 4)
                    .padding(.vertical, 3)
                    .background(BrandColor.paper, in: Capsule())
                }
                Button(action: onManage) {
                    HStack(spacing: 4) {
                        Image(systemName: "tag")
                            .font(.scaled(11))
                        Text(tags.isEmpty ? "Add tag" : "Tags")
                            .font(.golos(11, weight: .medium))
                    }
                    .foregroundStyle(BrandColor.muted500)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tags.isEmpty ? "Add tag" : "Manage tags")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
        }
    }
}

// MARK: - Manage sheet

/// In-thread tag add/remove: every company tag with an attached checkmark
/// (tap toggles attach/detach), plus a create-on-attach field — typing a name
/// that already exists attaches the existing tag (matched case-insensitively,
/// like the server); a new name is created by the attach itself (SPEC §7).
/// Attached state renders from the conversation detail the caller passes, so
/// the sheet always agrees with the header row.
@MainActor
struct TagManageSheet: View {
    let repo: MessagingRepository
    let companyId: String
    let attached: [Tag]
    /// #298: whether this person may INVENT a tag here. False hides the Create
    /// affordance rather than failing it — the server refuses either way
    /// (api_find_or_create_tag holds the lock and the existence check in one
    /// statement), and being told no after typing a name is exactly what sends
    /// somebody to the notes field instead. Every existing tag stays one tap
    /// away regardless.
    var mayCreate: Bool = true
    let onAttach: @MainActor (TagAttachPlan) -> Void
    let onDetach: @MainActor (Tag) -> Void

    @State private var allTags: LoadState<[Tag]> = .loading
    @State private var retryKey = 0
    @State private var input = ""

    private var attachedIds: Set<String> { Set(attached.map(\.id)) }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Tags")
                .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        // Keyed on `attached` too: a create-on-attach lands the new tag in the
        // conversation's rows first — refetching keeps the full list in step.
        .task(id: "\(companyId)|\(retryKey)|\(attached.map(\.id).joined(separator: ","))") {
            do {
                allTags = .ready(try await repo.tags(companyId: companyId).data)
            } catch {
                if case .ready = allTags {
                    // Keep the loaded list on a quiet refresh failure.
                } else {
                    allTags = .failed(error.userMessage)
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch allTags {
        case .loading:
            CenteredLoading()
        case .failed(let message):
            CenteredError(message: message) { retryKey += 1 }
        case .ready(let tags):
            let plan = resolveTagInput(input, existing: tags)
            // #298: the tag this typing probably means, if one already exists.
            // The list below is an exact-name affair, which does not know that
            // "quote-sent" and "Quote sent" are the same idea, or that
            // "warrenty" is a typo. This does.
            let suggestion = suggestExistingTag(input, existing: tags)
            let creating = isCreate(plan)
            let blocked = creating && !mayCreate
            List {
                HStack(spacing: 8) {
                    TextField(
                        mayCreate ? "Add or create a tag" : "Find a tag",
                        text: $input
                    )
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: input) { _, next in
                            if next.count > tagNameMax {
                                input = String(next.prefix(tagNameMax))
                            }
                        }
                    Button {
                        if let plan {
                            onAttach(plan)
                            input = ""
                        }
                    } label: {
                        Text(creating ? "Create" : "Add")
                            .font(.subheadline.weight(.medium))
                    }
                    .disabled(plan == nil || blocked)
                }

                // The existing tag comes FIRST, and it says why it is being
                // offered. A prompt that just reorders the list teaches
                // nothing; one that names the near-duplicate is how somebody
                // stops making it.
                if let suggestion, !suggestion.exact,
                   !attachedIds.contains(suggestion.tag.id) {
                    Button {
                        onAttach(.existing(suggestion.tag))
                        input = ""
                    } label: {
                        Text("Did you mean \u{201C}\(suggestion.tag.name)\u{201D}?")
                            .font(.subheadline)
                            .foregroundStyle(BrandColor.olive)
                    }
                }

                if blocked {
                    Text(
                        "No tag by that name. Ask an admin to add it — this "
                            + "workspace keeps a set list."
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }

                if tags.isEmpty {
                    Text(
                        mayCreate
                            ? "No tags yet. Create the first one above."
                            : "No tags yet. An admin adds the first one."
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                ForEach(tags, id: \.id) { tag in
                    let isAttached = attachedIds.contains(tag.id)
                    Button {
                        if isAttached {
                            onDetach(tag)
                        } else {
                            onAttach(.existing(tag))
                        }
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(tag.name)
                                    .foregroundStyle(.primary)
                                // #298: what it means, under what it is called.
                                // This is the moment somebody picks between two
                                // similar tags, and a description written
                                // anywhere else is one nobody reads.
                                if let note = tag.description, !note.isEmpty {
                                    Text(note)
                                        .font(.golos(11.5))
                                        .foregroundStyle(BrandColor.muted500)
                                }
                            }
                            Spacer()
                            if isAttached {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(BrandColor.olive)
                            }
                        }
                    }
                    .accessibilityLabel(
                        isAttached ? "Remove tag \(tag.name)" : "Add tag \(tag.name)"
                    )
                }
            }
            .listStyle(.plain)
        }
    }

    private func isCreate(_ plan: TagAttachPlan?) -> Bool {
        if case .createNew = plan { return true }
        return false
    }
}

#Preview("Tags row") {
    VStack(alignment: .leading, spacing: 12) {
        ThreadTagsRow(
            tags: [
                Tag(id: "t1", name: "Estimate", color: "#66801F", created_at: nil, updated_at: nil),
                Tag(id: "t2", name: "Follow up", color: nil, created_at: nil, updated_at: nil),
            ],
            onManage: {},
            onRemove: { _ in }
        )
        ThreadTagsRow(tags: [], onManage: {}, onRemove: { _ in })
    }
}
