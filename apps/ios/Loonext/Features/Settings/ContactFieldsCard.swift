import SwiftUI

/// #291 — the fields a workspace defines for itself.
///
/// Design notes, and the principles behind them:
///
/// - **Nobody types a key.** The label is the only thing worth asking for; the
///   key is derived from it and shown, not edited. Asking a plumber to invent
///   a machine-readable identifier is asking them about our storage format.
///   *Applying: Smart Defaults — a new row arrives as Text, not as an empty
///   form with five unanswered questions.*
/// - **The privacy line sits where the decision is made.** It is the one
///   moment somebody is thinking about what goes in a field. On a help page it
///   would never be read, and once a card number is in a text column it is too
///   late.
/// - **The choices editor only exists for a dropdown.** Four of the five types
///   have nothing to configure, so the fifth's editor appears when it is
///   picked rather than sitting greyed out on every row. *Applying:
///   Progressive Disclosure & Zen of Clarity.*
/// - **Removing says what it does to the data.** The field goes from every
///   contact; what the crew typed into it stays. Saying so is the difference
///   between an owner who tidies up and an owner who thinks they deleted
///   something. *Applying: Ethical Friction, on the edge that carries a
///   misconception rather than on every tap.*
/// - **The ceiling is shown, not enforced by a refusal at save.**
///
/// Mirrors the web and Android cards; `ContactFieldsCopyTests` keeps the words
/// the same.
@MainActor
struct ContactFieldsCard: View {
    let scope: SettingsScope

    @State private var loaded = false
    @State private var saved: [ContactFieldDef] = []
    @State private var draft: [ContactFieldDef] = []
    /// Rows added in this session. A SAVED row's key and type are frozen —
    /// values are stored under the key, so re-deriving it on a typo fix would
    /// wipe every value on every customer.
    @State private var freshKeys: Set<Int> = []
    @State private var cap = ContactFields.cap
    @State private var saving = false

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var dirty: Bool { draft != saved }

    var body: some View {
        SettingsCard(
            title: ContactFields.Copy.heading,
            description: ContactFields.Copy.intro
        ) {
            if !loaded {
                Text("Loading…")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                fields
            }
        }
        .task(id: scope.companyId) { await load() }
    }

    @ViewBuilder
    private var fields: some View {
        if draft.isEmpty {
            Text(
                "You have not added any yet. Your contacts show the standard "
                    + "fields — name, phone, email, address and notes."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        ForEach(Array(draft.enumerated()), id: \.offset) { index, field in
            ContactFieldRow(
                field: field,
                isNew: freshKeys.contains(index),
                canEdit: canEdit && !saving,
                onChange: { updated in draft[index] = updated },
                onRemove: {
                    draft.remove(at: index)
                    freshKeys = Set(
                        freshKeys.filter { $0 != index }.map { $0 > index ? $0 - 1 : $0 }
                    )
                }
            )
        }

        if canEdit, draft.count < cap {
            Spacer().frame(height: 8)
            Button("Add a field") {
                // Smart Defaults: a row arrives as Text with an empty name,
                // which is the commonest field and one decision fewer.
                draft.append(ContactFieldDef(kind: "text"))
                freshKeys.insert(draft.count - 1)
            }
            .buttonStyle(.bordered)
        }

        if draft.count >= cap {
            Spacer().frame(height: 8)
            Text(ContactFields.Copy.capReached)
                .font(.caption)
                .foregroundStyle(.secondary)
        }

        // Said where fields are DEFINED, which is the only moment it lands.
        Spacer().frame(height: 10)
        Text(ContactFields.Copy.privacy)
            .font(.caption)
            .foregroundStyle(.secondary)

        if canEdit, dirty {
            // What a removal actually does, said before it is committed.
            if saved.contains(where: { field in !draft.contains { $0.key == field.key } }) {
                Spacer().frame(height: 10)
                Text(ContactFields.Copy.deleteWarning)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer().frame(height: 10)
            HStack(spacing: 8) {
                Button("Save fields") { Task { await commit() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(saving)
                Button("Discard") {
                    draft = saved
                    freshKeys = []
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func load() async {
        guard let response = try? await scope.repo.contactFields(scope.companyId) else {
            loaded = true
            return
        }
        saved = response.data
        draft = response.data
        cap = response.cap
        loaded = true
    }

    private func commit() async {
        guard canEdit, !saving else { return }
        if draft.contains(where: {
            $0.key.isEmpty || $0.label.trimmingCharacters(in: .whitespaces).isEmpty
        }) {
            scope.showMessage("Give every field a name first.")
            return
        }
        saving = true
        defer { saving = false }
        do {
            let result = try await scope.repo.saveContactFields(
                companyId: scope.companyId,
                fields: draft
            )
            saved = result.data
            draft = result.data
            freshKeys = []
            scope.showMessage(
                result.data.isEmpty
                    ? "Saved. Your contacts are back to the standard fields."
                    : "Saved. These show on every customer."
            )
        } catch {
            scope.showMessage(error.userMessage)
        }
    }
}

/// One defined field: what it is called, what it takes, and how it exports.
private struct ContactFieldRow: View {
    let field: ContactFieldDef
    let isNew: Bool
    let canEdit: Bool
    let onChange: (ContactFieldDef) -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                TextField("Boiler model", text: Binding(
                    get: { field.label },
                    set: { next in
                        var updated = field
                        updated.label = String(next.prefix(80))
                        // A NEW row's key follows its label; a SAVED row's key
                        // is frozen. Values are stored under the key, so
                        // re-deriving it on a typo fix would turn a cosmetic
                        // edit into a silent wipe on every contact.
                        if isNew { updated.key = ContactFields.key(next) ?? "" }
                        onChange(updated)
                    }
                ))
                .textFieldStyle(.roundedBorder)
                .disabled(!canEdit)
                .accessibilityLabel("Field name")

                Picker("Type", selection: Binding(
                    get: { field.kind },
                    set: { kind in
                        var updated = field
                        updated.kind = kind
                        updated.options = kind == "select" ? (field.options ?? []) : nil
                        onChange(updated)
                    }
                )) {
                    ForEach(ContactFields.kinds, id: \.self) { kind in
                        Text(ContactFields.kindLabel(kind)).tag(kind)
                    }
                }
                .pickerStyle(.menu)
                // A saved field's TYPE cannot change: the values under it were
                // entered against the old one, and a text column reinterpreted
                // as a date is a column of errors.
                .disabled(!canEdit || !isNew)

                if canEdit {
                    Button("Remove", action: onRemove)
                        .buttonStyle(.plain)
                        .foregroundStyle(BrandColor.muted600)
                }
            }

            // The choices editor, for the one type that has any.
            if field.kind == "select" {
                TextField("Combi\nSystem\nHeat only", text: Binding(
                    get: { (field.options ?? []).joined(separator: "\n") },
                    set: { text in
                        var updated = field
                        updated.options = Array(
                            text.split(separator: "\n", omittingEmptySubsequences: true)
                                .map { $0.trimmingCharacters(in: .whitespaces) }
                                .filter { !$0.isEmpty }
                                .prefix(ContactFields.optionsCap)
                        )
                        onChange(updated)
                    }
                ), axis: .vertical)
                .lineLimit(3...6)
                .textFieldStyle(.roundedBorder)
                .disabled(!canEdit)
                .accessibilityLabel("The choices, one per line")
            }

            if !field.key.isEmpty {
                // The key matters because it is the column head in an export,
                // and because a saved field's key is frozen.
                Text(
                    isNew
                        ? "Exports as \(field.key)"
                        : "Exports as \(field.key) · the name can change, the type cannot"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}
