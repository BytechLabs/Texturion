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
    @State private var mctbMessage = ""
    @State private var mctbEnabled = false
    @State private var pending = false
    /// #309: only to put NAMES on the id the identity already carries. An empty
    /// list is every workspace until somebody records something, and it hides
    /// the picker entirely.
    @State private var greetings: [VoicemailGreeting] = []
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(AppStrings.translate(appLocale, "settingsMore.numberIdentityIntro"))
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
                        Button(AppStrings.translate(appLocale, "common.retry")) {
                            retryKey += 1
                        }
                            .buttonStyle(.bordered)
                            .padding(.top, 8)
                    case .ready(let identity):
                        if !greetings.isEmpty {
                            greetingPicker(identity)
                        }
                        // #278: what THIS line does after hours. Per number
                        // because a service line and a sales line are two
                        // businesses, and the one that must reach somebody at
                        // 3am is rarely the one taking invoice questions.
                        afterHoursPicker(identity)
                        // #278: how THIS line rings, and for how long.
                        ringPicker(identity)
                        field(
                            title: AppStrings.translate(
                                appLocale, "settingsMore.lineNameTitle"
                            ),
                            hint: AppStrings.translate(
                                appLocale, "settingsMore.lineNameHint"
                            ),
                            text: $label,
                            multiline: false,
                            inherited: identity.label.inherited,
                            restore: { restore("label") }
                        )
                        field(
                            title: AppStrings.translate(
                                appLocale, "settingsMore.voicemailGreetingTitle"
                            ),
                            hint: AppStrings.translate(
                                appLocale, "settingsMore.voicemailGreetingHint"
                            ),
                            text: $greeting,
                            multiline: true,
                            inherited: identity.voicemail_greeting.inherited,
                            restore: { restore("voicemail_greeting") }
                        )
                        field(
                            title: AppStrings.translate(
                                appLocale, "settingsMore.afterHoursReplyTitle"
                            ),
                            hint: AppStrings.translate(
                                appLocale, "settingsMore.afterHoursReplyHint"
                            ),
                            text: $away,
                            multiline: true,
                            inherited: identity.away_message.inherited,
                            restore: { restore("away_message") }
                        )
                        toggleRow(
                            title: AppStrings.translate(
                                appLocale, "settingsMore.missedCallBackTitle"
                            ),
                            hint: AppStrings.translate(
                                appLocale, "settingsMore.missedCallBackHint"
                            ),
                            inherited: identity.mctb_enabled.inherited,
                            restore: { restore("mctb_enabled") }
                        )
                        field(
                            title: AppStrings.translate(
                                appLocale, "settingsMore.missedCallTextTitle"
                            ),
                            hint: AppStrings.translate(
                                appLocale, "settingsMore.missedCallTextHint"
                            ),
                            text: $mctbMessage,
                            multiline: true,
                            inherited: identity.mctb_message.inherited,
                            restore: { restore("mctb_message") }
                        )
                    }
                    InlineError(error)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .navigationTitle(
                AppStrings.translate(appLocale, "settingsMore.numberIdentityTitle")
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(appLocale, "common.cancel")) { onDismiss() }
                        .disabled(pending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(
                        AppStrings.translate(
                            appLocale,
                            pending ? "common.saving" : "common.save"
                        )
                    ) { save() }
                        .disabled(!isReady || pending)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(pending)
        .task(id: scope.companyId) {
            // A greeting list that will not load hides the picker rather than
            // failing the sheet: the other five fields are still editable, and
            // this one has a safe default already in force.
            greetings = (try? await scope.repo.voicemailGreetings(scope.companyId)) ?? []
        }
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
                    Text(AppStrings.translate(appLocale, "settingsMore.inheritSame"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Button(AppStrings.translate(appLocale, "settingsMore.inheritUse")) { restore() }
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

    /// The one control here that is not a box.
    ///
    /// A switch is two-state and the setting is three — on, off, and follow the
    /// workspace. Rather than invent a third position nobody would recognise,
    /// the third state is carried by the same per-field affordance every other
    /// row already uses. One model across the sheet beats a second one learned
    /// for a single line.
    @ViewBuilder
    private func toggleRow(
        title: String,
        hint: String,
        inherited: Bool,
        restore: @escaping @MainActor () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.subheadline.weight(.medium))
                Spacer()
                if inherited {
                    Text(AppStrings.translate(appLocale, "settingsMore.inheritSame"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Button(AppStrings.translate(appLocale, "settingsMore.inheritUse")) { restore() }
                        .font(.caption)
                        .disabled(pending)
                }
                Toggle("", isOn: $mctbEnabled)
                    .labelsHidden()
                    .disabled(pending)
            }
            Text(hint).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.top, 14)
    }

    /// #309 — which voice, before which words.
    ///
    /// The written-words row is FIRST and is what shows when nothing is
    /// chosen: it is the only option guaranteed to exist, it is what every
    /// line does until somebody chooses otherwise, and it is what the runtime
    /// falls back to anyway when a recording will not play.
    @ViewBuilder
    private func greetingPicker(_ identity: NumberIdentity) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(AppStrings.translate(appLocale, "settingsMore.voicemailVoice"))
                    .font(.subheadline.weight(.medium))
                Spacer()
                if identity.voicemail_greeting_id.inherited {
                    Text(AppStrings.translate(appLocale, "settingsMore.inheritSame"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Button(AppStrings.translate(appLocale, "settingsMore.inheritUse")) { restore("voicemail_greeting_id") }
                        .font(.caption)
                        .disabled(pending)
                }
            }
            Picker(
                AppStrings.translate(appLocale, "settingsMore.voicemailVoice"),
                selection: Binding(
                    get: { identity.voicemail_greeting_id.value ?? writtenGreetingId },
                    set: { selectGreeting($0 == writtenGreetingId ? nil : $0) }
                )
            ) {
                Text(AppStrings.translate(appLocale, "settingsMore.writtenGreeting"))
                    .tag(writtenGreetingId)
                ForEach(greetings) { row in
                    Text(row.name).tag(row.id)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .disabled(pending)
            Text(AppStrings.translate(appLocale, "settingsMore.recordingFallbackHint"))
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.top, 14)
    }

    private func afterHoursPicker(_ identity: NumberIdentity) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(AppStrings.translate(appLocale, "settingsMore.afterHoursCalls"))
                    .font(.subheadline.weight(.medium))
                Spacer()
                if identity.after_hours_calls.inherited {
                    Text(AppStrings.translate(appLocale, "settingsMore.inheritSame"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Button(AppStrings.translate(appLocale, "settingsMore.inheritUse")) { restore("after_hours_calls") }
                        .font(.caption)
                        .disabled(pending)
                }
            }
            Picker(
                AppStrings.translate(appLocale, "settingsMore.afterHoursCalls"),
                selection: Binding(
                    get: {
                        identity.after_hours_calls.inherited
                            ? inheritTag
                            : (identity.after_hours_calls.value ?? inheritTag)
                    },
                    set: { selectAfterHours($0 == inheritTag ? nil : $0) }
                )
            ) {
                // Inherit FIRST: it is what every line does until somebody says
                // otherwise, and the option that is always correct is the one
                // that needs no thought.
                Text(AppStrings.translate(appLocale, "settingsMore.inheritSame")).tag(inheritTag)
                Text(AppStrings.translate(appLocale, "settingsMore.afterHoursRingEveryone"))
                    .tag("ring_everyone")
                Text(AppStrings.translate(appLocale, "settingsMore.afterHoursOnCallOnly"))
                    .tag("on_call_only")
                Text(AppStrings.translate(appLocale, "settingsMore.afterHoursVoicemail"))
                    .tag("voicemail")
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .disabled(pending)
            Text(AppStrings.translate(appLocale, "settingsMore.afterHoursHint"))
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.top, 14)
    }

    private func ringPicker(_ identity: NumberIdentity) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(AppStrings.translate(appLocale, "settingsMore.ringHow"))
                    .font(.subheadline.weight(.medium))
                Spacer()
                if identity.ring_strategy.inherited {
                    Text(AppStrings.translate(appLocale, "settingsMore.inheritSame"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Button(AppStrings.translate(appLocale, "settingsMore.inheritUse")) { restore("ring_strategy") }
                        .font(.caption)
                        .disabled(pending)
                }
            }
            Picker(
                AppStrings.translate(appLocale, "settingsMore.ringHow"),
                selection: Binding(
                    get: {
                        identity.ring_strategy.inherited
                            ? inheritTag
                            : (identity.ring_strategy.value ?? inheritTag)
                    },
                    set: { setRingStrategy($0 == inheritTag ? nil : $0) }
                )
            ) {
                Text(AppStrings.translate(appLocale, "settingsMore.inheritSame")).tag(inheritTag)
                Text(AppStrings.translate(appLocale, "settingsMore.ringAll")).tag("all")
                Text(AppStrings.translate(appLocale, "settingsMore.ringInTurn")).tag("in_turn")
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .disabled(pending)

            HStack(alignment: .firstTextBaseline) {
                Text(AppStrings.translate(appLocale, "settingsMore.ringHowLong"))
                    .font(.subheadline.weight(.medium))
                Spacer()
                if identity.ring_seconds.inherited {
                    Text(AppStrings.translate(appLocale, "settingsMore.inheritSame"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Button(AppStrings.translate(appLocale, "settingsMore.inheritUse")) { restore("ring_seconds") }
                        .font(.caption)
                        .disabled(pending)
                }
            }
            Picker(
                AppStrings.translate(appLocale, "settingsMore.ringHowLong"),
                selection: Binding(
                    get: {
                        identity.ring_seconds.inherited
                            ? -1
                            : (identity.ring_seconds.value ?? -1)
                    },
                    set: { setRingSeconds($0 == -1 ? nil : $0) }
                )
            ) {
                // -1 is the inherit tag here rather than a string, because the
                // value this picker holds is a number and a mixed-type tag is
                // how a SwiftUI Picker silently stops matching its selection.
                Text(AppStrings.translate(appLocale, "settingsMore.inheritSame")).tag(-1)
                ForEach(ringSecondChoices, id: \.self) { value in
                    Text(
                        AppStrings.translate(
                            appLocale,
                            "settingsMore.ringSeconds",
                            ["seconds": String(value)]
                        )
                    ).tag(value)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .disabled(pending)
        }
        .padding(.top, 14)
    }

    private func setRingStrategy(_ value: String?) {
        saveIdentity(.object([
            "ring_strategy": value.map { JSONValue.string($0) } ?? .null
        ]))
    }

    private func setRingSeconds(_ value: Int?) {
        saveIdentity(.object([
            "ring_seconds": value.map { JSONValue.number(Double($0)) } ?? .null
        ]))
    }

    /// One field, saved and re-seeded. #278 added three call sites that
    /// differed only in the body, and a third hand-rolled Task block is how
    /// one of them ends up forgetting to re-seed.
    private func saveIdentity(_ body: JSONValue) {
        Task { @MainActor in
            pending = true
            error = nil
            defer { pending = false }
            do {
                let next = try await scope.repo.setNumberIdentity(
                    scope.companyId,
                    numberId: number.id,
                    body: body
                )
                seed(next)
                loaded = .ready(next)
            } catch {
                self.error = error.userMessage
            }
        }
    }

    /// Route this line's after-hours calls, or nil to follow the workspace.
    private func selectAfterHours(_ value: String?) {
        Task { @MainActor in
            pending = true
            error = nil
            defer { pending = false }
            do {
                let next = try await scope.repo.setNumberIdentity(
                    scope.companyId,
                    numberId: number.id,
                    body: .object([
                        "after_hours_calls": value.map { JSONValue.string($0) } ?? .null
                    ])
                )
                seed(next)
                loaded = .ready(next)
            } catch {
                self.error = error.userMessage
            }
        }
    }

    /// Choose a recording, or null for the written words.
    private func selectGreeting(_ id: String?) {
        Task { @MainActor in
            pending = true
            error = nil
            defer { pending = false }
            do {
                let next = try await scope.repo.setNumberIdentity(
                    scope.companyId,
                    numberId: number.id,
                    body: .object([
                        "voicemail_greeting_id": id.map { JSONValue.string($0) } ?? .null
                    ])
                )
                seed(next)
                loaded = .ready(next)
            } catch {
                self.error = error.userMessage
            }
        }
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
        mctbMessage = identity.mctb_message.value ?? ""
        // Starts at what a missed caller gets TODAY, never off — an owner who
        // flipped a wrongly-off switch ON would change nothing visible and
        // silently stop this line following the workspace from then on.
        mctbEnabled = identity.mctb_enabled.value
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
        if mctbMessage != (current.mctb_message.value ?? "") {
            body["mctb_message"] = .string(mctbMessage)
        }
        // The switch, by the same rule: flipping it to the value it already
        // shows is not a change, and sending it anyway would turn an inherited
        // toggle into an override just by opening this sheet.
        if mctbEnabled != current.mctb_enabled.value {
            body["mctb_enabled"] = .bool(mctbEnabled)
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

/**
 The picker's stand-in for "no recording".

 A SwiftUI `Picker` selects a non-optional tag, so the written-words row needs
 an id of its own. It is translated back to null on the way out, which is what
 the column means — and it is worded as the outcome rather than "None", because
 a caller still hears a greeting either way.
 */
private let writtenGreetingId = "__written__"

/// #278: "follow the workspace" is a real choice here, not an absence, so the
/// picker needs a tag for it — SwiftUI cannot select nil.
private let inheritTag = "__inherit__"

/// The same four the workspace card offers, so the two never disagree about
/// what a reasonable ring length is.
private let ringSecondChoices = [15, 20, 30, 45]
