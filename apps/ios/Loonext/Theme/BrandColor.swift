import SwiftUI
import UIKit

/// Loonext brand palette — mirrors apps/web globals.css (G11 "calm petrol")
/// and the Android ui/theme/Color.kt ramp: warm stone neutrals + exactly one
/// rationed petrol accent.
///
/// Dark mode: the petrol accent lifts to #2FB3A5 and text ON petrol goes
/// NEAR-BLACK #04110E (AA — the epic's binding brand invariant).
enum BrandColor {
    // MARK: Fixed brand values

    static let petrolLight = Color(hex: 0x0F766E)
    static let petrolDark = Color(hex: 0x2FB3A5)
    static let petrolDeepFixed = Color(hex: 0x0B4F49)
    static let petrolTintFixed = Color(hex: 0xEDF3F1)
    static let onPetrolDark = Color(hex: 0x04110E)

    // Warm stone neutrals (Tailwind stone scale — the web's neutral ramp).
    static let stone50 = Color(hex: 0xFAFAF9)
    static let stone100 = Color(hex: 0xF5F5F4)
    static let stone200 = Color(hex: 0xE7E5E4)
    static let stone300 = Color(hex: 0xD6D3D1)
    static let stone400 = Color(hex: 0xA8A29E)
    static let stone500 = Color(hex: 0x78716C)
    static let stone600 = Color(hex: 0x57534E)
    static let stone700 = Color(hex: 0x44403C)
    static let stone800 = Color(hex: 0x292524)
    static let stone900 = Color(hex: 0x1C1917)
    static let stone950 = Color(hex: 0x0C0A09)

    // Supporting hues (amber notices, red destructive — web tokens).
    static let amberFixed = Color(hex: 0xB45309)
    static let amberBg = Color(hex: 0xFEF3C7)
    static let destructive = Color(hex: 0xB91C1C)

    // MARK: Adaptive roles (light / dark)

    /// The one accent: app tint, selected tab, primary buttons.
    static let petrol = adaptive(light: 0x0F766E, dark: 0x2FB3A5)

    /// Text/icons ON a petrol fill — near-black in dark mode (AA).
    static let onPetrol = adaptive(light: 0xFAFAF9, dark: 0x04110E)

    /// Quiet petrol container (avatars, selected chips).
    static let petrolContainer = adaptive(light: 0xEDF3F1, dark: 0x0B4F49)

    /// Text/icons on `petrolContainer`.
    static let onPetrolContainer = adaptive(light: 0x0B4F49, dark: 0xEDF3F1)

    /// Overdue = amber, never red (calm system).
    static let overdueAmber = adaptive(light: 0xB45309, dark: 0xF59E0B)

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255.0,
            green: CGFloat((hex >> 8) & 0xFF) / 255.0,
            blue: CGFloat(hex & 0xFF) / 255.0,
            alpha: 1.0
        )
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0
        )
    }
}
