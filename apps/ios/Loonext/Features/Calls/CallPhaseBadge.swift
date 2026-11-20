import SwiftUI

extension CallPhase {
    var statusKey: String {
        switch self {
        case .ringing: "contactsTasks.phaseIncoming"
        case .connecting: "contactsTasks.phaseCalling"
        case .active: "contactsTasks.phaseActive"
        case .held: "contactsTasks.phaseOnHold"
        case .ended: "contactsTasks.phaseEnded"
        }
    }

    fileprivate var icon: String {
        switch self {
        case .ringing: "phone.arrow.down.left"
        case .connecting: "phone.arrow.up.right"
        case .active: "phone"
        case .held: "pause"
        case .ended: "phone.down"
        }
    }

    fileprivate var badgeFill: Color {
        switch self {
        case .ringing: BrandColor.destructiveContainer
        case .active: BrandColor.limeChip
        case .held: BrandColor.amberBg
        case .connecting, .ended: BrandColor.inset
        }
    }

    fileprivate var badgeLabel: Color {
        switch self {
        case .ringing: BrandColor.destructive
        case .active: BrandColor.onLimeChip
        case .held: BrandColor.overdueAmber
        case .connecting: BrandColor.ink
        case .ended: BrandColor.muted700
        }
    }

    fileprivate var litPixels: Int {
        switch self {
        case .ringing: 5
        case .active: 4
        case .connecting: 3
        case .held: 2
        case .ended: 1
        }
    }
}

struct CallPhaseIcon: View {
    let phase: CallPhase

    var body: some View {
        Image(systemName: phase.icon)
            .font(.scaled(IconSize.standard, weight: .semibold))
            .foregroundStyle(phase.badgeLabel)
            .frame(width: 40, height: 40)
            .background(phase.badgeFill, in: RoundedRectangle(cornerRadius: 12))
            .accessibilityHidden(true)
    }
}

struct CallPhaseBadge: View {
    let phase: CallPhase

    @Environment(\.appLocale) private var appLocale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var brightness = 1.0

    var body: some View {
        HStack(spacing: 6) {
            HStack(spacing: 2) {
                ForEach(0..<5) { index in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(phase.badgeLabel.opacity(index < phase.litPixels ? brightness : 0.25))
                        .frame(width: 2, height: index.isMultiple(of: 2) ? 3 : 7)
                }
            }
            .accessibilityHidden(true)
            Text(AppStrings.translate(appLocale, phase.statusKey))
                .font(.golos(11, weight: .semibold))
                .foregroundStyle(phase.badgeLabel)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(phase.badgeFill, in: Capsule())
        .task(id: phase == .ringing && !reduceMotion) {
            brightness = 1
            guard phase == .ringing, !reduceMotion else { return }
            for step in 0..<6 {
                withAnimation(.easeInOut(duration: 0.56)) {
                    brightness = step.isMultiple(of: 2) ? 0.35 : 1
                }
                try? await Task.sleep(for: .milliseconds(560))
                if Task.isCancelled { return }
            }
        }
    }
}
