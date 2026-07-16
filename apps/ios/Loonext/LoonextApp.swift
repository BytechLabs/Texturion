import SwiftUI

@main
struct LoonextApp: App {
    @State private var graph = AppGraph()

    var body: some Scene {
        WindowGroup {
            RootView(graph: graph)
                .tint(BrandColor.petrol)
                .preferredColorScheme(preferredScheme)
        }
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
