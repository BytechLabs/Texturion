import SwiftUI

/// The theme switcher (#186 item 7): the shared `SegmentedControl` with the three
/// theme choices, so it matches Android and web and is not the flat grey iOS
/// `.segmented` Picker the account sheet and profile section used to show.
///
/// `theme` binds to `AppPrefs.theme` ("system" | "light" | "dark").
struct ThemeSegmentedControl: View {
    @Binding var theme: String

    @Environment(\.appLocale) private var appLocale

    private var options: [SegmentedOption<String>] {
        [
            SegmentedOption(
                AppPrefs.Theme.system,
                title: AppStrings.translate(appLocale, "common.themeSystem")
            ),
            SegmentedOption(
                AppPrefs.Theme.light,
                title: AppStrings.translate(appLocale, "common.themeLight")
            ),
            SegmentedOption(
                AppPrefs.Theme.dark,
                title: AppStrings.translate(appLocale, "common.themeDark")
            ),
        ]
    }

    var body: some View {
        SegmentedControl(options: options, selection: $theme)
    }
}

#Preview("Theme switcher") {
    @Previewable @State var theme = AppPrefs.Theme.system
    return ThemeSegmentedControl(theme: $theme)
        .padding()
        .background(BrandColor.canvas)
}
