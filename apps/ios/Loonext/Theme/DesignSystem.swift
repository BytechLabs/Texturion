import CoreText
import SwiftUI

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

extension Font {
    /// The display voice: Bricolage Grotesque SemiBold — screen titles only.
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .custom("Bricolage Grotesque", size: size).weight(weight)
    }

    /// Golos Text at an explicit size (body voice; system-metrics fallback).
    static func golos(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("Golos Text", size: size).weight(weight)
    }
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
