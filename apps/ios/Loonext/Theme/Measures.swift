import SwiftUI

/// #540 — the dashboard's measures, drawn.
///
/// The hand-port of `apps/web/src/components/ui/proportion-ring.tsx` and
/// `share-bar.tsx`, and the third copy after `ui/common/Measures.kt`. The phones
/// shipped the same four measures as numbers in boxes while the laptop got the
/// marks, which reads as two different products — a founder comparing the two
/// sees the same figures presented as if one screen had not been finished.
///
/// ## Two shapes, and the difference is not decorative
///
/// A RING says "how much of one thing" — one part against one whole. A BAR says
/// what a whole is MADE of. The quotes panel asks the second question (won, still
/// out, gone quiet), and forcing that into an arc loses the middle one, which is
/// the only one anybody can still act on.
///
/// ## Accessibility is the part these usually get wrong
///
/// A shape alone is nothing to VoiceOver and nothing to somebody who cannot
/// separate the tones. Both take a SENTENCE from the caller, and neither ever
/// carries a figure that is not also written on the card as text.
///
/// Colour comes from the CALLER: a colour is a fill or a label, never both
/// (D100), and only the card knows which of its own tones mean what.

/// A proportion, as a closing ring.
///
/// Nothing done draws NO arc rather than a dot — a round cap at zero length still
/// paints a mark, and a mark reads as a small amount of something rather than
/// none of it. A caller reporting more done than exists gets a closed ring rather
/// than an arc that has wrapped round and looks like almost nothing.
struct ProportionRing: View {
    let value: Double
    let total: Double
    /// What VoiceOver says. A sentence, not a percentage.
    let label: String
    let color: Color
    var size: CGFloat = 22

    private var fraction: Double {
        let safeTotal = max(0, total)
        guard safeTotal > 0 else { return 0 }
        return min(max(0, value), safeTotal) / safeTotal
    }

    private var stroke: CGFloat { max(2.5, size / 9) }

    var body: some View {
        ZStack {
            // The track. Deliberately faint: it is the amount still to do, and a
            // strong ring for the part NOT done reads as a warning about work
            // that may be perfectly fine.
            Circle()
                .stroke(color.opacity(0.15), lineWidth: stroke)
            if fraction > 0 {
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(
                        color,
                        style: StrokeStyle(lineWidth: stroke, lineCap: .round)
                    )
                    // From the top rather than from three o'clock, which is where
                    // every reader expects a progress ring to start.
                    .rotationEffect(.degrees(-90))
            }
        }
        .padding(stroke / 2)
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel(label)
    }
}

/// One part of a whole, for ``ShareBar``.
struct ShareSegment: Identifiable {
    let label: String
    let value: Double
    let color: Color

    var id: String { label }
}

/// A whole, split into its parts.
///
/// Segments summing to LESS than the total leave the remainder as bare track,
/// which is the honest picture — the gap is the part nobody has accounted for,
/// and stretching the parts to fill the bar would hide the number worth chasing.
struct ShareBar: View {
    let segments: [ShareSegment]
    let total: Double
    /// What VoiceOver says. A sentence, not a set of percentages.
    let label: String
    var height: CGFloat = 6

    /// Clamped cumulatively, so a caller whose parts add to more than the whole
    /// gets a full bar rather than segments running off the end. That happens for
    /// real: the parts and the total are separate figures from the server, and a
    /// lagging window can disagree with itself by one.
    private var shares: [(segment: ShareSegment, fraction: Double)] {
        let safeTotal = max(0, total)
        guard safeTotal > 0 else { return [] }
        var used = 0.0
        return segments.map { segment in
            let v = min(max(0, segment.value), safeTotal - used)
            used += v
            return (segment, v / safeTotal)
        }
    }

    var body: some View {
        // Nothing to divide. An empty track reads as a panel that failed to load
        // rather than as a month with no quotes in it.
        if max(0, total) == 0 {
            EmptyView()
        } else {
            GeometryReader { geo in
                HStack(spacing: 0) {
                    ForEach(shares, id: \.segment.id) { share in
                        if share.fraction > 0 {
                            Rectangle()
                                .fill(share.segment.color)
                                .frame(width: geo.size.width * share.fraction)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .frame(height: height)
            // The track BEHIND the segments, so the unaccounted remainder is
            // visible as a gap rather than as nothing at all.
            .background(BrandColor.inset)
            .clipShape(Capsule())
            .accessibilityElement()
            .accessibilityLabel(label)
        }
    }
}

/// The small heading above a measure card.
///
/// #540: two of the four measures put their title INSIDE the card and two put it
/// above, so the four read as two different species of panel in one list. On web
/// the same split showed up as card tops thirty pixels apart in a row, which is a
/// large part of what "looks amateur" meant on that screen.
///
/// One heading, so there is one answer. `trailing` is for the 7/30/90 window the
/// two windowed cards carry; the others pass a quiet note or nothing.
struct MeasureHeader<Trailing: View>: View {
    let label: String
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(label.uppercased())
                .font(.golos(10.5, weight: .bold))
                .kerning(1.2)
                .foregroundStyle(BrandColor.muted500)
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 7)
    }
}

extension MeasureHeader where Trailing == EmptyView {
    init(_ label: String) {
        self.label = label
        self.trailing = { EmptyView() }
    }
}
