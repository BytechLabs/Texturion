import UIKit

/// Semantic haptics for the whole app — the iOS twin of Android's
/// `ui/common/Haptics.kt`, with the SAME FIVE VERBS and the same rule: call
/// them by MEANING, not by effect, so every surface speaks one physical
/// language.
///
/// ## Why this exists
///
/// Android had 362 haptic calls across 47 files. This platform had none — on
/// the phone whose haptic engine is the one people can actually tell apart, and
/// where Apple's own guidance treats feedback as part of the interaction rather
/// than decoration. A crew member using the iPhone got a silent, flat product
/// while the same crew on Android felt every send, answer and refusal.
///
/// ## The mapping, and why each one
///
///  - ``tap``     light impact: keypad digits, chips, segmented pills, toggles.
///                The Android twin is `KEYBOARD_TAP`.
///  - ``tick``    selection change: pickers, sliders, moving between options.
///                `UISelectionFeedbackGenerator` is the platform's own name for
///                exactly this, and it is deliberately sub-perceptual — a
///                scrub that buzzed would be unbearable at speed.
///  - ``confirm`` something COMMITTED: send, save, answer, task done. The
///                `.success` notification, which is the two-beat pattern iOS
///                users already read as "done".
///  - ``reject``  something refused or destructive: decline, delete, an error
///                the person needs to notice. `.error` is three beats and is
///                unmistakably not a success.
///  - ``heavy``   entering a new mode: long-press to drag or reorder. A medium
///                impact rather than heavy — `.heavy` on this platform reads as
///                a malfunction rather than as a mode change.
///
/// ## Two properties this inherits for free, and both matter
///
/// The system haptics switch is honoured by `UIFeedbackGenerator` itself, so a
/// person who has turned haptics off is never buzzed and no call site has to
/// ask. And Low Power Mode silently suppresses haptics — which is correct, and
/// is the reason a haptic may never be the ONLY signal that something happened.
/// Every call site here is paired with something visible.
///
/// ## Why the generators are held rather than made per call
///
/// A generator warmed by `prepare()` fires in single-digit milliseconds; a
/// freshly constructed one has to spin up the Taptic Engine first and can land
/// late enough to feel disconnected from the tap that caused it. They are
/// `@MainActor` because UIKit feedback is main-thread-only, which also makes
/// the shared instances safe under Swift 6 concurrency rather than needing a
/// lock — the failure mode this codebase has already paid for once.
@MainActor
enum Haptics {
    private static let light = UIImpactFeedbackGenerator(style: .light)
    private static let medium = UIImpactFeedbackGenerator(style: .medium)
    private static let selection = UISelectionFeedbackGenerator()
    private static let notification = UINotificationFeedbackGenerator()

    /// Light touch: keypad digits, chips, segmented pills, toggles.
    static func tap() {
        light.impactOccurred()
    }

    /// Sub-perceptual scrub: pickers, sliders, selection moves.
    static func tick() {
        selection.selectionChanged()
    }

    /// Something COMMITTED: send, save, answer, task done.
    static func confirm() {
        notification.notificationOccurred(.success)
    }

    /// Something refused or destructive: decline, delete, error.
    static func reject() {
        notification.notificationOccurred(.error)
    }

    /// Long-press affordances entering a new mode (drag, reorder).
    static func heavy() {
        medium.impactOccurred()
    }

    /// Warm the engine for a burst that is about to start.
    ///
    /// Called when a surface that fires repeatedly APPEARS — the dialer is the
    /// case this exists for. Without it the first digit of a phone number feels
    /// late and the rest do not, which reads as a stutter in the keypad rather
    /// than as a cold engine.
    ///
    /// Safe to call more than once and safe to never call: `prepare()` is a
    /// hint, and the engine idles back down on its own.
    static func prepare() {
        light.prepare()
        selection.prepare()
    }
}
