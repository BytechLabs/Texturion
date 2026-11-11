import SwiftUI

/// #733: the one count pill, a small round token holding a number: a filter's active
/// count, a title's total, the older pins behind a banner (web: `CountPill`).
///
/// `quiet` is the inset default; `primary` is for a count that asks to be noticed. The
/// label and the fill are each a token that carries its own role (D100), so neither
/// is a hardcoded white. `medium` sits beside a label; `small` is the corner badge on
/// an icon.
struct CountPill: View {
    enum Tone { case quiet, primary }
    enum Size { case small, medium }

    let text: String
    var tone: Tone
    var size: Size

    init(_ count: Int, tone: Tone = .quiet, size: Size = .medium) {
        self.text = String(count)
        self.tone = tone
        self.size = size
    }

    init(_ text: String, tone: Tone = .quiet, size: Size = .medium) {
        self.text = text
        self.tone = tone
        self.size = size
    }

    private var label: Color {
        tone == .primary ? BrandColor.paper : BrandColor.muted700
    }

    private var fill: Color {
        tone == .primary ? BrandColor.ink : BrandColor.inset
    }

    var body: some View {
        Text(text)
            .font(.golos(size == .medium ? 11 : 9.5, weight: .semibold))
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(label)
            .padding(.horizontal, 5)
            .frame(minWidth: 17, minHeight: 17)
            .background(fill, in: Capsule())
    }
}

#Preview("Count pill") {
    HStack(spacing: 12) {
        CountPill(3)
        CountPill(12, tone: .primary)
        CountPill("+4", size: .small)
    }
    .padding()
    .background(BrandColor.canvas)
}
