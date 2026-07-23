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
                                .font(.system(size: 10, weight: .semibold))
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
                            .font(.system(size: 11))
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
            List {
                HStack(spacing: 8) {
                    TextField("Add or create a tag", text: $input)
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
                        Text(attachLabel(plan))
                            .font(.subheadline.weight(.medium))
                    }
                    .disabled(plan == nil)
                }
                if tags.isEmpty {
                    Text("No tags yet. Create the first one above.")
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
                            Text(tag.name)
                                .foregroundStyle(.primary)
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

    private func attachLabel(_ plan: TagAttachPlan?) -> String {
        if case .createNew = plan { return "Create" }
        return "Add"
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
