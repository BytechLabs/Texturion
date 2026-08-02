import SwiftUI

/// Mirrors the API schema (routes/templates.ts): trimmed 1...120 / 1...2000.
private let templateNameMax = 120
private let templateBodyMax = 2000

/// The merge variables the editor offers. They resolve server-side at send time
/// (apps/api merge.ts → @loonext/shared applyMergeFields), so a saved body keeps
/// the raw {token}; the preview below the field shows what actually ships.
private struct TemplateVariable: Identifiable, Sendable {
    let token: String
    let label: String

    var id: String { token }
}

private let templateVariables: [TemplateVariable] = [
    TemplateVariable(token: "first_name", label: "First name"),
    TemplateVariable(token: "business_name", label: "Business name"),
]

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
                        ForEach(Array(templates.enumerated()), id: \.element.id) { index, template in
                            if index > 0 { RowDivider() }
                            TemplateRowView(
                                scope: scope,
                                company: company,
                                template: template
                            ) { refreshKey += 1 }
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
    let onSaved: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    @State private var name: String
    /// Not `body`: that name belongs to the View requirement below.
    @State private var draft: String
    @State private var saving = false
    @State private var error: String?

    init(
        scope: SettingsScope,
        company: CompanyView,
        template: Template?,
        onSaved: @escaping @MainActor () -> Void,
        onDismiss: @escaping @MainActor () -> Void
    ) {
        self.scope = scope
        self.company = company
        self.template = template
        self.onSaved = onSaved
        self.onDismiss = onDismiss
        _name = State(initialValue: template?.name ?? "")
        _draft = State(initialValue: template?.body ?? "")
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
                    messageField
                    Spacer().frame(height: 14)
                    variablesRow
                    if !trimmedBody.isEmpty {
                        // Exactly the send-time substitution (sample first name
                        // + the real company name), so what you see is what
                        // ships.
                        PreviewBubble(
                            label: "Preview for \(sampleFirstName)",
                            text: applyMergeFields(
                                trimmedBody,
                                contactName: sampleFirstName,
                                businessName: company.name
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

    private var variablesRow: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: "Variables")
            HStack(spacing: 8) {
                ForEach(templateVariables) { variable in
                    Button(variable.label) { draft = appendToken(draft, variable.token) }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .tint(BrandColor.olive)
                        .disabled(saving)
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
                if let template {
                    _ = try await repo.updateTemplate(
                        companyId: scope.companyId,
                        templateId: template.id,
                        name: trimmedName,
                        body: trimmedBody
                    )
                    scope.showMessage("Template saved.")
                } else {
                    _ = try await repo.createTemplate(
                        companyId: scope.companyId,
                        name: trimmedName,
                        body: trimmedBody
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
