import LocalAuthentication
import SwiftUI

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
                // overlay. An overlay is one screenshot — or one app-switcher
                // snapshot — away from being nothing, and the switcher is exactly
                // where a handed-over phone shows its last screen.
                locked(reason)
            } else {
                content()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { activeTick += 1 }
        }
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
