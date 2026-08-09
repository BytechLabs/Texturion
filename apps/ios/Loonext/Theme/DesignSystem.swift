import CoreText
import SwiftUI
// UIFontMetrics and UIFont.TextStyle, for the system-font scaling below.
import UIKit

/// The shared "Paper & Olive" kit (docs/MOBILE-DESIGN.md) — the SwiftUI twin
/// of Android's ui/common/Ds.kt. Surfaces compose these instead of re-deriving
/// the grammar.
enum DesignFonts {
    /// Registers the bundled variable fonts (Golos Text + Bricolage Grotesque,
    /// both OFL) with CoreText. Runtime registration avoids Info.plist
    /// UIAppFonts (the plist is XcodeGen-generated from build settings).
    /// Idempotent; failures degrade to system fonts, never crash.
    static func register() {
        for name in ["GolosText", "BricolageGrotesque"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}

/// Dynamic Type support for the point sizes this kit is drawn in (#238).
///
/// WHY A REFERENCE STYLE IS NEEDED AT ALL. Neither `Font.custom(_:size:)` nor
/// `Font.system(size:)` scales with the reader's text-size setting: both take a
/// literal point size and render it, at 100% forever. Somebody who has turned
/// text up because they cannot otherwise read it gets the same 13pt caption
/// they could not read. The APIs that DO scale both want to know which text
/// style the size is standing in for, so scaling stays proportionate: a 30pt
/// title and a 12pt caption must not grow by the same number of points.
///
/// The mapping is nearest-by-default-size, against Apple's sizes at the Large
/// (default) content size category. Nearest rather than a hand-written table
/// per call site because there are seven hundred of them, and a table nobody
/// can maintain decays into a table nobody trusts.
///
/// Rendering at the default setting is UNCHANGED. `relativeTo:` and
/// `UIFontMetrics.scaledValue(for:)` both return the literal size at Large, so
/// this is additive: the kit looks exactly as drawn, and now moves when asked.
enum TypeScale {
    /// Apple's default point size for each style at the Large content size.
    private static let anchors: [(size: CGFloat, swiftUI: Font.TextStyle, uiKit: UIFont.TextStyle)] = [
        (34, .largeTitle, .largeTitle),
        (28, .title, .title1),
        (22, .title2, .title2),
        (20, .title3, .title3),
        (17, .body, .body),
        (16, .callout, .callout),
        (15, .subheadline, .subheadline),
        (13, .footnote, .footnote),
        (12, .caption, .caption1),
        (11, .caption2, .caption2),
    ]

    private static func anchor(for size: CGFloat) -> (size: CGFloat, swiftUI: Font.TextStyle, uiKit: UIFont.TextStyle) {
        anchors.min(by: { abs($0.size - size) < abs($1.size - size) }) ?? anchors[4]
    }

    /// The style a custom font at this size should scale in step with.
    static func textStyle(for size: CGFloat) -> Font.TextStyle {
        anchor(for: size).swiftUI
    }

    /// The same size, grown or shrunk by the reader's setting.
    ///
    /// For the system font only, which has no `relativeTo:` variant. Reading
    /// the metric here rather than through `@ScaledMetric` keeps this a plain
    /// `Font` factory usable anywhere a font is; SwiftUI re-evaluates the body
    /// when the content size category changes, so the value stays current.
    static func scaledValue(for size: CGFloat) -> CGFloat {
        UIFontMetrics(forTextStyle: anchor(for: size).uiKit).scaledValue(for: size)
    }

    /// #569: how much of a fixed badge two wide initials may fill.
    ///
    /// Kept as a named constant because Android holds the same number, and
    /// `scripts/check-avatar-glyph-bounds.mjs` compares the two files and fails when
    /// they drift — a rule written once per platform is a rule that disagrees with
    /// itself eventually.
    static let avatarGlyphDivisor: CGFloat = 2.1

    /// The reader's size for `wanted`, capped so the initials stay inside `box`.
    ///
    /// An initials badge is a fixed number of points wide and its glyph is not: the
    /// point size carries the reader's Dynamic Type setting and the frame does not.
    /// Measured on the shipped faces, two initials run about 1.6x the point size wide
    /// and a wide pair like "WM" about 1.86x, so the app's 40pt circle at `size * 0.38`
    /// held about 28pt of ink at Large and more than the full 40 by the top of the
    /// accessibility range — and a SwiftUI `.frame` does not clip, so the letters spill
    /// out over the name beside them.
    ///
    /// The glyph follows the reader until a wide pair would touch the rim, then holds.
    /// Nothing moves at Large. Growing the badge instead was considered and measured
    /// against on Android (#569) for three reasons that apply here identically: the
    /// overflow is horizontal, the crowded rows have no width to give, and the name
    /// beside the badge already scales in full — which is what a reader who asked for
    /// large text actually needs from a two-letter recognition mark.
    ///
    /// Because the returned value is already scaled, apply it with a fixed-size font
    /// (`Font.custom(_:fixedSize:)` or `.system(size:)`), never with a `relativeTo:`
    /// variant — that would scale it a second time.
    static func boundedGlyph(box: CGFloat, wanted: CGFloat) -> CGFloat {
        min(scaledValue(for: wanted), box / avatarGlyphDivisor)
    }
}

extension Font {
    /// The display voice: Bricolage Grotesque SemiBold, screen titles only.
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .custom("Bricolage Grotesque", size: size, relativeTo: TypeScale.textStyle(for: size))
            .weight(weight)
    }

    /// Golos Text at an explicit size (body voice; system-metrics fallback).
    static func golos(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("Golos Text", size: size, relativeTo: TypeScale.textStyle(for: size))
            .weight(weight)
    }

    /// The system font at an explicit size, scaling with the reader's setting.
    ///
    /// Use instead of `.system(size:)`, which does not scale. Kept as a
    /// separate entry point rather than folded into `golos` because the sites
    /// that reach for the system font want its metrics: tabular digits, and
    /// alignment with the SF Symbols beside them.
    static func scaled(_ size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Font {
        .system(size: TypeScale.scaledValue(for: size), weight: weight, design: design)
    }

    /// A point size that has ALREADY been through the reader's setting.
    ///
    /// The only caller is the initials badge, whose glyph is scaled and then capped to
    /// its frame by `TypeScale.boundedGlyph` (#569). Applying that result through
    /// `.scaled` or a `relativeTo:` font would scale it a second time and undo the cap,
    /// so it has to be applied fixed — which is why this lives here, in the one file
    /// `check-native-a11y` trusts to construct a non-scaling font, next to the reason.
    ///
    /// `check-avatar-glyph-bounds` is what keeps that trust honest from the other side:
    /// it proves the value handed in came from `boundedGlyph`, so "fixed" here can only
    /// ever mean "already scaled", never "ignores the reader".
    static func boundedGlyph(
        _ points: CGFloat,
        face: AvatarTypeface,
        weight: Font.Weight = .regular
    ) -> Font {
        switch face {
        case .system: .system(size: points, weight: weight)
        case .golos: .custom("Golos Text", fixedSize: points).weight(weight)
        }
    }
}

/// The typeface an initials badge draws in.
///
/// Two cases because the app currently uses both, and that is worth being able to see:
/// the shared badge draws in the system face while the three hand-rolled copies it
/// replaced drew in Golos, which is what Android and web use. Unifying them changes 20
/// surfaces and belongs to its own issue rather than to the #569 bound.
enum AvatarTypeface {
    case system
    case golos
}

/// Rounded-22 paper card that rows live inside.
struct PaperCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .background(BrandColor.paper)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

/// Tracked uppercase micro-label + olive tabular count.
struct SectionHeader: View {
    let label: String
    var count: Int? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(label.uppercased())
                .font(.golos(10.5, weight: .bold))
                .kerning(1.2)
                .foregroundStyle(BrandColor.muted500)
            if let count, count > 0 {
                Text("\(count)")
                    .font(.golos(10.5, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(BrandColor.olive)
            }
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 7)
    }
}

/// The big screen heading: Bricolage SemiBold 30, tight tracking.
struct ScreenTitle: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.display(30))
            .kerning(-0.3)
            .foregroundStyle(BrandColor.ink)
    }
}

/// Pill status chip — pale lime by default ("New lead").
struct DsChip: View {
    let text: String
    var container: Color = BrandColor.limeChip
    var content: Color = BrandColor.onLimeChip

    var body: some View {
        Text(text)
            .font(.golos(10, weight: .bold))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(container, in: Capsule())
            .foregroundStyle(content)
    }
}

/// Hairline between card rows.
struct RowDivider: View {
    var body: some View {
        Rectangle().fill(BrandColor.inset).frame(height: 1)
    }
}

/// The coral attention dot — unread marks, live badges. Never an error.
struct AttentionDot: View {
    var size: CGFloat = 8

    var body: some View {
        Circle().fill(BrandColor.coral).frame(width: size, height: size)
    }
}
