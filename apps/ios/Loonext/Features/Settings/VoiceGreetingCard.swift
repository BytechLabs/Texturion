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

    var body: some View {
        SettingsCard(
            title: "Your own voice",
            description: "Record the greeting yourself instead of having it read "
                + "aloud. Callers hear a person, which is the thing you are "
                + "actually selling."
        ) {
            Text(
                rows.isEmpty
                    ? "Nothing recorded yet — callers hear the written greeting, read aloud."
                    : "Pick one on a number under Numbers to use it. Anything you have not chosen stays unused."
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
                        Button("Delete") { confirmDelete = row }
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
            "Delete \"\(confirmDelete?.name ?? "")\"?",
            isPresented: Binding(
                get: { confirmDelete != nil },
                set: { if !$0 { confirmDelete = nil } }
            )
        ) {
            Button("Keep it", role: .cancel) { confirmDelete = nil }
            Button("Delete", role: .destructive) {
                if let target = confirmDelete { remove(target) }
                confirmDelete = nil
            }
        } message: {
            Text(
                "Any number using it goes back to the written words, read aloud. "
                    + "Callers hear the change on the next call."
            )
        }
    }

    @ViewBuilder
    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let current = take {
                HStack {
                    Text("Recorded \(formatGreetingDuration(current.durationMs))")
                        .font(.footnote)
                    Spacer()
                    Button("Hear it back") {
                        if !recorder.play(current) {
                            error = "That recording would not play back. Record it again."
                        }
                    }
                    .font(.caption)
                    .disabled(pending)
                }
                Text("This is exactly what a caller gets.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("Name it", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .disabled(pending)
                HStack {
                    Button("Record again") {
                        recorder.discard()
                        take = nil
                    }
                    .disabled(pending)
                    Spacer()
                    Button(pending ? "Saving…" : "Save greeting") { save() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(pending || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } else if recording {
                HStack {
                    Text("Recording… speak now.").font(.callout)
                    Spacer()
                    Button("Stop") { stop() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                }
            } else {
                HStack {
                    Text("Up to two minutes.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Record") { begin() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                }
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
            error = refusal.message
            return
        }
        recording = true
    }

    private func stop() {
        recording = false
        take = recorder.finish()
        if take == nil {
            error = "Nothing was recorded. Try holding the phone closer."
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
