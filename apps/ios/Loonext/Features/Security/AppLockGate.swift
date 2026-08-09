import LocalAuthentication
import SwiftUI
import UIKit

/// #330 — the lock in front of the inbox on a phone that is not a work phone.
///
/// ## What this covers, and what it deliberately does not
///
/// It covers the handover: a spare phone in the truck passed to whoever is
/// covering the weekend, or a personal handset left on a kitchen table. It does
/// NOT pretend to defend against somebody who has the phone and time — that is
/// the device passcode and disk encryption, and duplicating them here would be
/// theatre.
///
/// ## Why the wiring is thin
///
/// Everything decidable is in `AppLock` with unit tests, shared rule-for-rule
/// with the Android twin: cold start always locks, the grace window is a maximum,
/// a clock that went backwards asks again. What is left here is the part no unit
/// test can run — showing the system's own sheet — kept small so there is little
/// to be wrong.
///
/// ## The unlock is per-process and never written down
///
/// `unlockedAt` lives in this view's state and nowhere else. Persisting it would
/// mean a phone unlocked before it was handed over stays unlocked after, which is
/// the whole case this exists for.
///
/// ## #581: the lock answers on the way IN, so the way OUT needed its own answer
///
/// `reason` is recomputed when the app becomes active, which is one phase too
/// late. iOS photographs the window for the app-switcher card as the app LEAVES,
/// and for the first sixty seconds after each unlock that picture is a live thread
/// — a contact's name and their last message, readable by anybody holding the
/// phone, without the lock being asked once. A cover is put up on the way out so
/// that it is what gets photographed instead.
///
/// TWO covers, and the second is not belt-and-braces. A SwiftUI `.overlay`
/// composes INSIDE the presenting hierarchy, while `.sheet` and
/// `.fullScreenCover` are UIKit modal presentations whose views sit above the
/// presenting controller's in the window — and the switcher photographs the
/// WINDOW. So an overlay here covers the inbox and the pushed thread and
/// nothing presented over them: the photo gallery a customer's picture opens
/// in, the compose sheet with a recipient and a draft, the notifications
/// sheet, the in-call screen with the caller's name. All four hold exactly
/// what this is for, and all four are one tap from ordinary use.
/// `PrivacyCoverWindow` is therefore the one that actually closes it; the
/// overlay stays because it costs nothing and still covers the common case if
/// no window scene can be found.
struct AppLockGate<Content: View>: View {
    let prefs: AppPrefs
    @ViewBuilder var content: () -> Content

    /// nil until the first successful unlock IN THIS PROCESS — see the header.
    @State private var unlockedAt: TimeInterval?
    @State private var prompting = false
    @Environment(\.scenePhase) private var scenePhase

    /// Bumped on every return to active, which is the moment that matters: the
    /// question is not "was this ever unlocked" but "has it been away long enough
    /// that somebody else could be holding it".
    @State private var activeTick = 0

    /// #581 — the app is not frontmost, so whatever is on screen right now is
    /// what the switcher card will be.
    @State private var awayFromForeground = false

    private var reason: AppLock.Reason? {
        _ = activeTick
        return AppLock.reasonToLock(
            enabled: prefs.appLockEnabled,
            unlockedAt: unlockedAt,
            now: Date().timeIntervalSince1970
        )
    }

