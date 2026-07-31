import SwiftUI
import UIKit
import XCTest
@testable import Loonext

/// #320 — the phone palettes were never measured, and it showed.
///
/// Theme bugs kept arriving one at a time, found by a person happening to
/// toggle: auth screens unreadable in light (#218), map pins illegible in dark
/// (#219). Each was fixed properly; the pattern was the problem. The web app
/// grew `globals.contrast.test.ts` for exactly this and the phones never got
/// the equivalent, so their palettes had never been checked against a
/// threshold by anything.
///
/// The first run of this file failed. `muted500` — 77 `Text` views, including
/// error messages and empty states — measured **3.01:1** on the canvas ground
/// in light mode. `olive`, which carries text at ~90 call sites, was 4.04:1.
/// The destructive message inside its own error container was 4.26:1. None of
/// those had ever been reported, because nothing was looking.
///
/// WHY RESOLVED COLOURS AND NOT A SOURCE PARSE. `BrandColor` builds its tokens
/// from `UIColor { traits in … }`, so the value that reaches the screen is
/// whatever that closure returns for the current trait collection. Parsing the
/// hex literals out of the file would test the literals; resolving through
/// `UITraitCollection` tests what a person actually sees, and it keeps working
/// if the token is ever expressed some other way.
///
/// WHAT THIS DELIBERATELY DOES NOT DO is pixel-diff screenshots. #320's own
/// devil's advocate is right that they produce noisy diffs which get
/// rubber-stamped, converting a gate into a rubber stamp. Ratios fail only when
/// something is genuinely wrong.
final class BrandColorContrastTests: XCTestCase {

    // MARK: - Measurement

    private func rgb(_ color: Color, dark: Bool) -> (r: CGFloat, g: CGFloat, b: CGFloat) {
        let traits = UITraitCollection(userInterfaceStyle: dark ? .dark : .light)
        let resolved = UIColor(color).resolvedColor(with: traits)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        resolved.getRed(&r, green: &g, blue: &b, alpha: &a)
        return (r, g, b)
    }

