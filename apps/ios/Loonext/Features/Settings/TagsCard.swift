import SwiftUI

/// #298 — the tag list, with how much each one is actually used, and a way to
/// fold the duplicates together. Parity with the web's TagManagementCard and the
/// Android TagsCard.
///
/// # Why usage is the headline and not the names
///
/// "Cleanup is impossible without being able to see the problem." A list of
/// forty tag names tells an admin nothing — every one of them looked reasonable
/// to whoever made it. A list ordered by USE makes both problems visible at
/// once: the near-duplicates sit next to each other with wildly different
/// counts, and the dead ones are all at the bottom with zero.
///
/// *Applying: Meaningful Highlights & Context — the count IS the insight here,
/// so it is the thing the eye lands on. Zen of Clarity — one row per tag, one
/// action, and the merge picker only appears once somebody asks for it.*
@MainActor
struct TagsCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var state: LoadState<[TagUsage]> = .loading
    @State private var refreshKey = 0
    @State private var merging: TagUsage?

    private var repo: MessagingRepository { MessagingRepository(api: scope.graph.api) }
    private var canManage: Bool {
        MemberRole.has(scope.role, Capability.settingsManage)
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading().frame(maxWidth: .infinity, minHeight: 120)
            case .failed(let message):
                CenteredError(message: message) { refreshKey += 1 }
                    .frame(maxWidth: .infinity, minHeight: 120)
            case .ready(let rows):
                content(rows)
            }
        }
        .task(id: "\(scope.companyId)|\(refreshKey)") { await load() }
        .sheet(item: $merging) { from in
            MergeTagSheet(
                scope: scope,
                from: from,
                others: readyRows.filter { $0.tag_id != from.tag_id },
                onMerged: {
                    merging = nil
                    refreshKey += 1
                },
                onDismiss: { merging = nil }
            )
        }
    }

    private var readyRows: [TagUsage] {
        if case .ready(let rows) = state { return rows }
        return []
    }

    @ViewBuilder
    private func content(_ rows: [TagUsage]) -> some View {
        if rows.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 6) {
                if canManage {
                    TagLockCard(
                        scope: scope,
                        company: company,
                        onCompanyUpdated: onCompanyUpdated
                    )
                }
                SettingsCard(
                    title: "Tags",
                    description: "What the crew has been tagging, and how often. The "
                        + "quiet ones at the bottom are usually duplicates of "
                        + "something above."
                ) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.tag_id) { index, row in
                            if index > 0 { RowDivider() }
                            HStack(spacing: 8) {
                                Text(row.name)
                                    .font(.golos(13.5))
                                    .foregroundStyle(BrandColor.ink)
                                Spacer(minLength: 8)
                                Text(usesLabel(row.uses))
                                    .font(.golos(11))
                                    .foregroundStyle(BrandColor.muted500)
                                if canManage && rows.count > 1 {
                                    Button("Merge") { merging = row }
                                        .font(.subheadline)
                                        .buttonStyle(.plain)
                                        .foregroundStyle(BrandColor.olive)
                                }
                            }
                            .padding(.vertical, 10)
                        }
                    }
                }
            }
        }
    }

    private func load() async {
        do {
            state = .ready(try await repo.tagUsage(companyId: scope.companyId).data)
        } catch {
            if Task.isCancelled { return }
            if case .ready = state {
                scope.showMessage(error.userMessage)
            } else {
                state = .failed(error.userMessage)
            }
        }
    }
}

/// "never used" reads as a verdict; "0 threads" reads as a loading state.
func usesLabel(_ uses: Int) -> String {
    switch uses {
    case 0: "never used"
    case 1: "1 thread"
    default: "\(uses) threads"
    }
}

// MARK: - Merge

/// # Ethical Friction, and why merge earns it
///
/// A merge rewrites how a workspace's history is categorised, and unlike a
/// rename it cannot be undone by typing the old name back. The sheet names the
/// direction in plain words and says what will happen to the threads, because
/// "merge A into B" is exactly the phrasing people get backwards.
@MainActor
private struct MergeTagSheet: View {
    let scope: SettingsScope
    let from: TagUsage
    let others: [TagUsage]
    let onMerged: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    @State private var into: TagUsage?
    @State private var merging = false
    @State private var error: String?

