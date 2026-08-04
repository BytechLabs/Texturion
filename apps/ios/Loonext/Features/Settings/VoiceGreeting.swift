import AVFoundation
import Foundation

/**
 #309 — a greeting recorded in the owner's own voice.

 A two-person outfit competing with a franchise sells on being a real, local,
 reachable person. Then nobody answers and the product hands the caller a
 synthetic voice reading a company name, which in 2026 is what a spam call
 sounds like.

 The recorder below is deliberately close to `WrapUpDictationRecorder`, because
 that one has already been through the audio-session edge cases. It differs in
 one way that matters: a dictation is heard once by a transcriber, and a
 greeting is heard by every customer who calls — so the sample rate is set for
 LISTENING rather than for speech recognition.
 */
struct VoicemailGreeting: Codable, Sendable, Identifiable {
    var id = ""
    var name = ""
    var duration_ms = 0
    var mime_type = ""
    var byte_size = 0
    var created_at = ""
}

/// Two minutes, the same ceiling the API and the column enforce.
let maxGreetingMs = 120_000

/// "0:08" — a duration a person reads, not 8200.
func formatGreetingDuration(_ ms: Int) -> String {
    let total = max(0, ms / 1000)
    return "\(total / 60):\(String(format: "%02d", total % 60))"
}

/// Why a recording could not start, in words the owner can act on.
enum GreetingStartRefusal {
    case callInProgress
    case noPermission
    case couldNotStart

    var message: String {
        switch self {
        case .callInProgress:
            return "You are on a call. End it and try again."
        case .noPermission:
            return "Loonext needs the microphone to record a greeting. "
                + "Allow it in iOS Settings, then try again."
        case .couldNotStart:
            return "The microphone is not available right now. Try again."
        }
    }
}

/// One recorded take, and the file it lives in until it is saved or thrown away.
struct GreetingTake {
    let audio: Data
    let durationMs: Int
    let url: URL
}

/**
 Owns what SwiftUI cannot: the live `AVAudioRecorder`, the file underneath it,
 and the player that hears it back.
 */
@MainActor
final class GreetingRecorder: ObservableObject {
    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var fileURL: URL?
    private var startedAt = Date.distantPast
    private var sessionActive = false

    var isRecording: Bool { recorder != nil }

    /// Delete any greeting audio a previous run left behind.
    ///
    /// Every in-process path deletes its own file, but none of them runs if the
    /// app is killed mid-record. Named by prefix so it can only ever remove
    /// this feature's own files.
    static func sweepOrphans() {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: fm.temporaryDirectory,
            includingPropertiesForKeys: nil
        ) else { return }
        for url in entries where url.lastPathComponent.hasPrefix("greeting-") {
            try? fm.removeItem(at: url)
        }
    }

    func start(callInProgress: Bool) -> GreetingStartRefusal? {
        if isRecording { return nil }
        if callInProgress { return .callInProgress }

        // `.record`, never `.playAndRecord`: this app treats a `.playAndRecord`
        // session as "a call owns the audio", so borrowing that category here
        // would make an attachment play out of the earpiece afterwards. The
        // playback below re-activates its own session for the same reason.
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .spokenAudio)
            try session.setActive(true)
            sessionActive = true
        } catch {
            return .couldNotStart
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("greeting-\(UUID().uuidString).m4a")
        // Mono 44.1 kHz AAC. A customer hears this and the owner hears it back
        // before saving, so it is sized for LISTENING — where the dictation
        // recorder next door uses 16 kHz, which is right for a transcript and
        // thin for a greeting. Two minutes still lands well inside 2 MB.
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        let made: AVAudioRecorder
        do {
            made = try AVAudioRecorder(url: url, settings: settings)
        } catch {
            deactivate()
            return .couldNotStart
        }
        // The platform's own stop, under the UI's timer rather than instead of
        // it: a view that misses its tick must not leave a microphone open.
        guard made.record(forDuration: TimeInterval(maxGreetingMs) / 1000) else {
            deactivate()
            try? FileManager.default.removeItem(at: url)
            return .couldNotStart
        }
        recorder = made
        fileURL = url
        startedAt = Date()
        return nil
    }

    /// Stop and hand back the take. Nil means nothing worth keeping was caught.
    func finish() -> GreetingTake? {
        guard let made = recorder, let url = fileURL else {
            discard()
            return nil
        }
        made.stop()
        recorder = nil
        deactivate()
        guard let data = try? Data(contentsOf: url), !data.isEmpty else {
            try? FileManager.default.removeItem(at: url)
            fileURL = nil
            return nil
        }
        return GreetingTake(
            audio: data,
            durationMs: Int(Date().timeIntervalSince(startedAt) * 1000),
            url: url
        )
    }

    /**
     Hear it back.

     Not a nicety: the whole flow rests on an owner hearing their own take
     before it becomes what customers hear. Without this the card would ask
     them to trust a recording they have never heard.
     */
    func play(_ take: GreetingTake) -> Bool {
        player?.stop()
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio)
        try? session.setActive(true)
        guard let made = try? AVAudioPlayer(contentsOf: take.url) else { return false }
        player = made
        return made.play()
    }

    /// Throw the take away, and the bytes with it.
    func discard() {
        recorder?.stop()
        recorder = nil
        player?.stop()
        player = nil
        if let url = fileURL {
            try? FileManager.default.removeItem(at: url)
        }
        fileURL = nil
        deactivate()
    }

    private func deactivate() {
        guard sessionActive else { return }
        try? AVAudioSession.sharedInstance().setActive(false)
        sessionActive = false
    }
}
