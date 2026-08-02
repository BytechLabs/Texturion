import SwiftUI

/// Mirrors the API schema (routes/templates.ts): trimmed 1...120 / 1...2000.
private let templateNameMax = 120
private let templateBodyMax = 2000
/// Mirrors templates_category_len: a label, not a sentence.
private let templateCategoryMax = 40

/// The merge variables the editor offers come from the shared port (#274).
///
/// They resolve server-side at send time (apps/api merge.ts →
/// applyMergeFields), so a saved body keeps the raw {token} and the preview
/// below the field shows what actually ships. The list was duplicated in three
/// editors before; a token offered here and not on the laptop meant a template
/// somebody could write on a phone and then not maintain.
private let templateVariables = MergeFields.variables

/// Append a {token}, keeping one space between it and whatever came before.
private func appendToken(_ body: String, _ token: String) -> String {
    let separator = body.isEmpty || body.hasSuffix(" ") ? "" : " "
    return "\(body)\(separator){\(token)}"
}

/// `relativeTime` speaks two dialects — durations ("now", "5m", "3h", "2d") and
/// calendar dates ("Jul 8") — and only a duration reads right before "ago".
private func updatedLine(_ iso: String, editor: String? = nil) -> String {
    let relative = relativeTime(iso)
    let base: String
    if relative.isEmpty {
        base = "Saved reply"
    } else if relative == "now" {
        base = "Updated just now"
    } else if let last = relative.last, "mhd".contains(last) {
        base = "Updated \(relative) ago"
    } else {
        base = "Updated \(relative)"
    }
    // #419: not a permission — visibility. A template is the only object here
    // where one person's edit changes what everyone else says to customers,
    // and in a crew of ten "Sam changed this on Tuesday" settles the question
    // before it becomes a dispute. "Saved reply" takes no byline: there is no
    // edit to attribute.
    guard let editor, !editor.trimmingCharacters(in: .whitespaces).isEmpty,
          base != "Saved reply"
    else { return base }
    return "\(base) by \(editor)"
}