    var body: some View {
        Group {
            if let reason {
                // THE CONTENT IS NOT BUILT WHILE LOCKED, rather than covered by an
                // overlay: an overlay is one screenshot away from being nothing.
                //
                // #581: it is NOT what keeps the inbox out of the switcher card,
                // which this comment used to claim. That picture is taken while the
                // app is still unlocked and still building the thread, so nothing
                // decided here reaches it — `privacyCover` does.
                locked(reason)
            } else {
                content()
            }
        }
        // #581: COVERED, not swapped out. Branching to the cover instead would give
        // it a different view identity from `content()`, so every glance at the map
        // and back would rebuild the whole app and lose the reader's place in the
        // thread they were half-way through answering — a worse product than the
        // bug.
        //
        // This overlay is NOT sufficient on its own — see the header. It sits
        // inside the presenting hierarchy, so anything presented as a sheet or a
        // full-screen cover is photographed with nothing over it.
        // `PrivacyCoverWindow` below is what covers those.
        //
        // Only while the setting is on: somebody who never asked for a lock should
        // still recognise their own app in the switcher.
        .overlay {
            if prefs.appLockEnabled, awayFromForeground { privacyCover }
        }
        .onChange(of: scenePhase) { _, phase in
            // Answered on the way OUT as well as the way in. `.inactive` is the
            // last phase iOS asks the app to draw in before it takes the picture,
            // so this is the only moment the cover can still get in front of it.
            //
            // Set inside a transaction that forbids animation: a cover that fades
            // in is a photograph of a half-visible inbox.
            var immediate = Transaction()
            immediate.disablesAnimations = true
            withTransaction(immediate) { awayFromForeground = phase != .active }
            // The window, which is what covers a presented sheet. Same trigger and
            // same gate as the overlay, so the two can never disagree about
            // whether the app is supposed to be covered.
            if prefs.appLockEnabled, phase != .active {
                PrivacyCoverWindow.shared.show()
            } else {
                PrivacyCoverWindow.shared.hide()
            }
            if phase == .active { activeTick += 1 }
        }
    }

    /// What the app switcher gets instead of somebody's customers.
    ///
    /// Deliberately not blank. A blank card reads as an app that crashed or failed
    /// to load, and the person most likely to see it is the owner, who should be
    /// able to tell at a glance that their own setting is doing its job. It carries
    /// no affordance for the same reason it carries no data: a snapshot cannot be
    /// tapped, so an "Unlock" button here would be a picture of a lie.
    ///
    /// Sized against the SHRUNKEN card rather than the screen — the switcher draws
    /// it at roughly a third, so this borrows the locked screen's headline rung
    /// rather than its body rung, which would be about five points by then.
    private var privacyCover: some View {
        VStack(spacing: 12) {
            Image(systemName: "lock.fill")
                .font(.scaled(34))
                .foregroundStyle(BrandColor.ink)
            Text("Locked")
                .font(.golos(17, weight: .semibold))
                .foregroundStyle(BrandColor.muted700)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BrandColor.canvas)
        .ignoresSafeArea()
    }

    private func locked(_ reason: AppLock.Reason) -> some View {
        VStack(spacing: 12) {
            Text(AppLock.headline(reason))
                .font(.golos(17, weight: .semibold))
                .multilineTextAlignment(.center)
            // Says whose data it is protecting, not whose fault this is.
            Text("Your customers' conversations are on this phone.")
                .font(.golos(14))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Unlock") { authenticate() }
                .buttonStyle(.borderedProminent)
                .disabled(prompting)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BrandColor.paper)
        // Asked once on arrival so the common case is Face ID and not a tap then
        // Face ID. The button stays for a refusal, a timeout, or a sheet the phone
        // dismissed because it rang.
        .task(id: reason) { authenticate() }
    }

    private func authenticate() {
        guard !prompting else { return }
        prompting = true
        let context = LAContext()
        // `deviceOwnerAuthentication`, NOT `…WithBiometrics`: it accepts the
        // passcode too. A tradesperson's phone may have a passcode and no working
        // Face ID (gloves, plaster dust, a cracked front camera), and biometrics-
        // only would offer the feature to the people with the newest hardware and
        // refuse it to everyone else.
        context.evaluatePolicy(
            .deviceOwnerAuthentication,
            localizedReason: "Your customers' conversations are on this phone"
        ) { success, _ in
            Task { @MainActor in
                prompting = false
                if success { unlockedAt = Date().timeIntervalSince1970 }
            }
        }
    }
}

/// Whether this phone can enforce a lock at all — see `AppLock.canEnable`.
@MainActor
func deviceCanLock() -> Bool {
    let context = LAContext()
    var error: NSError?
    let biometric = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    var passcodeError: NSError?
    let anyOwner = LAContext().canEvaluatePolicy(
        .deviceOwnerAuthentication,
        error: &passcodeError
    )
    return AppLock.canEnable(hasBiometric: biometric, hasPasscode: anyOwner)
}
