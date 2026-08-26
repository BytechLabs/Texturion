import SwiftUI

@main
struct LoonextApp: App {
    /// Push plumbing (#162): installs the notification-center + FCM delegates
    /// early enough to catch a cold-start notification tap and feeds the APNs
    /// device token into FirebaseMessaging.
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate

    @State private var graph: AppGraph

    init() {
        // Paper & Olive fonts (Golos + Bricolage) before the first frame.
        DesignFonts.register()
        // #485: subscribe to MetricKit before anything else can crash. Apple
        // delivers a pending crash payload shortly after launch, so a
        // subscriber registered late is a payload nobody receives.
        CrashDiagnostics.start()
        // #507: delete any wrap-up audio a killed run left in the temporary
        // directory. Every in-process path deletes its own file; none of them
        // runs if the app dies mid-hold, and audio nobody promised to keep must
        // not outlive the process that recorded it.
        WrapUpRecorder.sweepOrphans()
        let graph = AppGraph()
        _graph = State(initialValue: graph)
        // Construct the softphone at launch (#161): the PushKit delegate must
        // exist before iOS redelivers a cold-start VoIP push — the CallKit
        // report has to happen inside that delivery.
        _ = CallsManager.get(graph: graph)
    }

    var body: some Scene {
        WindowGroup {
            // #330: OUTSIDE RootView, so a locked app does not build the inbox at
            // all rather than covering it. An overlay is one app-switcher snapshot
            // away from being nothing, and the switcher is exactly where a
            // handed-over phone shows its last screen.
            AppLockGate(prefs: graph.prefs) {
                RootView(graph: graph)
            }
                // #238: `.appLocale` chooses our catalogue; SwiftUI's native
                // locale environment carries the same resolved choice into its
                // text and accessibility systems. Both sit ABOVE AppLockGate so
                // the lock screen and app-switcher cover are in scope too.
                // Environment values preserve every child's own accessibility
                // element, role, state and action; this does not merge the tree.
                .environment(\.appLocale, appLocale)
                .environment(\.locale, UiLocale.platformLocale(appLocale))
                .tint(BrandColor.olive)
                .preferredColorScheme(preferredScheme)
                // Universal links: app.loonext.com/inbox/{id} and
                // /calls?call=… — parsed exactly like a notification tap
                // (legacy /conversations/{id} normalization included) and
                // buffered by PushHooks until the Ready shell installs its
                // router (cold-start links wait for it).
                .onOpenURL { routeUniversalLink($0) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { routeUniversalLink(url) }
                }
        }
    }

    /// One answer for both the product catalogue and native language metadata.
    private var appLocale: String { UiLocaleStore.shared.resolved }

    private func routeUniversalLink(_ url: URL) {
        guard let route = parsePushRoute(url: url.absoluteString) else { return }
        PushHooks.route(route)
    }

    /// Theme System/Light/Dark persisted in AppPrefs (mirrors the Android
    /// account sheet's choice). nil = follow the system.
    private var preferredScheme: ColorScheme? {
        switch graph.prefs.theme {
        case AppPrefs.Theme.light: .light
        case AppPrefs.Theme.dark: .dark
        default: nil
        }
    }
}
