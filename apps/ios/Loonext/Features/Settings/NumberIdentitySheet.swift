import SwiftUI

/// #307 — "How this line answers".
///
/// Hand-port of `apps/web/src/components/settings/number-identity-dialog.tsx`
/// and `NumberIdentityDialog.kt`. A workspace running a service line and a
/// sales line had ONE identity across both, so somebody who bought a second
/// number BECAUSE it is a different business found the product quietly making
/// it the same one.
///
/// The three rules the web version establishes, kept identical here — three
/// clients describing one model three different ways is the #437 failure:
///
/// - **Every box starts at what a caller ACTUALLY gets**, never blank. An empty
///   field cannot tell an owner what the line does today, and showing that
///   before it changes is this screen's whole job. *Applying: Smart Defaults.*
/// - **Inherited is stated per field.** Without it, somebody editing a box
///   cannot tell whether they are fixing a sales greeting or rewriting the one
///   every customer already knows.
/// - **The way back is worded as its outcome** — "Use the workspace's", not
///   "Clear". Clear implies empty, and empty is the one thing this cannot mean:
///   a cleared greeting restores the workspace's rather than silencing the
///   line. *Applying: Ethical Friction.*
struct NumberIdentitySheet: View {
    let scope: SettingsScope
    let number: PhoneNumberSummary
    let onDismiss: @MainActor () -> Void

    @State private var loaded: LoadState<NumberIdentity> = .loading
    @State private var retryKey = 0
    @State private var label = ""
    @State private var greeting = ""
    @State private var away = ""
    @State private var pending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(
                        "Anything you leave alone follows your workspace. "
                            + "Change one here and it only affects this number."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                    switch loaded {
                    case .loading:
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 20)
                    case .failed(let message):
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.top, 12)
                        Button("Try again") { retryKey += 1 }
                            .buttonStyle(.bordered)
                            .padding(.top, 8)
                    case .ready(let identity):
                        field(
                            title: "Name for this line",
                            hint: "Used in the greeting, on missed-call texts, and "
                                + "wherever this line introduces itself.",
                            text: $label,
                            multiline: false,
                            inherited: identity.label.inherited,
                            restore: { restore("label") }
                        )
                        field(
                            title: "Voicemail greeting",
                            hint: "What a caller hears when nobody picks up.",
                            text: $greeting,
                            multiline: true,
                            inherited: identity.voicemail_greeting.inherited,
                            restore: { restore("voicemail_greeting") }
                        )
                        field(
                            title: "After-hours reply",
                            hint: "The text sent when somebody messages this line "
                                + "outside your hours.",
                            text: $away,
                            multiline: true,
                            inherited: identity.away_message.inherited,
                            restore: { restore("away_message") }
                        )
                    }
                    InlineError(error)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .navigationTitle("How this line answers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDismiss() }
                        .disabled(pending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(pending ? "Saving…" : "Save") { save() }
                        .disabled(!isReady || pending)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(pending)
        .task(id: "\(number.id)|\(retryKey)") {
            loaded = .loading
            do {
                let identity = try await scope.repo.numberIdentity(
                    scope.companyId,
                    numberId: number.id
                )
                seed(identity)
                loaded = .ready(identity)
            } catch {
                loaded = .failed(error.userMessage)
            }
        }
    }

    /// One field, saying whether it is this line's own or the workspace's.
    @ViewBuilder
    private func field(
        title: String,
        hint: String,
        text: Binding<String>,
        multiline: Bool,
        inherited: Bool,
        restore: @escaping @MainActor () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.subheadline.weight(.medium))
                Spacer()
                if inherited {
                    Text("Same as your workspace")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Button("Use the workspace's") { restore() }
                        .font(.caption)
                        .disabled(pending)
                }
            }
            if multiline {
                TextField(title, text: text, axis: .vertical)
                    .lineLimit(3...6)
                    .textFieldStyle(.roundedBorder)
                    .disabled(pending)
            } else {
                TextField(title, text: text)
                    .textFieldStyle(.roundedBorder)
                    .disabled(pending)
            }
            Text(hint).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.top, 14)
    }

    private var isReady: Bool {
        if case .ready = loaded { return true }
        return false
    }

    /// The boxes start at what a caller GETS, inherited or not.
    private func seed(_ identity: NumberIdentity) {
        label = identity.label.value ?? ""
        greeting = identity.voicemail_greeting.value ?? ""
        away = identity.away_message.value ?? ""
    }

    /// Send null for ONE field: that is what "use the workspace's" means.
    private func restore(_ field: String) {
        Task { @MainActor in
            pending = true
            error = nil
            defer { pending = false }
            do {
                let next = try await scope.repo.setNumberIdentity(
                    scope.companyId,
                    numberId: number.id,
                    body: .object([field: .null])
                )
                seed(next)
                loaded = .ready(next)
            } catch {
                self.error = error.userMessage
            }
        }
    }

    /// Only what CHANGED.
    ///
    /// A field left alone must not be sent: posting the resolved value back
    /// would turn an inherited field into an override just by opening this
    /// sheet, and the line would stop following the workspace with nothing
    /// looking wrong until somebody edited the workspace greeting and one line
    /// ignored it.
    private func patchBody(_ current: NumberIdentity) -> JSONValue {
        var body: [String: JSONValue] = [:]
        if label != (current.label.value ?? "") { body["label"] = .string(label) }
        if greeting != (current.voicemail_greeting.value ?? "") {
            body["voicemail_greeting"] = .string(greeting)
        }
        if away != (current.away_message.value ?? "") {
            body["away_message"] = .string(away)
        }
        return .object(body)
    }

    private func save() {
        guard case .ready(let current) = loaded else { return }
        Task { @MainActor in
            pending = true
            error = nil
            defer { pending = false }
            do {
                _ = try await scope.repo.setNumberIdentity(
                    scope.companyId,
                    numberId: number.id,
                    body: patchBody(current)
                )
                onDismiss()
            } catch {
                self.error = error.userMessage
            }
        }
    }
}
