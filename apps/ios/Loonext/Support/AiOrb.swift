import SwiftUI

/// What the assistant is doing right now. Mirrors the web and Android states.
enum AiOrbState {
    case idle
    case thinking
    case working
    case done
}

/// THE AI MARK, iOS twin of apps/web/src/components/ui/ai-orb.tsx.
///
/// Every AI surface in the product wears this and nothing else, so a crew learns
/// "this is Lou" once and recognises it everywhere. A ring of dots rather than a
/// sparkle: sparkles are what every other product uses, and this reads at any
/// size.
///
/// Idle rests evenly lit. Thinking runs a pulse around the ring, one dot at a
/// time. Working turns the whole ring. Motion is dropped under Reduce Motion,
/// where the states stay distinguishable by weight alone.
@MainActor
struct AiOrb: View {
    var state: AiOrbState = .idle
    var size: CGFloat = 20

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var animating: Bool {
        !reduceMotion && (state == .thinking || state == .working)
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !animating)) { timeline in
            Canvas { context, canvasSize in
                let count = 8
                let radius = min(canvasSize.width, canvasSize.height) / 2 * 0.78
                let dot = min(canvasSize.width, canvasSize.height) * 0.13
                let centre = CGPoint(x: canvasSize.width / 2, y: canvasSize.height / 2)
                let period: Double = state == .working ? 1.4 : 1.1
                let phase = animating
                    ? timeline.date.timeIntervalSinceReferenceDate
                        .truncatingRemainder(dividingBy: period) / period
                    : 0

                for i in 0..<count {
                    let fraction = Double(i) / Double(count)
                    // Working turns the whole ring; thinking travels a pulse.
                    let spin = state == .working ? phase : 0
                    let angle = (fraction + spin) * 2 * .pi - .pi / 2
                    let opacity: Double
                    switch state {
                    case .thinking where !reduceMotion:
                        let d = (fraction - phase).truncatingRemainder(dividingBy: 1)
                        let wrapped = d < 0 ? d + 1 : d
                        opacity = wrapped < 0.25 ? 0.3 + (1 - wrapped / 0.25) * 0.7 : 0.3
                    case .idle:
                        opacity = 0.32
                    default:
                        opacity = 0.85
                    }
                    let origin = CGPoint(
                        x: centre.x + cos(angle) * radius - dot / 2,
                        y: centre.y + sin(angle) * radius - dot / 2
                    )
                    context.fill(
                        Path(ellipseIn: CGRect(origin: origin, size: CGSize(width: dot, height: dot))),
                        with: .color(BrandColor.olive.opacity(opacity))
                    )
                }
            }
        }
        .frame(width: size, height: size)
    }
}