    /// WCAG 2.2 relative luminance.
    private func luminance(_ color: Color, dark: Bool) -> CGFloat {
        let (r, g, b) = rgb(color, dark: dark)
        func channel(_ c: CGFloat) -> CGFloat {
            c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

    private func contrast(_ fg: Color, on bg: Color, dark: Bool) -> CGFloat {
        let a = luminance(fg, dark: dark)
        let b = luminance(bg, dark: dark)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    /// WCAG 1.4.3 — body text.
    private let aa: CGFloat = 4.5
    /// WCAG 1.4.11 — non-text: icons, marks, control boundaries.
    private let nonText: CGFloat = 3.0

    private func assertReadable(
        _ fg: Color,
        _ fgName: String,
        on bg: Color,
        _ bgName: String,
        floor: CGFloat,
        dark: Bool,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let ratio = contrast(fg, on: bg, dark: dark)
        XCTAssertGreaterThanOrEqual(
            ratio, floor,
            "\(fgName) on \(bgName) in \(dark ? "dark" : "light") is "
                + String(format: "%.2f", Double(ratio))
                + ":1, below \(floor):1. A token below the floor is text somebody "
                + "cannot read — raise the token, do not lower the bar.",
            file: file, line: line
        )
    }

    // MARK: - The surfaces text can land on

    private var surfaces: [(String, Color)] {
        [
            ("canvas", BrandColor.canvas),
            ("paper", BrandColor.paper),
            ("inset", BrandColor.inset),
            ("insetDeep", BrandColor.insetDeep),
            ("avatarTint", BrandColor.avatarTint),
            ("cream", BrandColor.cream),
        ]
    }

    /// Every token used with `foregroundStyle` on a `Text`. `muted250` is
    /// absent on purpose — it draws chevrons, 1px dividers and stroke borders,
    /// never a glyph of copy — and it is asserted separately at the non-text
    /// bar. That distinction is the whole reason this list is written out by
    /// hand instead of looping over the type: an exemption has to be a claim
    /// somebody made, not a gap.
    private var textTokens: [(String, Color)] {
        [
            ("ink", BrandColor.ink),
            ("muted900", BrandColor.muted900),
            ("muted700", BrandColor.muted700),
            ("muted600", BrandColor.muted600),
            ("muted500", BrandColor.muted500),
            ("muted400", BrandColor.muted400),
            ("muted300", BrandColor.muted300),
            ("olive", BrandColor.olive),
        ]
    }

    // MARK: - Tests

    func testEveryTextTokenIsReadableOnEverySurfaceInBothThemes() {
        for dark in [false, true] {
            for (fgName, fg) in textTokens {
                for (bgName, bg) in surfaces {
                    assertReadable(fg, fgName, on: bg, bgName, floor: aa, dark: dark)
                }
            }
        }
    }

    func testLabelsOnFilledControlsAreReadableInBothThemes() {
        // A fill and its label are one decision. These are the pairs where the
        // label is NOT the ordinary ink, and each is the shape that breaks
        // silently when only one half of the pair moves between themes.
        for dark in [false, true] {
            assertReadable(BrandColor.onLime, "onLime", on: BrandColor.lime, "lime", floor: aa, dark: dark)
            assertReadable(
                BrandColor.onLimeChip, "onLimeChip",
                on: BrandColor.limeChip, "limeChip", floor: aa, dark: dark
            )
            assertReadable(
                BrandColor.onLimeChip, "onLimeChip",
                on: BrandColor.limeWash, "limeWash", floor: aa, dark: dark
            )
            // The pill nav is dark in BOTH themes, which is exactly why its
            // label is a fixed pair rather than the adaptive one.
            assertReadable(
                BrandColor.paperFixed, "paperFixed",
                on: BrandColor.inkFixed, "inkFixed", floor: aa, dark: dark
            )
        }
    }

    func testStatusColoursAreReadableOnTheirOwnContainers() {
        // The message inside the error box, and the notice inside the amber
        // well. Both were below AA in light before #320 measured them.
        for dark in [false, true] {
            assertReadable(
                BrandColor.destructive, "destructive",
                on: BrandColor.destructiveContainer, "destructiveContainer",
                floor: aa, dark: dark
            )
            assertReadable(
                BrandColor.overdueAmber, "overdueAmber",
                on: BrandColor.amberBg, "amberBg", floor: aa, dark: dark
            )
            // They also appear as plain text on the ordinary grounds.
            for (bgName, bg) in [("canvas", BrandColor.canvas), ("paper", BrandColor.paper)] {
                assertReadable(BrandColor.destructive, "destructive", on: bg, bgName, floor: aa, dark: dark)
                assertReadable(BrandColor.overdueAmber, "overdueAmber", on: bg, bgName, floor: aa, dark: dark)
            }
        }
    }

    func testNonTextMarksClearTheNonTextBar() {
        // 1.4.11: these carry meaning without carrying copy, so 3:1 is the
        // right bar — holding them to 4.5 would make the check argue about
        // things that are fine, and a guard that argues gets switched off.
        //
        // `muted250` is NOT here, and the reason is the same distinction 1.4.11
        // itself draws. It paints 1px dividers, card stroke borders, and the
        // disclosure chevron — none of which is the thing that identifies a
        // control or its state. A row is tappable because of its layout and its
        // copy; the chevron repeats that, it does not carry it, and the divider
        // could be replaced by whitespace with nothing lost. Holding a hairline
        // to 3:1 would make every list on the phone look ruled rather than
        // spaced, which is the opposite of the design. The web app treats its
        // own `--border` the same way, at ~1.1:1.
        for dark in [false, true] {
            for (bgName, bg) in [("canvas", BrandColor.canvas), ("paper", BrandColor.paper)] {
                assertReadable(BrandColor.coral, "coral (attention dot)", on: bg, bgName, floor: nonText, dark: dark)
            }
            // #219: the map pin is deliberately theme-INDEPENDENT because it
            // sits on raster tiles rather than on our surfaces. What still has
            // to hold is its own glyph against its own balloon.
            assertReadable(
                BrandColor.paperFixed, "map pin glyph",
                on: BrandColor.mapPin, "mapPin", floor: nonText, dark: dark
            )
        }
    }

    func testTheThemeActuallySwitches() {
        // A resolver that ignored the trait collection would make every
        // assertion above pass twice over the same values, which is the way
        // this whole file could silently stop testing anything.
        let lightCanvas = luminance(BrandColor.canvas, dark: false)
        let darkCanvas = luminance(BrandColor.canvas, dark: true)
        XCTAssertGreaterThan(
            lightCanvas, darkCanvas + 0.5,
            "canvas did not change between themes — the trait resolution is not working"
        )
        // …and a token that is fixed on purpose must NOT move.
        XCTAssertEqual(
            luminance(BrandColor.inkFixed, dark: false),
            luminance(BrandColor.inkFixed, dark: true),
            accuracy: 0.0001,
            "inkFixed is the pill nav, which is dark in both themes by design"
        )
    }
}