/// Templates (parity with apps/web settings/templates): saved replies the crew
/// can send in one tap. The phones could already READ these in the composer's
/// picker but not manage them, so fixing a typo in the reply you send twenty
/// times a day meant finding a laptop. This is the web page's behaviour —
/// create, edit, delete — in the settings section grammar.
///
/// #461: CURATING the set is admin's now — a template is words the whole crew
/// sends in the business's name, the same class of thing as the away message
/// and the voicemail greeting, both already admin. USING them is untouched: the
/// composer's "/" picker reads the same list and every member still has it.
/// This section no longer appears in a member's settings index at all
/// (it needs `settings.manage`), and the API answers the three write routes
/// with the same axis.
@MainActor
struct TemplatesSectionView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var state: LoadState<[Template]> = .loading
    @State private var refreshKey = 0
    @State private var creating = false

    private var repo: MessagingRepository { MessagingRepository(api: scope.graph.api) }

    var body: some View {
        // One child, so `.task`/`.sheet` attach once: a Group applies its
        // modifiers to EVERY child, which would double the load and the sheet.
        Group {
            switch state {
            case .loading:
                CenteredLoading()
                    .frame(maxWidth: .infinity, minHeight: 220)
            case .failed(let message):
                CenteredError(message: message) { refreshKey += 1 }
                    .frame(maxWidth: .infinity, minHeight: 220)
            case .ready(let templates):
                content(templates)
            }
        }
        .task(id: "\(scope.companyId)|\(refreshKey)") { await load() }
        .sheet(isPresented: $creating) {
            TemplateEditorSheet(
                scope: scope,
                company: company,
                template: nil,
                existingCategories: knownCategories,
                onSaved: {
                    creating = false
                    refreshKey += 1
                },
                onDismiss: { creating = false }
            )
        }
    }

    @ViewBuilder
    private func content(_ templates: [Template]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Replies you type all the time, saved once. Tap Templates in the composer "
                + "to insert one. Anyone on the crew can add or change them.")
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted600)
                .padding(.horizontal, 20)
                .padding(.top, 4)
                .padding(.bottom, 2)

            SettingsCard(title: "Saved replies") {
                VStack(alignment: .leading, spacing: 0) {
                    if templates.isEmpty {
                        ReadOnlyLine("No templates yet. Save a reply you send often, then "
                            + "insert it from Templates in the composer.")
                    } else {
                        // #274: gathered under whatever headings the crew has
                        // written. A shop that never uses categories sees the
                        // flat list it always had.
                        ForEach(groupTemplates(templates)) { group in
                            if let label = group.label {
                                Text(label)
                                    .font(.golos(11, weight: .semibold))
                                    .foregroundStyle(BrandColor.muted500)
                                    .padding(.top, 10)
                                    .padding(.bottom, 2)
                            }
                            ForEach(Array(group.rows.enumerated()), id: \.element.id) { index, template in
                                if index > 0 { RowDivider() }
                                TemplateRowView(
                                    scope: scope,
                                    company: company,
                                    template: template,
                                    existingCategories: knownCategories
                                ) { refreshKey += 1 }
                            }
                        }
                    }
                    Spacer().frame(height: 10)
                    Button(templates.isEmpty ? "Create your first template" : "New template") {
                        creating = true
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                }
            }

            // #298: tags live here rather than in a fifteenth settings section.
            // /features/templates-and-tags already pairs them in the product's
            // own vocabulary, so this is a name the crew has seen rather than
            // one invented for a settings row.
            TagsCard(
                scope: scope,
                company: company,
                onCompanyUpdated: onCompanyUpdated
            )
        }
    }

    /**
     * #274 — the groupings this workspace already uses.
     *
     * Offered as chips so the common act is reusing one rather than inventing
     * a near-duplicate: "Quoting" and "quotes" as separate groups is the same
     * sprawl #298 fixed for tags, one level up.
     */
    private var knownCategories: [String] {
        guard case .ready(let rows) = state else { return [] }
        var seen: Set<String> = []
        for row in rows {
            let category = (row.category ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !category.isEmpty { seen.insert(category) }
        }
        return seen.sorted { $0.lowercased() < $1.lowercased() }
    }

    // Read fresh on every visit: this screen is the only writer of the list, so
    // anything it held on to would just be the value the next create/edit/delete
    // invalidates.
    private func load() async {
        do {
            state = .ready(try await repo.templates(companyId: scope.companyId).data)
        } catch {
            // A cancelled read was superseded by a newer one (a refreshKey bump
            // re-keys this task) — never a failure worth reporting.
            if Task.isCancelled { return }
            // A failed REFRESH keeps the list on screen (the crew is still
            // reading it); only a failed first load takes the whole section.
            if case .ready = state {
                scope.showMessage(error.userMessage)
            } else {
                state = .failed(error.userMessage)
            }
        }
    }
}

// MARK: - Row

/// Name, the first lines of the body, and when it last changed. Each row owns
/// its own edit and delete surfaces (the MemberRow idiom), so a pending delete
/// and its error belong to one template rather than the whole list.
private struct TemplateRowView: View {
    let scope: SettingsScope
    let company: CompanyView
    let template: Template
    /// #274: passed down so the edit sheet can offer them as chips.
    var existingCategories: [String] = []
    let onChanged: @MainActor () -> Void

    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var deleting = false
    @State private var deleteError: String?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(template.name)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Text(template.body)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                    .lineLimit(2)
                Text(updatedLine(template.updated_at, editor: template.updated_by_name))
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted400)
            }
            Spacer(minLength: 8)
            // One presentation per view: each sheet hangs off the button that
            // raises it rather than stacking two modifiers on the row.
            Button("Edit") { editing = true }
                .font(.subheadline)
                .buttonStyle(.borderless)
                .sheet(isPresented: $editing) {
                    TemplateEditorSheet(
                        scope: scope,
                        company: company,
                        template: template,
                        existingCategories: existingCategories,
                        onSaved: {
                            editing = false
                            onChanged()
                        },
                        onDismiss: { editing = false }
                    )
                }
            Button("Delete") { confirmingDelete = true }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .buttonStyle(.borderless)
                .sheet(isPresented: $confirmingDelete) {
                    ConfirmSheet(
                        title: "Delete \"\(template.name)\"?",
                        message: "It disappears from the composer's Templates picker for "
                            + "the whole crew. This can't be undone.",
                        confirmLabel: "Delete",
                        destructive: true,
                        pending: deleting,
                        error: deleteError,
                        dismissLabel: "Keep it",
                        onConfirm: { delete() },
                        onDismiss: { confirmingDelete = false }
                    )
                }
        }
        .padding(.vertical, 10)
    }

    private func delete() {
        deleting = true
        deleteError = nil
        let repo = MessagingRepository(api: scope.graph.api)
        Task {
            do {
                try await repo.deleteTemplate(
                    companyId: scope.companyId,
                    templateId: template.id
                )
                confirmingDelete = false
                scope.showMessage("Template deleted.")
                onChanged()
            } catch {
                deleteError = error.userMessage
            }
            deleting = false
        }
    }
}

