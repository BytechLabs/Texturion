import SwiftUI

/**
 #309 — "Your own voice".

 Hand-port of `apps/web/src/components/settings/voice-greeting-card.tsx` and
 `VoiceGreetingCard.kt`, keeping the three rules that shape it:

 - **You cannot save a take you have not heard.** Save appears only once there
   IS a recording, beside the button that plays it. Recording your own voice is
   the one thing people redo, and a flow that saves the first take unheard is
   one that assumes it was good.
 - **The name is pre-filled** with what most owners are recording. An empty
   required field between somebody and their first playback is friction with no
   purpose.
 - **Deleting asks first**, because it changes what every caller to a line using
   it hears and this card cannot show which lines those are.
 - **There is a second way in, and it is a phone call.** Some owners will never
   record in an app — the permission prompt, the phone held at arm's length.
   "Have us call you" rings them and they talk. It sits behind a plain button
   rather than beside Record, because two equally-weighted ways to do one thing
   is a decision nobody asked for, and its words change the moment the
   microphone is refused, which is exactly when it is the answer.
 */
struct VoiceGreetingCard: View {
    let scope: SettingsScope
    let canEdit: Bool

    /// Built from the scope's own graph rather than passed in: this is the only
    /// multipart call in Settings, and threading a client through the section
    /// for one card would be a parameter every other card ignores.
    private var multipart: MultipartClient {
        MultipartClient(api: scope.graph.api, sessionStore: scope.graph.sessionStore)
    }

