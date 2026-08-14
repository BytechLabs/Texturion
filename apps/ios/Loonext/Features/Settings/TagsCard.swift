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

    @Environment(\.appLocale) private var appLocale

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
                    title: AppStrings.translate(appLocale, "settingsMore.tagsTitle"),
                    description: AppStrings.translate(appLocale, "settingsMore.tagsDesc")
                ) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.tag_id) { index, row in
                            if index > 0 { RowDivider() }
                            TagUsageRow(
                                scope: scope,
                                row: row,
                                canManage: canManage,
                                canMerge: canManage && rows.count > 1,
                                onMerge: { merging = row },
                                onChanged: { refreshKey += 1 }
                            )
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

/// One tag: what it is called, what it means, and how much it is used.
///
/// # Why the description is editable from HERE and nowhere else
///
/// A description answers "does this mean the same thing as that one?", and this
/// list is the only screen where somebody asks that question. Putting the editor
/// behind a separate tag screen would mean the answer gets written somewhere
/// other than where it is needed.
///
/// *Applying: Zen of Clarity — the editor opens on the row, not a permanent
/// field per tag; forty always-open inputs would bury the counts that are the
/// point of the list.*
@MainActor
private struct TagUsageRow: View {
    let scope: SettingsScope
    let row: TagUsage
    let canManage: Bool
    let canMerge: Bool
    let onMerge: @MainActor () -> Void
    let onChanged: @MainActor () -> Void

    @State private var editing = false
    @State private var draft = ""
    @State private var saving = false
    @State private var error: String?

    private var repo: MessagingRepository { MessagingRepository(api: scope.graph.api) }

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(row.name)
                    .font(.golos(13.5))
                    .foregroundStyle(BrandColor.ink)
                Spacer(minLength: 8)
                // Last used beside the count: a tag with forty uses and nothing
                // since March is a category the crew has stopped believing in,
                // and the count alone cannot say that.
                Text(
                    usesLabel(row.uses, appLocale)
                        + lastUsedSuffix(row.last_used, appLocale)
                )
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted500)
                if canManage {
                    Button(
                        t(
                            row.description?.isEmpty == false
                                ? "settingsMore.edit"
                                : "settingsMore.describe"
                        )
                    ) {
                        draft = row.description ?? ""
                        editing.toggle()
                    }
                    .font(.subheadline)
                    .buttonStyle(.plain)
                    .foregroundStyle(BrandColor.olive)
                }
                if canMerge {
                    Button(t("settingsMore.merge")) { onMerge() }
                        .font(.subheadline)
                        .buttonStyle(.plain)
                        .foregroundStyle(BrandColor.olive)
                }
            }

            if editing {
                TextField(t("settingsMore.tagDescribePlaceholder"), text: $draft)
                    .font(.golos(12.5))
                    .textFieldStyle(.roundedBorder)
                    .disabled(saving)
                    .padding(.top, 6)
                    .onChange(of: draft) { _, next in
                        if next.count > tagDescriptionMax {
                            draft = String(next.prefix(tagDescriptionMax))
                        }
                    }
                HStack(spacing: 12) {
                    Button(saving ? t("common.saving") : t("common.save")) { save() }
                        .font(.subheadline)
                        .buttonStyle(.plain)
                        .foregroundStyle(BrandColor.olive)
                        .disabled(saving)
                    Button(t("common.cancel")) { editing = false }
                        .font(.subheadline)
                        .buttonStyle(.plain)
                        .foregroundStyle(BrandColor.muted500)
                        .disabled(saving)
                }
                .padding(.top, 4)
            } else if let description = row.description, !description.isEmpty {
                Text(description)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted600)
                    .padding(.top, 2)
            }

            InlineError(error)
        }
        .padding(.vertical, 10)
    }

    private func save() {
        error = nil
        saving = true
        Task {
            do {
                _ = try await repo.describeTag(
                    companyId: scope.companyId,
                    tagId: row.tag_id,
                    description: draft
                )
                editing = false
                onChanged()
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

/// Mirrors tags_description_len: a sentence, not a policy.
private let tagDescriptionMax = 200

/// " · last 2d" when it has ever been used; nothing when it has not.
private func lastUsedSuffix(_ iso: String?, _ locale: String? = nil) -> String {
    guard let iso, !iso.isEmpty else { return "" }
    let relative = relativeTime(iso)
    return relative.isEmpty
        ? ""
        : AppStrings.translate(locale, "settingsMore.tagLastUsed", ["ago": relative])
}

/// "never used" reads as a verdict; "0 threads" reads as a loading state.
///
/// `locale` defaulted to nil — the English table — so the guards that pin these
/// three answers keep reading English, and the row hands it the reader's.
func usesLabel(_ uses: Int, _ locale: String? = nil) -> String {
    switch uses {
    case 0: AppStrings.translate(locale, "settingsMore.tagNeverUsed")
    case 1: AppStrings.translate(locale, "settingsMore.tagOneThread")
    default:
        AppStrings.translate(locale, "settingsMore.tagThreads", ["count": String(uses)])
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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(t("settingsMore.mergeBody", ["tag": from.name]))
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.muted600)
                }
                Section(t("settingsMore.mergeKeepWhich")) {
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
                        Text(
                            t(
                                "settingsMore.mergeDirection",
                                [
                                    "uses": usesLabel(from.uses, appLocale).capitalizedFirst,
                                    "target": into.name,
                                    "tag": from.name,
                                ]
                            )
                        )
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.muted600)
                    }
                }
                if let error {
                    Section { InlineError(error) }
                }
            }
            .navigationTitle(t("settingsMore.mergeTitle", ["tag": from.name]))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { onDismiss() }.disabled(merging)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(
                        merging ? t("settingsMore.merging") : t("settingsMore.merge")
                    ) { merge() }
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
                scope.showMessage(t("settingsMore.mergedInto", ["target": target.name]))
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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        SettingsCard(
            title: t("settingsMore.tagLockTitle"),
            description: t("settingsMore.tagLockDesc")
        ) {
            LabeledToggleRow(
                label: t("settingsMore.tagLockLabel"),
                supporting: t("settingsMore.tagLockSupporting"),
                isOn: company.tags_locked,
                enabled: !saving
            ) { next in
                save(next)
            }

            if company.tags_locked {
                Spacer().frame(height: 6)
                ReadOnlyLine(t("settingsMore.tagLockedNote"))
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
