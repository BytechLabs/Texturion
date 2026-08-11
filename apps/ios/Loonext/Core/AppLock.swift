import Foundation

/// #330 — whether the inbox should be behind a lock right now.
///
/// ## Why this exists at all
///
/// D12's customer is a crew of one to ten texting customers from PERSONAL
/// handsets. The device this app runs on is not a work device: it is the tech's
/// own phone, and a spare one lives in the truck and gets handed to whoever is
/// covering the weekend. Today there is nothing between "signed in" and "signed
/// out", so handing the phone over hands over every customer conversation.
///
/// ## The tension, and how it is resolved rather than dismissed
///
/// A lock is friction on the one thing this product promises — answering a
/// customer inside the five minutes that decide the job (#388). A crew sharing a
/// truck phone and a sole operator have OPPOSITE correct answers, so the lock is
/// optional and off by default, and the grace window below exists so that
/// checking a map and coming back is not a second authentication.
///
/// ## Pure on purpose, and the Kotlin twin is the same arithmetic
///
/// Every decision is here; `LAContext` is not. The rules — a cold start always
/// locks, the grace is a maximum, a clock that went backwards asks again — are
/// identical to `core/security/AppLock.kt`, because a lock that behaves
/// differently on the two phones a crew actually carries is a lock nobody can
/// describe to their staff.
enum AppLock {

    /// How long the app may be away before it locks again.
    ///
    /// Sixty seconds is chosen against the two real cases rather than as a round
    /// number. Glancing at the map, the dialler or a photo and coming back is
    /// seconds, and re-authenticating for that would teach people to turn this off
    /// — which protects nobody. Handing a phone to somebody else is longer than a
    /// minute in practice, and a cold start locks regardless.
    ///
    /// A MAXIMUM, not a promise: anything clearing the unlock earlier — a
    /// sign-out, the process being killed — locks sooner.
    static let graceSeconds: TimeInterval = 60

    /// Why the lock is showing, so the screen can say something true.
    enum Reason: CaseIterable {
        /// The process started fresh. Nothing is trusted across a cold start.
        case coldStart
        /// Away longer than the grace window.
        case awayTooLong
        /// Turned on while the app was open, so nothing has been unlocked yet.
        case neverUnlocked
    }

    /// Should the app be locked?
    ///
    /// - Parameters:
    ///   - enabled: the member turned the lock on for this device.
    ///   - unlockedAt: when the lock was last satisfied IN THIS PROCESS, or nil if
    ///     it has not been. Deliberately not persisted — see `coldStart`.
    ///   - now: the clock, passed in so this is testable and so a device whose
    ///     clock jumps cannot be reasoned about differently here than in a test.
    static func reasonToLock(
        enabled: Bool,
        unlockedAt: TimeInterval?,
        now: TimeInterval
    ) -> Reason? {
        guard enabled else { return nil }
        guard let unlockedAt else { return .neverUnlocked }
        // A CLOCK THAT WENT BACKWARDS LOCKS. A negative age should be impossible
        // and happens anyway — a manual time change, an NTP correction. Treating
        // it as "recently unlocked" would make moving the clock back a way past
        // the lock, so an age that cannot be trusted asks again.
        let age = now - unlockedAt
        if age < 0 { return .awayTooLong }
        if age > graceSeconds { return .awayTooLong }
        return nil
    }

    /// What the lock screen says, given why it is showing.
    ///
    /// Never "Session expired" or anything that reads as a fault. Nothing has gone
    /// wrong: the person turned this on, and the phone is theirs.
    /// #228: `locale` defaults to English rather than being required, because
    /// the only caller that cannot supply one is the unit test asserting the
    /// RULE — that this never reads as a fault — rather than the words.
    static func headline(_ reason: Reason, locale: String = MessageLocale.en) -> String {
        switch reason {
        case .coldStart, .awayTooLong:
            return AppStrings.translate(locale, "shell.lockHeadlineInbox")
        case .neverUnlocked:
            return AppStrings.translate(locale, "shell.lockHeadlineFinish")
        }
    }

    /// Whether the lock may be turned ON, given what the device can actually do.
    ///
    /// FAILS CLOSED IN THE HONEST DIRECTION: a device with no biometric and no
    /// passcode cannot enforce this, so the setting refuses rather than showing a
    /// lock anything can walk past. Silently accepting the toggle would leave
    /// somebody believing the phone in their glovebox was protected.
    static func canEnable(hasBiometric: Bool, hasPasscode: Bool) -> Bool {
        hasBiometric || hasPasscode
    }

    /// Why it cannot be turned on, for the one case where that is true.
    static let cannotEnableNote =
        "Set a passcode, Face ID or Touch ID on this phone first — without one "
        + "there is nothing for this to ask you for."
}