    @StateObject private var recorder = GreetingRecorder()
    @State private var rows: [VoicemailGreeting] = []
    @State private var take: GreetingTake?
    @State private var name = defaultGreetingName
    @State private var recording = false
    @State private var pending = false
    @State private var error: String?
    @State private var confirmDelete: VoicemailGreeting?
    /// #309's phone path. `nil` is closed; the phase tells the one sheet whether
    /// it is still asking or already waiting on a call that is out there.
    @State private var capture: CaptureState?
    /// True once the microphone has actually been refused, which is when the
    /// phone path stops being an alternative and starts being the way through.
    @State private var micRefused = false

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        SettingsCard(
            title: t("settingsMore.ownVoiceTitle"),
            description: t("settingsMore.ownVoiceDesc")
        ) {
            Text(
                rows.isEmpty
                    ? t("settingsMore.noGreetingsYet")
                    : t("settingsMore.pickGreetingOnNumber")
            )
            .font(.footnote)
            .foregroundStyle(.secondary)

            ForEach(rows) { row in
                HStack {
                    Text(row.name).font(.callout)
                    Text(formatGreetingDuration(row.duration_ms))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    if canEdit {
                        Button(t("common.delete")) { confirmDelete = row }
                            .font(.caption)
                            .disabled(pending)
                    }
                }
                .padding(.top, 10)
            }

            if canEdit { composer }

            InlineError(error)
        }
        .task { await refresh() }
        .onDisappear { recorder.discard() }
        .alert(
            t("settingsMore.deleteGreetingTitle", ["name": confirmDelete?.name ?? ""]),
            isPresented: Binding(
                get: { confirmDelete != nil },
                set: { if !$0 { confirmDelete = nil } }
            )
        ) {
            Button(t("settingsMore.keepIt"), role: .cancel) { confirmDelete = nil }
            Button(t("common.delete"), role: .destructive) {
                if let target = confirmDelete { remove(target) }
                confirmDelete = nil
            }
        } message: {
            Text(t("settingsMore.deleteGreetingBody"))
        }
        .sheet(
            isPresented: Binding(
                get: { capture != nil },
                set: { if !$0 { capture = nil } }
            )
        ) {
            captureSheet
        }
    }

    /// The phone path. One sheet, two states — asking, then waiting — because
    /// they are one errand: an owner who puts the phone to their ear mid-flow
    /// comes back to the screen that told them what to do, not to a closed one.
    @ViewBuilder
    private var captureSheet: some View {
        NavigationStack {
            Form {
                if capture?.phase == .calling {
                    Section {
                        Text(t("settingsMore.answerAndListen"))
                        Text(t("settingsMore.captureStep1"))
                        Text(t("settingsMore.captureStep2"))
                        Text(t("settingsMore.captureStep3"))
                    } header: {
                        Text(t("settingsMore.callingNow", ["number": capture?.to ?? ""]))
                    } footer: {
                        // The name rides in as `{name}` rather than being
                        // assembled around a pair of escaped quotes, which is
                        // what this used to do and the comment that stood here
                        // was right to be wary of: the quotation marks are now
                        // the catalogue's problem, and French gets « » without
                        // this file knowing about it.
                        Text(t("settingsMore.captureWillAppear", ["name": capture?.name ?? ""]))
                    }
                } else {
                    Section {
                        TextField(
                            t("settingsMore.yourNumber"),
                            text: Binding(
                                get: { capture?.to ?? "" },
                                set: { capture?.to = $0 }
                            )
                        )
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        TextField(
                            t("settingsMore.nameIt"),
                            text: Binding(
                                get: { capture?.name ?? "" },
                                set: { capture?.name = $0 }
                            )
                        )
                    } footer: {
                        Text(t("settingsMore.recordOnPhoneBody"))
                    }
                }
                InlineError(error)
            }
            .navigationTitle(
                capture?.phase == .calling
                    ? t("settingsMore.captureOnTheWay")
                    : t("settingsMore.recordOnPhone")
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(
                        capture?.phase == .calling ? t("common.close") : t("common.cancel")
                    ) { capture = nil }
                }
                if capture?.phase != .calling {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(
                            pending ? t("settingsMore.calling") : t("settingsMore.callMe")
                        ) { startCaptureCall() }
                            .disabled(
                                pending
                                    || (capture?.to ?? "").trimmingCharacters(in: .whitespaces).isEmpty
                                    || (capture?.name ?? "").trimmingCharacters(in: .whitespaces).isEmpty
                            )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let current = take {
                HStack {
                    Text(
                        t(
                            "settingsMore.recordedLength",
                            ["length": formatGreetingDuration(current.durationMs)]
                        )
                    )
                    .font(.footnote)
                    Spacer()
                    Button(t("settingsMore.hearItBack")) {
                        if !recorder.play(current) {
                            error = t("settingsMore.takeWontPlay")
                        }
                    }
                    .font(.caption)
                    .disabled(pending)
                }
                Text(t("settingsMore.exactlyWhatCallerGets"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField(t("settingsMore.nameIt"), text: $name)
                    .textFieldStyle(.roundedBorder)
                    .disabled(pending)
                HStack {
                    Button(t("settingsMore.recordAgain")) {
                        recorder.discard()
                        take = nil
                    }
                    .disabled(pending)
                    Spacer()
                    Button(
                        pending ? t("common.saving") : t("settingsMore.saveGreeting")
                    ) { save() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(pending || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } else if recording {
                HStack {
                    Text(t("settingsMore.recordingNow")).font(.callout)
                    Spacer()
                    Button(t("settingsMore.stop")) { stop() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                }
            } else {
                HStack {
                    Text(t("settingsMore.upToTwoMinutes"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button(t("settingsMore.record")) { begin() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                }
            }
            if take == nil && !recording {
                Button(
                    micRefused
                        ? t("settingsMore.haveUsCallYou")
                        : t("settingsMore.ratherOnThePhone")
                ) {
                    error = nil
                    capture = CaptureState(phase: .form, name: defaultGreetingName, to: "")
                }
                .font(.caption)
                .disabled(pending)
            }
        }
        .padding(.top, 14)
    }

    private func refresh() async {
        do {
            rows = try await scope.repo.voicemailGreetings(scope.companyId)
        } catch {
            self.error = error.userMessage
        }
    }

    private func begin() {
        error = nil
        // `callInProgress` is false here rather than plumbed: this card lives in
        // Settings, and the recorder's own `.record` session activation is what
        // actually fails if a call holds the audio — which surfaces as
        // `.couldNotStart` with a message that says to try again.
        if let refusal = recorder.start(callInProgress: false) {
            error = refusal.message(appLocale)
            micRefused = true
            return
        }
        micRefused = false
        recording = true
    }

    private func stop() {
        recording = false
        take = recorder.finish()
        if take == nil {
            error = t("settingsMore.nothingRecorded")
        }
    }

    private func save() {
        guard let current = take else { return }
        Task { @MainActor in
            pending = true
            error = nil
            defer { pending = false }
            do {
                _ = try await multipart.postFile(
                    path: "/v1/voicemail-greetings",
                    companyId: scope.companyId,
                    fields: [
                        ("name", name.trimmingCharacters(in: .whitespaces)),
                        ("duration_ms", String(current.durationMs)),
                    ],
                    fileField: "file",
                    fileName: "greeting.m4a",
                    contentType: "audio/mp4",
                    bytes: current.audio
                )
                recorder.discard()
                take = nil
                name = defaultGreetingName
                await refresh()
            } catch {
                self.error = error.userMessage
            }
        }
    }

    private func startCaptureCall() {
        guard let current = capture, current.phase == .form else { return }
        let wanted = current.name.trimmingCharacters(in: .whitespaces)
        Task { @MainActor in
            pending = true
            error = nil
            do {
                try await scope.repo.greetingCaptureCall(
                    scope.companyId,
                    name: wanted,
                    to: current.to.trimmingCharacters(in: .whitespaces)
                )
                pending = false
                capture?.phase = .calling
                await awaitCapturedGreeting(named: wanted)
            } catch {
                pending = false
                self.error = error.userMessage
            }
        }
    }

    /// The greeting landing in the list IS the end of the phone flow.
    ///
    /// The owner is on a call and away from this screen, so the only
    /// confirmation the call can produce is the row appearing. Watched by NAME
    /// rather than by count: a second person recording at the same moment would
    /// move a count and mean nothing about this call.
    private func awaitCapturedGreeting(named wanted: String) async {
        for _ in 0..<capturePollCount {
            try? await Task.sleep(nanoseconds: capturePollNanos)
            if capture == nil { return }
            await refresh()
            if rows.contains(where: { $0.name == wanted }) {
                capture = nil
                return
            }
        }
    }

    private func remove(_ target: VoicemailGreeting) {
        Task { @MainActor in
            pending = true
            error = nil
            defer { pending = false }
            do {
                try await scope.repo.deleteGreeting(scope.companyId, id: target.id)
                await refresh()
            } catch {
                self.error = error.userMessage
            }
        }
    }
}

/**
 What most owners are recording, so the field is never empty.

 Still editable — a workspace with a holiday greeting and a truck greeting
 needs to say which is which — but nobody should have to think of a name before
 they can hear their first take.
 */
private let defaultGreetingName = "After hours"

/// Where the phone flow is: still asking, or already on a call.
enum CapturePhase {
    case form
    case calling
}

/// The phone flow's whole state, carried by the one sheet that shows both.
struct CaptureState {
    var phase: CapturePhase
    var name: String
    var to: String
}

/// Five seconds apart for three minutes: long enough to cover a 45-second ring,
/// a two-minute recording, and the seconds it takes us to store it.
private let capturePollNanos: UInt64 = 5_000_000_000
private let capturePollCount = 36
