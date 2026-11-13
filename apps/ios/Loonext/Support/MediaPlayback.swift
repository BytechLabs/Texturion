import AVFoundation

/// Keyed on the call, not the category, which stays `.playAndRecord` after a call ends.
enum MediaPlaybackDecision {
    case leaveAlone
    case usePlayback

    static func decide(callEngaged: Bool) -> MediaPlaybackDecision {
        callEngaged ? .leaveAlone : .usePlayback
    }

    /// A recorder or a call that took the session after `play()` keeps it.
    static func mayRelease(callEngaged: Bool, category: AVAudioSession.Category) -> Bool {
        decide(callEngaged: callEngaged) == .usePlayback && category == .playback
    }

    @MainActor
    static var callEngagedNow: Bool {
        CallsManager.peek()?.state.anyEngaged ?? false
    }
}

/// The ring switch mutes the default category, and an ended call leaves audio on the earpiece.
@MainActor
func prepareMediaPlayback() {
    let decision = MediaPlaybackDecision.decide(callEngaged: MediaPlaybackDecision.callEngagedNow)
    guard decision == .usePlayback else { return }
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .spokenAudio)
    try? session.setActive(true)
}

@MainActor
func releaseMediaPlayback() {
    let session = AVAudioSession.sharedInstance()
    guard MediaPlaybackDecision.mayRelease(
        callEngaged: MediaPlaybackDecision.callEngagedNow,
        category: session.category
    ) else { return }
    try? session.setActive(false, options: [.notifyOthersOnDeactivation])
}