    private var repo: MessagingRepository { MessagingRepository(api: scope.graph.api) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Every conversation tagged \u{201C}\(from.name)\u{201D} keeps its "
                        + "place under the tag you pick, and this one goes away. "
                        + "Nothing is untagged.")
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.muted600)
                }
                Section("Keep which tag?") {
                    ForEach(others, id: \.tag_id) { tag in
                        Button {
                            into = tag
                        } label: {
                            HStack {
                                Text(tag.name).foregroundStyle(BrandColor.ink)
                                Spacer()
                                if into?.tag_id == tag.tag_id {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(BrandColor.olive)
                                }
                            }
                        }
                        .disabled(merging)
                    }
                }
                if let into {
                    // Said back in the direction people get backwards. "Merge A
                    // into B" is ambiguous to almost everybody; a sentence
                    // naming what survives is not.
                    Section {
                        Text("\(usesLabel(from.uses).capitalizedFirst) moves to "
                            + "\u{201C}\(into.name)\u{201D}. \u{201C}\(from.name)\u{201D} "
                            + "stops existing.")
                            .font(.golos(12.5))
                            .foregroundStyle(BrandColor.muted600)
                    }
                }
                if let error {
                    Section { InlineError(error) }
                }
            }
            .navigationTitle("Merge \u{201C}\(from.name)\u{201D}")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDismiss() }.disabled(merging)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(merging ? "Merging…" : "Merge") { merge() }
                        .disabled(into == nil || merging)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func merge() {
        guard let target = into else { return }
        error = nil
        merging = true
        Task {
            do {
                _ = try await repo.mergeTags(
                    companyId: scope.companyId,
                    fromTagId: from.tag_id,
                    intoTagId: target.tag_id
                )
                scope.showMessage("Merged into \u{201C}\(target.name)\u{201D}.")
                onMerged()
            } catch {
                self.error = error.userMessage
            }
            merging = false
        }
    }
}

extension String {
    /// Upper-cases the first character only — `capitalized` would also lower the
    /// rest, which turns "12 threads" into "12 Threads" on some inputs.
    var capitalizedFirst: String {
        guard let first else { return self }
        return String(first).uppercased() + dropFirst()
    }
}

// MARK: - The lock

/// #298 acceptance 4 — restricting who may INVENT a tag. Off by default.
///
/// # Why this exists at all, given the issue argues against taxonomies
///
/// #298's own devil's advocate: "the temptation is to impose a taxonomy. That
/// is the wrong move for this market — a plumber's categories are not an HVAC
/// company's, and a locked-down tag list would be ignored in favour of the
/// notes field." That argument is against US imposing one. A crew that has
/// BUILT a vocabulary and wants it held still is the opposite case, and this is
/// the only thing here they cannot do without us.
///
/// It restricts creation, never attachment: a tech who cannot categorise a
/// thread does not categorise it in the notes instead, they leave it
/// uncategorised, and the workspace loses the data it turned this on to protect.
@MainActor
private struct TagLockCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var saving = false
    @State private var error: String?

    var body: some View {
        SettingsCard(
            title: "Who can create tags",
            description: "Anyone on the crew can add a tag by default. Lock it once "
                + "your list is the list."
        ) {
            LabeledToggleRow(
                label: "Only owners and admins can create tags",
                supporting: "Everyone can still use every tag you already have. This "
                    + "only stops new ones being invented mid-job.",
                isOn: company.tags_locked,
                enabled: !saving
            ) { next in
                save(next)
            }

            if company.tags_locked {
                Spacer().frame(height: 6)
                ReadOnlyLine("A tech who needs a category you do not have will leave "
                    + "the thread untagged rather than ask. Check the list below now "
                    + "and then.")
            }

            InlineError(error)
        }
    }

    private func save(_ next: Bool) {
        error = nil
        saving = true
        let body = JSONValue.object(["tags_locked": .bool(next)])
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
