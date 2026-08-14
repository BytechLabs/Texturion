import AVFoundation
import Foundation

/// #507 Phase 1 — the wrap-up a crew member SPEAKS after hanging up.
///
/// They have just put the phone down. They hold the mic in the note box, say
/// "quoted him $2,400 for the tank, parts Thursday, he's confirming with his
/// wife", and get those words back as text to check and post as an internal
/// note.
///
/// # Whose voice, and why the whole design is that one line
///
/// D117. This is the MEMBER's own voice, about a call that has ENDED — never
/// the call, and never the customer. Producing a summary of a live two-party
/// call means acquiring the other party's voice, and Canada's Criminal Code
/// s.183 defines "intercept" to include acquiring "the substance, meaning or
/// purport" — which is what a transcript IS. So the live version needs a whole
/// consent architecture (#509) and is not what this is.
///
/// Everything here holds that line mechanically rather than by intention:
///   - Recording only ever starts from a deliberate press-and-hold, and stops
///     the moment the finger lifts. Nothing records in the background.
///   - `WrapUpRecorder.start` REFUSES while a call still holds the line, so
///     the one arrangement that could pick up a customer through the earpiece
///     cannot be entered by accident.
///   - Every string the member reads says the same thing in plain words.
///
/// # The recording does not survive the upload
///
/// `AVAudioRecorder` needs a file, so one is written to the OS temporary
/// directory. `finish()` reads it into memory and DELETES it in the same call —
/// before the upload begins, not after — so a failed or abandoned upload cannot
/// leave audio on the device either. Nothing is ever copied anywhere else and
/// no id exists that could fetch it back; the server drops the bytes the same
/// way (routes/conversations.ts).
///
/// # Best effort, always
///
/// Every failure leaves the member exactly where they were: the note composer,
/// with a keyboard. Dictation is a shortcut, never a precondition, so each
/// reason gets its own plain sentence rather than one blanket shrug — the same
/// argument `replyDraftMessage` documents.

/// The `POST /v1/conversations/:id/wrap-up-transcript` body: the words, or a
/// reason there are none. Both fields optional so either shape decodes and
/// neither ever throws.
struct WrapUpTranscript: Codable, Sendable {
    let text: String?
    /// `too_long`, `disabled`, `over_cap`, `model_error`, `unavailable`,
    /// `unusable_output`. Absent on success. See `wrapUpFailureMessage`.
    var reason: String?
}

/// What the composer got back: words to review, or a sentence to show.
///
/// The failure arm carries a RESOLVED sentence rather than a reason code
/// because two different things produce one: the server's `reason`, and a
/// thrown `ApiError` whose own message (a refused number level, an expired
/// session) is better than anything a code could map to. Resolving both at the
/// one place that holds both keeps the composer down to "show it or use it".
enum WrapUpOutcome: Sendable {
    case text(String)
    case failed(String)
}

/// Plain-language copy for an empty result, one sentence per reason.
///
/// Every one of them ends somewhere the member can still act, because the note
/// composer is right there and typing always works. Mirrors the shape of
/// `replyDraftMessage`.
///
/// #228: the sentences live in `ThreadStrings`, and `locale` defaults to nil so
/// the English is what a caller with no reader in hand still gets. The keys are
/// this app's own (`thread.wrapUpFail…`) rather than Android's flat
/// `thread.wrapUpTooLong` family, because the two clients say these in
/// different words and one key holding two sentences is exactly the drift a
/// shared catalogue exists to stop.
func wrapUpFailureMessage(_ reason: String?, locale: String? = nil) -> String {
    switch reason {
    case "too_long":
        return AppStrings.translate(locale, "thread.wrapUpFailTooLong")
    case "disabled":
        return AppStrings.translate(locale, "thread.wrapUpFailDisabled")
    // #581: billing, not breakage — so it must not say "try again", which is
    // not what fixes it. Same sentence everywhere Lou refuses for this reason,
    // which is why this one DOES share Android's key.
    case "subscription_inactive":
        return AppStrings.translate(locale, "thread.louPausedForBilling")
    case "over_cap":
        return AppStrings.translate(locale, "thread.wrapUpFailOverCap")
    case "model_error", "unavailable":
        return AppStrings.translate(locale, "thread.wrapUpFailUnreachable")
    case "unusable_output":
        return AppStrings.translate(locale, "thread.wrapUpFailUnusable")
    default:
        return AppStrings.translate(locale, "thread.wrapUpFailDefault")
    }
}

