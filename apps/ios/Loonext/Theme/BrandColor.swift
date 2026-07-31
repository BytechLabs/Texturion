import SwiftUI
import UIKit

/// Loonext "Paper & Olive" palette — the founder's Claude Design system
/// (Loonext Mobile.dc.html, project 42514b71; contract: docs/MOBILE-DESIGN.md).
/// Warm paper surfaces, near-black olive ink, ONE rationed lime/olive accent
/// family, coral attention dot. Values are verbatim from the canvas; light and
/// dark are both pinned there — do not eyeball-adjust.
///
/// The pre-redesign petrol/stone aliases are retired (#206) — every call site
/// speaks the semantic Paper & Olive names.
enum BrandColor {
    // MARK: Core surfaces

    /// Screen background.
    static let canvas = adaptive(light: 0xF3F3EE, dark: 0x141610)

    /// Card / raised surface ("paper").
    static let paper = adaptive(light: 0xFDFDF9, dark: 0x1F2218)

    /// Primary text + dark buttons / the pill nav.
    static let ink = adaptive(light: 0x191B14, dark: 0xF0F1E5)

    /// Fixed ink (the pill nav stays dark in BOTH themes).
    static let inkFixed = Color(hex: 0x191B14)
    static let paperFixed = Color(hex: 0xFDFDF9)

    /// Inset wells / hairline dividers.
    static let inset = adaptive(light: 0xF0F0E8, dark: 0x23261A)

    /// Deeper inset (segmented tracks, input fills).
    static let insetDeep = adaptive(light: 0xE7E9DC, dark: 0x262A1D)

    /// Highest raised tint (avatar bg, selected wells).
    static let avatarTint = adaptive(light: 0xE4E6D7, dark: 0x2C2F22)

    // MARK: Muted ladder (headings → hints)
    //
    // #320 — THE LADDER HAS THREE TEXT RUNGS, NOT SEVEN.
    //
    // The canvas specifies seven greys and the app used them as a hierarchy:
    // muted500 alone carries 77 `Text` views — error messages, empty states,
    // status lines like "No teammates can take this call right now." At its
    // canvas value 0x8B8E7D that measured **3.01:1 on the canvas ground**,
    // well under AA, and muted400/muted300 (placeholders, "At least 8
    // characters.", relative timestamps, keypad letters) were worse.
    //
    // Nothing caught it because nothing ever measured the phone palettes; the
    // web app's equivalent step was fixed for exactly this in #61 and the fix
    // never crossed over. That is #320's thesis in one token.
    //
    // Warm paper does not have room for seven legible greys. Between ink and
    // the AA floor there are three distinguishable steps, so the rungs below
    // the third collapse onto it. Hierarchy under that floor is carried by
    // SIZE and WEIGHT — a grey too faint to read is not a hierarchy level, it
    // is text nobody can read.
    //
    // The NAMES all survive so no call site changes; what changes is that
    // every one of them is now legible. Ratios are worst-case across every
    // surface text can land on (canvas, paper, inset, insetDeep, avatarTint,
    // cream) and are asserted in BrandColorContrastTests.

    /// Strong secondary text. 6.84:1 light / 8.35:1 dark.
    static let muted900 = adaptive(light: 0x4A4D3C, dark: 0xC9CCBA)
    /// Secondary text. 5.17:1 light / 4.51:1 dark.
    static let muted700 = adaptive(light: 0x5C5F4E, dark: 0x939683)
    /// The quiet rung — captions, timestamps, hints, placeholders. 4.56:1
    /// light / 4.51:1 dark. muted600/500/400/300 are one value: the ladder ran
    /// out of legible room, and pretending otherwise is what shipped the bug.
    static let muted600 = adaptive(light: 0x64675A, dark: 0x939683)
    static let muted500 = adaptive(light: 0x64675A, dark: 0x939683)
    static let muted400 = adaptive(light: 0x64675A, dark: 0x939683)
    static let muted300 = adaptive(light: 0x64675A, dark: 0x939683)
    /// NOT a text rung: chevrons, 1px dividers, stroke borders. Held to the
    /// non-text bar (WCAG 1.4.11) and exempt from the AA assertion by name.
    static let muted250 = adaptive(light: 0xB4B7A6, dark: 0x4A4D3C)

    // MARK: The accent family (exactly one hue, rationed)

    /// Deep olive: counts, links, positive emphasis — it CARRIES TEXT, at ~90
    /// `foregroundStyle` call sites. #320: the canvas value 0x66801F is 4.04:1
    /// on the canvas ground and 4.41:1 on paper, i.e. under AA on the two
    /// surfaces it is used on most. 0x586E1B is the same hue one step down:
    /// 5.15:1 worst case. Dark is unchanged (7.89:1 worst).
    static let olive = adaptive(light: 0x586E1B, dark: 0xB9CF57)

    /// Lime highlight fill (Answer button, selected states).
    static let lime = adaptive(light: 0xC9DE54, dark: 0xB9CF57)

    /// Ink on a lime fill (fixed — lime is light in both themes).
    static let onLime = Color(hex: 0x191B14)

    /// Task-map marker — theme-INDEPENDENT deep olive (#219). The map pin must
    /// stay legible on the raster tiles in BOTH themes: the adaptive `olive`
    /// turns pale lime (`0xB9CF57`) in dark mode, which washes out against the
    /// tiles and drops the contrast of the marker's white pin glyph. A fixed
    /// deep olive keeps the balloon AND its glyph readable regardless of scheme
    /// (mirrors Android pinning the marker to a high-contrast color).
    static let mapPin = Color(hex: 0x66801F)

    /// Pale lime chip ("New lead").
    static let limeChip = adaptive(light: 0xE3EFA3, dark: 0x39421A)
    static let onLimeChip = adaptive(light: 0x3A430F, dark: 0xD6E77E)

    /// Selection wash.
    static let limeWash = adaptive(light: 0xD6E77E, dark: 0x39421A)

    /// Coral attention dot — unread/alerts, NEVER an error color.
    static let coral = adaptive(light: 0xD96C47, dark: 0xE0764B)

    /// Warm cream well (pinned / internal notes).
    static let cream = adaptive(light: 0xEFE3CE, dark: 0x2C2F22)

    // MARK: Status

    /// Destructive — warm brick, not neon red. #320: light was 0xB0442B, which
    /// is 4.26:1 on its own container — the error message inside the error box
    /// was the thing below AA. 0xA94129 measures 4.55:1 there and 5.19:1 on the
    /// canvas ground.
    static let destructive = adaptive(light: 0xA94129, dark: 0xE08B72)
    static let destructiveContainer = adaptive(light: 0xF4DAD2, dark: 0x39231C)

    /// Overdue/notice amber, kept warm for paper. #320: light was 0x9A6B15 —
    /// 3.85:1 on its own well and 4.20:1 on the ground. 0x8C6113 clears both
    /// (4.50:1 / 4.92:1) and stays in the same warm family.
    static let overdueAmber = adaptive(light: 0x8C6113, dark: 0xD9A441)
    static let amberBg = adaptive(light: 0xF4E8CD, dark: 0x2E2712)

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
