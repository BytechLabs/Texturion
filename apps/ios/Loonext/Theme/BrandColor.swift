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
    static let canvas = adaptive(light: 0xF3F3F3, dark: 0x151515)

    /// Card / raised surface ("paper").
    static let paper = adaptive(light: 0xFDFDFD, dark: 0x212121)

    /// Primary text + dark buttons / the pill nav.
    static let ink = adaptive(light: 0x1A1A1A, dark: 0xF0F0F0)

    /// Fixed ink — shadows that must stay dark whichever theme is on.
    static let inkFixed = Color(hex: 0x1A1A1A)
    static let paperFixed = Color(hex: 0xFDFDFD)

    /// #556 — the nav capsule's fill, which is NOT `inkFixed` in dark.
    ///
    /// The pill was `inkFixed` in both themes. On the paper canvas that is the
    /// design: a dark control on a light ground. On the DARK canvas (0x151515)
    /// it is 0x1A1A1A — **five parts in 255** — and the app's most-used control
    /// stops being a control and becomes five icons loose at the bottom of the
    /// screen. Found on Android by rendering the shell and measuring the
    /// capsule against the ground beside it: a luminance standoff of 0.851 in
    /// light against 0.024 in dark. This phone had the identical values.
    ///
    /// The shadow does not rescue it — a shadow whose colour is ink casts
    /// nothing onto a near-black ground, which is the general reason dark
    /// themes express elevation as a LIGHTER SURFACE rather than as a drop
    /// shadow.
    ///
    /// Both dark values are already pinned in this file (0x2E2E2E is
    /// `avatarTint`'s dark rung, 0x4B4B4B is `muted250`'s, the one documented
    /// for stroke borders), so nothing here was eyeball-adjusted — which the
    /// header of this file forbids.
    static let navPill = adaptive(light: 0x1A1A1A, dark: 0x2E2E2E)

    /// The capsule's hairline. Equal to the fill in light, so it costs nothing
    /// there and needs no `colorScheme` check at the call site.
    static let navPillEdge = adaptive(light: 0x1A1A1A, dark: 0x4B4B4B)

    /// Inset wells / hairline dividers.
    static let inset = adaptive(light: 0xEFEFEF, dark: 0x252525)

    /// Deeper inset (segmented tracks, input fills).
    static let insetDeep = adaptive(light: 0xE8E8E8, dark: 0x282828)

    /// Highest raised tint (avatar bg, selected wells).
    static let avatarTint = adaptive(light: 0xE5E5E5, dark: 0x2E2E2E)

    // MARK: Muted ladder (headings → hints)
    //
    // #320 — THE LADDER HAS THREE TEXT RUNGS, NOT SEVEN.
    //
    // The canvas specifies seven greys and the app used them as a hierarchy:
    // muted500 alone carries 77 `Text` views — error messages, empty states,
    // status lines like "No teammates can take this call right now." At its
    // canvas value 0x8C8C8C that measured **3.01:1 on the canvas ground**,
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
    static let muted900 = adaptive(light: 0x4B4B4B, dark: 0xCACACA)
    /// Secondary text. 5.17:1 light / 4.51:1 dark.
    static let muted700 = adaptive(light: 0x5D5D5D, dark: 0x979797)
    /// The quiet rung — captions, timestamps, hints, placeholders. 4.56:1
    /// light / 4.51:1 dark. muted600/500/400/300 are one value: the ladder ran
    /// out of legible room, and pretending otherwise is what shipped the bug.
    static let muted600 = adaptive(light: 0x656565, dark: 0x979797)
    static let muted500 = adaptive(light: 0x656565, dark: 0x979797)
    static let muted400 = adaptive(light: 0x656565, dark: 0x979797)
    static let muted300 = adaptive(light: 0x656565, dark: 0x979797)
    /// NOT a text rung: chevrons, 1px dividers, stroke borders. Held to the
    /// non-text bar (WCAG 1.4.11) and exempt from the AA assertion by name.
    static let muted250 = adaptive(light: 0xB5B5B5, dark: 0x4B4B4B)

    // MARK: The accent family (exactly one hue, rationed)

    /// Deep olive: counts, links, positive emphasis — it CARRIES TEXT, at ~90
    /// `foregroundStyle` call sites. #320: the canvas value 0x777777 is 4.04:1
    /// on the canvas ground and 4.41:1 on paper, i.e. under AA on the two
    /// surfaces it is used on most. 0x666666 is the same hue one step down:
    /// 5.15:1 worst case. Dark is unchanged (7.89:1 worst).
    static let olive = adaptive(light: 0x666666, dark: 0xA3E635)

    /// Lime highlight fill (Answer button, selected states).
    static let lime = adaptive(light: 0x84CC16, dark: 0xA3E635)

    /// Ink on a lime fill (fixed — lime is light in both themes).
    static let onLime = Color(hex: 0x1A1A1A)

    /// Task-map marker — theme-INDEPENDENT deep olive (#219). The map pin must
    /// stay legible on the raster tiles in BOTH themes: the adaptive `olive`
    /// turns pale lime (`0xA3E635`) in dark mode, which washes out against the
    /// tiles and drops the contrast of the marker's white pin glyph. A fixed
    /// deep olive keeps the balloon AND its glyph readable regardless of scheme
    /// (mirrors Android pinning the marker to a high-contrast color).
    static let mapPin = Color(hex: 0x777777)

    /// Pale lime chip ("New lead").
    static let limeChip = adaptive(light: 0xD8F5AC, dark: 0x3E3E3E)
    static let onLimeChip = adaptive(light: 0x1A1A1A, dark: 0xBDEE6B)

    /// Selection wash.
    static let limeWash = adaptive(light: 0xBDEE6B, dark: 0x3E3E3E)

    /// Coral attention dot — unread/alerts, NEVER an error color.
    static let coral = adaptive(light: 0xD96C47, dark: 0xE0764B)

    /// Warm cream well (pinned / internal notes).
    static let cream = adaptive(light: 0xEFE3CE, dark: 0x2E2E2E)

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