/// The client half of the server's gates. Mirrors CALL_WRAPUP_MAX_SECONDS /
/// CALL_WRAPUP_MAX_BYTES in apps/api/src/ai/call-wrapup.ts.
///
/// The server's copies are the ones that COUNT — these exist so a phone left in
/// a pocket is stopped on the device rather than after paying to upload it.
enum WrapUpLimits {
    /// Stop recording here. A wrap-up is a sentence or three; past two minutes
    /// is a stuck finger.
    static let maxSeconds = 120
    /// Refuse to upload anything larger. The server refuses it too.
    static let maxBytes = 8 * 1024 * 1024
    /// Below this a press was a mis-tap, not a dictation. Discarded on the
    /// device: the server would only bill us to tell us the same thing.
    static let minSeconds = 1.0
}

/// What the composer's mic control is doing. Lives here beside the recorder so
/// the two names are read together, but the composer OWNS the value — see the
/// note on `WrapUpRecorder`.
enum WrapUpPhase: Equatable, Sendable {
    case idle
    case recording
    case transcribing
}

/// Where the microphone permission stands right now, without asking for it.
/// A small local enum rather than AVFoundation's, so the composer never has to
/// import AVFoundation to draw a button.
enum WrapUpMicPermission: Equatable, Sendable {
    case granted
    case denied
    case unasked
}

/// Everything the composer needs to offer dictation, as ONE parameter.
///
/// Grouped for the reason `DuplicateReplyContext` documents just above it in
/// Composer.swift: that view's call site has run the Swift type checker out of
/// budget before, and two more closures is exactly the shape that does it.
struct WrapUpDictationContext {
    /// True while a call still holds a line. Checked at PRESS time rather than
    /// read once into a disabled state, because the answer changes underneath
    /// the composer — a member can dismiss the in-call screen and land back on
    /// this thread with the call still up.
    let callInProgress: @MainActor () -> Bool
    /// Upload the dictation and hand back words or a sentence. Never throws:
    /// a failure here must cost a shortcut, never the note.
    let transcribe: @MainActor (Data, Int) async -> WrapUpOutcome
}

/// Why a press could not start recording, and the sentence it shows.
///
/// Top level rather than nested in the recorder so the copy is readable without
/// touching AVFoundation — every one of these is a claim about what this
/// feature does, and D117 makes those the strings most worth pinning.
enum WrapUpStartRefusal: Equatable, Sendable {
    case callInProgress
    case micDenied
    case micJustGranted
    case couldNotStart

    /// #228 — the catalogue key, so the reason and the sentence stay apart.
    var messageKey: String {
        switch self {
        case .callInProgress:
            // The one refusal that is about D117 rather than about a device.
            // Says what to do next, and says it without ever suggesting the
            // call itself could be written down.
            return "thread.wrapUpRefusalCallInProgress"
        case .micDenied:
            // iOS's own permission path, which is why this is not Android's
            // `thread.micDeniedWrapUp`: a member sent to
            // "Settings › Apps › Loonext › Permissions" on an iPhone is being
            // sent somewhere that does not exist.
            return "thread.wrapUpRefusalMicDenied"
        case .micJustGranted:
            // The permission sheet ate the press: iOS asks, the member
            // answers, and by then whatever they said is gone. Saying so beats
            // an empty note and beats silence.
            return "thread.wrapUpRefusalMicJustGranted"
        case .couldNotStart:
            return "thread.wrapUpRefusalCouldNotStart"
        }
    }

