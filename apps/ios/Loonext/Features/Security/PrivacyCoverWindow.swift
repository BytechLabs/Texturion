import SwiftUI
import UIKit

/// The app-lock privacy cover, in a window of its own.
///
/// ## Why a whole window
///
/// `AppLockGate` already puts an `.overlay` up when the app leaves the foreground,
/// which is what stops the switcher card being a photograph of the inbox. It is not
/// enough, and the reason is a SwiftUI/UIKit seam rather than an oversight: an
/// `.overlay` composes INSIDE the presenting view hierarchy, while `.sheet` and
/// `.fullScreenCover` are UIKit modal presentations whose views sit ABOVE the
/// presenting controller's view in the window. The switcher photographs the window.
///
/// So the overlay covers the inbox and a pushed thread, and covers nothing
/// presented over them. In this app that is not a corner: the photo gallery a
/// customer's picture opens into, the compose sheet with a recipient and a draft,
/// the notifications sheet, and the in-call screen with the caller's name are all
/// modal presentations, all hold exactly what the lock exists to protect, and all
/// are one tap from ordinary use.
///
/// A window at a level above `.alert` is above every presentation, because
/// presentations live in the window they were presented from.
///
/// ## What it deliberately is not
///
/// Not `FLAG_SECURE`'s counterpart. iOS has no per-window "exclude from the
/// snapshot" switch, so this replaces the picture rather than suppressing it —
/// which is the same thing for this purpose and, unlike Android's flag, does not
/// also block the screenshots people take to send a colleague a thread.
///
/// Not interactive, and never on while the app is frontmost: `isUserInteractionEnabled`
/// is false so a mis-sequenced show can never swallow a tap, and the only caller
/// hides it on `.active`.
@MainActor
final class PrivacyCoverWindow {
    static let shared = PrivacyCoverWindow()

    private var window: UIWindow?
    /// Kept so a later `show` can restate the cover in the reader's language —
    /// see `show(locale:)`.
    private var host: UIHostingController<PrivacyCoverContent>?

    private init() {}

    /// Put the cover up. Safe to call repeatedly.
    ///
    /// - Parameter locale: #228 — the reader's language. A parameter rather than
    ///   an environment read, because this window is a ROOT: it is built outside
    ///   any SwiftUI hierarchy, so it inherits nothing and would render English
    ///   for a French crew. The only caller is `AppLockGate`, which knows the
    ///   answer. Defaulted so nothing here depends on the caller remembering.
    func show(locale: String = MessageLocale.en) {
        // Deferred to first use rather than built at launch: a window that exists
        // is a window that can be shown by mistake, and the overwhelmingly common
        // session never backgrounds with the lock enabled.
        if window == nil {
            guard let scene = activeScene() else {
                // No scene to attach to — the overlay in `AppLockGate` is what
                // covers the common case, and there is nothing to photograph
                // without a scene anyway. Silent on purpose: this runs on the way
                // out of the foreground, where logging is unreliable and a
                // customer-visible failure is not available to us.
                return
            }
            let hosted = UIHostingController(rootView: PrivacyCoverContent(locale: locale))
            hosted.view.backgroundColor = .clear
            let created = UIWindow(windowScene: scene)
            // Above `.alert`, which is above every modal presentation in the
            // window. `.statusBar` would not be: a full-screen cover draws over it.
            created.windowLevel = .alert + 1
            created.isUserInteractionEnabled = false
            created.rootViewController = hosted
            host = hosted
            window = created
        } else {
            // The window outlives a language change made in Settings, and this
            // is the only moment it is asked to draw again.
            host?.rootView = PrivacyCoverContent(locale: locale)
        }
        window?.isHidden = false
    }

    func hide() {
        window?.isHidden = true
    }

    private func activeScene() -> UIWindowScene? {
        // The scene the app is actually in. `.first` over all connected scenes
        // would pick an unattached one on iPad multi-window, and the cover would
        // go up over a window nobody is looking at while the visible one stayed
        // photographable.
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState != .unattached }
    }
}

/// The cover itself: opaque, and says why rather than looking like a crash.
///
/// Same words and same mark as `AppLockGate`'s inline cover, because a reader who
/// sees one of them in the switcher and the other on returning should not think two
/// different things happened.
private struct PrivacyCoverContent: View {
    /// #228: handed in rather than read from the environment — this view is the
    /// root of its own window and inherits nothing from the app's hierarchy.
    let locale: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "lock.fill")
                .font(.scaled(34))
                .foregroundStyle(BrandColor.ink)
            Text(AppStrings.translate(locale, "shell.lockedCover"))
                .font(.golos(17, weight: .semibold))
                .foregroundStyle(BrandColor.muted700)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BrandColor.canvas)
        .ignoresSafeArea()
    }
}
