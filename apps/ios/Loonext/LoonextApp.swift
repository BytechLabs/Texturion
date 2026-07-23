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
        let graph = AppGraph()
        _graph = State(initialValue: graph)
        // Construct the softphone at launch (#161): the PushKit delegate must
        // exist before iOS redelivers a cold-start VoIP push — the CallKit
        // report has to happen inside that delivery.
        _ = CallsManager.get(graph: graph)
    }

    var body: some Scene {
        WindowGroup {
            RootView(graph: graph)
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