    /// The sentence, in the reader's language.
    ///
    /// A method with its OWN name rather than an overload of `message`: that
    /// property is read through a key path (`refusals.map(\.message)`), and a
    /// property and a method sharing a base name is the kind of thing this
    /// project cannot compile locally to find out about.
    func localizedMessage(_ locale: String?) -> String {
        AppStrings.translate(locale, messageKey)
    }

    /// The English, for callers with no reader in hand.
    var message: String { localizedMessage(nil) }
}

/// Records one wrap-up to a temporary file and hands back its bytes.
///
/// A plain @MainActor class rather than an `@Observable` one: the composer owns
/// what it DRAWS (the phase, the seconds) as its own state, and this owns only
/// what SwiftUI cannot — the live `AVAudioRecorder` and the file underneath it.
/// Two owners of one truth is how a button ends up drawn as recording after the
/// recorder has stopped.
@MainActor
final class WrapUpRecorder {
    private var recorder: AVAudioRecorder?
    private var fileURL: URL?
    /// Whether WE activated the shared audio session. Tracked rather than
    /// assumed, because `discard()` is a safe-to-call-anytime cleanup: without
    /// this flag, tidying up after a dictation that finished ten minutes ago
    /// would deactivate the session a CALL is currently holding.
    private var sessionActive = false

    /// True while audio is being captured.
    var isRecording: Bool { recorder != nil }

    /// Where the microphone permission stands, without asking for it. Read on
    /// every press so a member who allowed it in Settings mid-session is not
    /// stuck behind a cached answer.
    ///
    /// A `default` arm rather than an exhaustive one, the same rule the wire
    /// models follow: a case Apple adds later must degrade to "ask", never
    /// fail to compile and never silently read as granted.
    var micPermission: WrapUpMicPermission {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return .granted
        case .denied: return .denied
        default: return .unasked
        }
    }

    /// Ask for the microphone, at the point of use. True when allowed.
    ///
    /// The grant never records THIS press: iOS puts its sheet up while the
    /// member is already talking, so whatever they said is gone. The caller
    /// says `micJustGranted` instead of pretending — an empty note would be
    /// worse than a sentence asking them to say it again.
    func requestMic() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    /// Begin capturing. Returns nil on success, or the sentence to show.
    ///
    /// `callInProgress` is passed in rather than inspected here so the check
    /// uses the softphone's own state (the only honest source) instead of
    /// guessing from the audio session, whose category can outlive a call.
    func start(callInProgress: Bool) -> WrapUpStartRefusal? {
        if isRecording { return nil }
        if callInProgress { return .callInProgress }

        // `.record`, never `.playAndRecord`: this app treats a `.playAndRecord`
        // session as "a call owns the audio" (see AttachmentMedia's player), so
        // borrowing that category for a dictation would make an attachment play
        // out of the earpiece afterwards.
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .spokenAudio)
            try session.setActive(true)
            sessionActive = true
        } catch {
            return .couldNotStart
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("wrap-up-\(UUID().uuidString).m4a")
        // Mono 16 kHz AAC: what speech recognition wants and nothing more, so
        // a two-minute ceiling lands far inside the server's 8 MB one.
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        let made: AVAudioRecorder
        do {
            made = try AVAudioRecorder(url: url, settings: settings)
        } catch {
            deactivate()
            return .couldNotStart
        }
        guard made.record() else {
            deactivate()
            try? FileManager.default.removeItem(at: url)
            return .couldNotStart
        }
        recorder = made
        fileURL = url
        return nil
    }

    /// Stop and hand back the bytes, DELETING the file in the same call.
    ///
    /// Nil means there is nothing worth uploading — a mis-tap, an unreadable
    /// file, or something past the size the server would refuse anyway. The
    /// file is gone in every one of those cases too.
    /// Delete any wrap-up audio a previous run left behind.
    ///
    /// Every in-process path deletes its own file, but none of them runs if the
    /// app is killed mid-hold — a crash, a swipe-up, the system reclaiming
    /// memory behind a phone call. The temporary directory is not guaranteed to
    /// be emptied on any schedule the user can see, so without this a recording
    /// can sit on the device indefinitely, which is the one thing this feature
    /// promises cannot happen.
    ///
    /// Named by prefix so it can only ever remove this feature's own files.
    static func sweepOrphans() {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory
        guard let entries = try? fm.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: nil
        ) else { return }
        for url in entries where url.lastPathComponent.hasPrefix("wrap-up-") {
            try? fm.removeItem(at: url)
        }
    }

    func finish() -> (audio: Data, seconds: Int)? {
        guard let made = recorder else {
            discard()
            return nil
        }
        // Read the duration BEFORE stopping; `currentTime` is 0 afterwards.
        let duration = made.currentTime
        made.stop()
        recorder = nil

        var bytes: Data?
        if let fileURL {
            bytes = try? Data(contentsOf: fileURL)
        }
        // The recording does not survive this method, whatever happened above.
        discard()

        guard duration >= WrapUpLimits.minSeconds, let audio = bytes else { return nil }
        guard !audio.isEmpty, audio.count <= WrapUpLimits.maxBytes else { return nil }
        // Clamped to the cap, not merely measured against it. The auto-stop
        // fires AT the ceiling and this runs a moment later, so an unclamped
        // duration reads 121 for a recording we deliberately ended at 120 — and
        // the server refuses it. The one dictation the app stopped on the
        // member's behalf would have been the one guaranteed to fail, after
        // paying to upload it.
        let clamped = min(WrapUpLimits.maxSeconds, max(1, Int(duration.rounded())))
        return (audio: audio, seconds: clamped)
    }

    /// Throw the recording away unread — a cancelled press, or a member who
    /// left the thread mid-sentence. Safe to call when nothing is recording.
    func discard() {
        recorder?.stop()
        recorder = nil
        if let fileURL {
            try? FileManager.default.removeItem(at: fileURL)
        }
        fileURL = nil
        deactivate()
    }

    /// Hand the audio route back, and only if we took it. The category is
    /// deliberately left at `.record`: the attachment player re-sets
    /// `.playback` before it plays, and the softphone sets its own when a call
    /// starts.
    private func deactivate() {
        guard sessionActive else { return }
        sessionActive = false
        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: [.notifyOthersOnDeactivation]
        )
    }
}

