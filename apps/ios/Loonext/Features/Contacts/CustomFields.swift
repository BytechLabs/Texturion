import SwiftUI

/// #291 — what this workspace needs to know about a customer.
///
/// Design notes, and the principles behind them:
///
/// - **Absent until the workspace defines something.** A crew that has not set
///   up any fields sees nothing here rather than an empty heading on every
///   contact forever. *Applying: Zen of Clarity.*
/// - **Every defined field shows, answered or not.** The unanswered ones are
///   the point: an empty gate code on a job sheet is the prompt to ask. Hiding
///   them until filled would make the feature invisible exactly when it helps.
/// - **A value commits when the field loses focus, like the rows above it.**
///   These are one-line facts a crew corrects from a van; a Save button under
///   ten inputs is a step between knowing something and recording it, and a
///   different gesture from the one the same crew makes on the laptop.
/// - **A refused value keeps what was typed.** The field holds the text and
///   says why, rather than reverting and losing the correction just made.
///
/// Mirrors the web and Android lists; `ContactFieldsCopyTests` keeps the words
/// the same.
struct CustomFields: View {
    let defs: [ContactFieldDef]
    let values: [String: String]
    /// Called with the WHOLE set — the API stores what it is given.
    let onCommit: ([String: String]) -> Void

    @State private var drafts: [String: String] = [:]
    @State private var errors: [String: String] = [:]
    @FocusState private var focused: String?

    var body: some View {
        if defs.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 10) {
                // Keyed on the field's key, not on its position: a ForEach over
                // rows identified by index reuses the wrong text field the
                // moment the list is reordered.
                ForEach(defs) { def in
                    field(def)
                }
            }
            .onAppear { drafts = values }
            .onChange(of: values) { _, next in drafts = next }
        }
    }

    @ViewBuilder
    private func field(_ def: ContactFieldDef) -> some View {
        let value = drafts[def.key] ?? ""
        VStack(alignment: .leading, spacing: 4) {
            switch def.kind {
            case "checkbox":
                Toggle(isOn: Binding(
                    get: { value == "yes" },
                    set: { on in commit(def, on ? "yes" : "no") }
                )) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(def.label).font(.golos(14))
                        // "Not asked" is a THIRD state, and a real one: it is
                        // not the same as an answered no.
                        Text(
                            value == "yes" ? "Yes"
                                : value == "no" ? "No" : customFieldUnanswered
                        )
                        .font(.golos(12))
                        .foregroundStyle(BrandColor.muted600)
                    }
                }
                .accessibilityLabel(def.label)

            case "select":
                Text(def.label)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                Picker(def.label, selection: Binding(
                    get: { value },
                    set: { next in commit(def, next) }
                )) {
                    // Empty is an ANSWER and has to stay reachable: "we asked,
                    // there is no gate code" is a fact, and a dropdown of only
                    // real values traps the first mis-tap forever.
                    Text(customFieldUnset).tag("")
                    ForEach(def.options ?? [], id: \.self) { choice in
                        Text(choice).tag(choice)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityLabel(def.label)

            default:
                Text(def.label)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                TextField("", text: Binding(
                    get: { drafts[def.key] ?? "" },
                    set: { drafts[def.key] = $0 }
                ))
                .font(.golos(14))
                .textFieldStyle(.roundedBorder)
                .keyboardType(def.kind == "number" ? .decimalPad : .default)
                .focused($focused, equals: def.key)
                // Losing focus IS the save, which is what the web does on
                // blur. A Save button under ten inputs would be a step between
                // knowing something and recording it.
                .onChange(of: focused) { previous, _ in
                    if previous == def.key {
                        commit(def, drafts[def.key] ?? "")
                    }
                }
                .accessibilityLabel(def.label)
            }

            if let reason = errors[def.key] {
                Text(reason)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.destructive)
            }
        }
    }

    private func commit(_ def: ContactFieldDef, _ next: String) {
        drafts[def.key] = next
        if next == (values[def.key] ?? "") { return }
        if let reason = ContactFields.valueError(
            kind: def.kind,
            options: def.options,
            label: def.label,
            value: next
        ) {
            errors[def.key] = reason
            return
        }
        errors[def.key] = nil
        var whole = drafts
        whole[def.key] = next
        onCommit(whole)
    }
}

/// The two words this surface owns, kept where the parity test can read them.
let customFieldUnanswered = "Not asked"
let customFieldUnset = "Not set"
