import SwiftUI

/// The styled theme switcher (#186 item 7) — an inset capsule track with an INK
/// pill for the selected segment and muted labels for the rest. This is the
/// Paper & Olive segmented control (matching Android/web), NOT the flat gray
/// iOS `.segmented` Picker the account sheet and profile section used to show.
///
/// `theme` binds to `AppPrefs.theme` ("system" | "light" | "dark").
struct ThemeSegmentedControl: View {
    @Binding var theme: String

    private let options: [(value: String, label: String)] = [
        (AppPrefs.Theme.system, "System"),
        (AppPrefs.Theme.light, "Light"),
        (AppPrefs.Theme.dark, "Dark"),
    ]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.value) { option in
                let selected = theme == option.value
                Button {
                    if theme != option.value { theme = option.value }
                } label: {
                    Text(option.label)
                        .font(.golos(12, weight: .semibold))
                        .foregroundStyle(selected ? BrandColor.paper : BrandColor.muted700)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(selected ? BrandColor.ink : Color.clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(option.label)
                .accessibilityAddTraits(selected ? [.isSelected] : [])
            }
        }
        .padding(4)
        .background(BrandColor.insetDeep, in: Capsule())
        .animation(.easeInOut(duration: 0.15), value: theme)
    }
}

#Preview("Theme switcher") {
    @Previewable @State var theme = AppPrefs.Theme.system
    return ThemeSegmentedControl(theme: $theme)
        .padding()
        .background(BrandColor.canvas)
}