/// POST /v1/conversations/:id/wrap-up-transcript — the one door.
///
/// On `MultipartClient` because `ApiClient` speaks only JSON bodies and this is
/// a file upload; the same place `uploadNoteFile` lives. NEVER throws: a
/// wrap-up that fails must leave the composer exactly as it was.
extension MultipartClient {
    func wrapUpTranscript(
        companyId: String,
        conversationId: String,
        audio: Data,
        seconds: Int,
        /// #228 — declared LAST and defaulted, so every existing call site is
        /// unchanged and the sentences below reach the reader in their language.
        locale: String? = nil
    ) async -> WrapUpOutcome {
        let raw: Data
        do {
            raw = try await postFile(
                path: "/v1/conversations/\(conversationId)/wrap-up-transcript",
                companyId: companyId,
                fields: [("seconds", String(seconds))],
                fileField: "audio",
                fileName: "wrap-up.m4a",
                contentType: "audio/mp4",
                bytes: audio
            )
        } catch {
            // The server's own words when it has any — a refused number level
            // or an expired session says far more than "model_error" would.
            return .failed(error.userMessage)
        }
        guard let decoded = try? JSONDecoder().decode(WrapUpTranscript.self, from: raw) else {
            return .failed(wrapUpFailureMessage("unusable_output", locale: locale))
        }
        guard let text = decoded.text, !text.isBlank else {
            return .failed(wrapUpFailureMessage(decoded.reason, locale: locale))
        }
        return .text(text)
    }
}