// MARK: - Editor

/// Create (`template` nil) or edit a saved reply — the web dialog's twin.
private struct TemplateEditorSheet: View {
    let scope: SettingsScope
    let company: CompanyView
    let template: Template?
    /// #274: the groupings this workspace already uses, offered as chips.
    /// Reusing one has to be easier than typing one, or "Quoting" and "quotes"
    /// become separate groups — the sprawl #298 fixed for tags, one level up.
    let existingCategories: [String]
    let onSaved: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    @State private var name: String
    /// Not `body`: that name belongs to the View requirement below.
    @State private var draft: String
    /// #274: the crew's own grouping. Blank is how it is cleared — the API
    /// normalises "" to null, so sending it plainly is how a clear travels.
    @State private var category: String
    @State private var saving = false
    @State private var error: String?

    init(
        scope: SettingsScope,
        company: CompanyView,
        template: Template?,
        existingCategories: [String] = [],
        onSaved: @escaping @MainActor () -> Void,
        onDismiss: @escaping @MainActor () -> Void
    ) {
        self.scope = scope
        self.company = company
        self.template = template
        self.existingCategories = existingCategories
        self.onSaved = onSaved
        self.onDismiss = onDismiss
        _name = State(initialValue: template?.name ?? "")
        _draft = State(initialValue: template?.body ?? "")
        _category = State(initialValue: template?.category ?? "")
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedBody: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var segmentLine: String {
        // #415: count the string the preview below already builds, not the
        // raw template. A saved reply is WHERE merge fields are used, so this
        // surface had the largest version of the composer's bug — and it
        // asserted "per send", which the raw body cannot support.
        //
        // Nothing is invented: the sample first name and the real company name
        // are the same pair the preview has always shown.
        let estimate = estimateSegments(
            applyMergeFields(
                trimmedBody,
                contactName: sampleFirstName,
                businessName: company.name
            )
        )
        let unit = estimate.segments == 1 ? "segment" : "segments"
        return "\(draft.count)/\(templateBodyMax) · \(estimate.segments) \(unit) per send"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(template == nil ? "New template" : "Edit template")
                .font(.golos(17, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    nameField
                    Spacer().frame(height: 14)
                    categoryField
                    Spacer().frame(height: 14)
                    messageField
                    Spacer().frame(height: 14)
                    variablesRow
                    if !trimmedBody.isEmpty {
                        // Exactly the send-time substitution (sample first name
                        // + the real company name), so what you see is what
                        // ships.
                        // #274: every token resolved, because an unresolved
                        // {address} renders as nothing — which is exactly what
                        // a broken token looks like.
                        PreviewBubble(
                            label: "Preview for \(sampleFirstName)",
                            text: MergeFields.previewTemplate(
                                trimmedBody,
                                businessName: company.name,
                                ourNumberE164: company.numbers
                                    .first { $0.status == "active" }?.number_e164
                            )
                        )
                    }
                    InlineError(error)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack {
                Button("Cancel") { onDismiss() }
                    .buttonStyle(.bordered)
                    .disabled(saving)
                Spacer()
                Button(saveLabel) { save() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(saving || trimmedName.isEmpty || trimmedBody.isEmpty)
            }
            .padding(.top, 16)
        }
        .padding(20)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(saving)
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: "Name")
            TextField("On my way", text: Binding(
                get: { name },
                set: { next in
                    if next.count <= templateNameMax { name = next }
                }
            ))
            .textFieldStyle(.roundedBorder)
            .disabled(saving)
        }
    }

    private var messageField: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: "Message")
            TextField("On our way. See you in about 20 minutes.", text: Binding(
                get: { draft },
                set: { next in
                    if next.count <= templateBodyMax { draft = next }
                }
            ), axis: .vertical)
            .textFieldStyle(.roundedBorder)
            .lineLimit(3 ... 8)
            .disabled(saving)
            Text(segmentLine)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
        }
    }

    /// #274 — the crew's own grouping, offered rather than imposed. The chips
    /// are the categories this workspace has ALREADY used, so reusing one is a
    /// tap and inventing one is still a free-text box away.
    private var categoryField: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(label: "Category (optional)")
            TextField("Quoting", text: $category)
                .textFieldStyle(.roundedBorder)
                .disabled(saving)
                .onChange(of: category) { _, next in
                    if next.count > templateCategoryMax {
                        category = String(next.prefix(templateCategoryMax))
                    }
                }
            if !existingCategories.isEmpty {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 104), spacing: 8, alignment: .leading)],
                    alignment: .leading,
                    spacing: 8
                ) {
                    ForEach(existingCategories, id: \.self) { existing in
                        Button(existing) { category = existing }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .tint(BrandColor.olive)
                            .disabled(saving)
                    }
                }
            }
        }
    }

    private var variablesRow: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: "Variables")
            // #274: seven variables now, so they WRAP. A single row would
            // push the last ones off an iPhone, and a variable you cannot see
            // is a variable that does not exist.
            // An adaptive grid rather than a custom Layout: plain SwiftUI that
            // wraps on every width, and nothing exotic to go wrong on a device
            // this codebase can only compile in CI.
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 104), spacing: 8, alignment: .leading)],
                alignment: .leading,
                spacing: 8
            ) {
                ForEach(templateVariables) { variable in
                    Button(variable.label) { draft = appendToken(draft, variable.token) }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .tint(BrandColor.olive)
                        .disabled(saving)
                        .accessibilityHint(variable.hint)
                }
            }
            Text("Tap to insert. Each one fills in per contact when the message sends.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
        }
    }

    private var saveLabel: String {
        if saving { return "Saving…" }
        return template == nil ? "Create template" : "Save"
    }

    private func save() {
        saving = true
        error = nil
        let repo = MessagingRepository(api: scope.graph.api)
        Task {
            do {
                let trimmedCategory = category
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if let template {
                    _ = try await repo.updateTemplate(
                        companyId: scope.companyId,
                        templateId: template.id,
                        name: trimmedName,
                        body: trimmedBody,
                        category: trimmedCategory
                    )
                    scope.showMessage("Template saved.")
                } else {
                    _ = try await repo.createTemplate(
                        companyId: scope.companyId,
                        name: trimmedName,
                        body: trimmedBody,
                        category: trimmedCategory
                    )
                    scope.showMessage("Template created.")
                }
                onSaved()
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

/// #274 — templates in their groups, for the SETTINGS list.
///
/// The half of "a flat list collapses at thirty" that ordering cannot fix:
/// somebody maintaining templates is looking for a GROUP of them ("all the
/// quoting ones"), and no sort answers that.
///
/// Ungrouped rows come LAST, under no heading. They are not a category called
/// "Other" — a heading invents a group the crew did not make, and in a
/// workspace that never uses categories it would label every single row.
///
/// MIRROR of groupTemplates in apps/web settings/templates/grouping.ts.
struct TemplateGroup: Identifiable {
    let label: String?
    let rows: [Template]

    var id: String { label ?? "__ungrouped" }
}

func groupTemplates(_ rows: [Template]) -> [TemplateGroup] {
    var byCategory: [String: [Template]] = [:]
    var ungrouped: [Template] = []
    for row in rows {
        let category = (row.category ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if category.isEmpty {
            ungrouped.append(row)
        } else {
            byCategory[category, default: []].append(row)
        }
    }
    var groups = byCategory
        .sorted { $0.key.lowercased() < $1.key.lowercased() }
        .map { TemplateGroup(label: $0.key, rows: $0.value) }
    if !ungrouped.isEmpty {
        groups.append(TemplateGroup(label: nil, rows: ungrouped))
    }
    return groups
}
