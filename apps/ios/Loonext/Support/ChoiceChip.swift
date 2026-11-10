import SwiftUI

/// #726: one option in a row of choices.
///
/// A chosen chip is filled and carries a check; an unchosen one is a plain
/// outline, so a single option on its own can never be mistaken for the answer.
/// The one chip every single-choice row on the phone uses: language, lead
/// source, work phase, the photo tool, the task pickers. The Android twin is
/// `ChoiceChip` in `ui/common`.
struct ChoiceChip: View {
    let label: String
    let chosen: Bool
    var disabled: Bool = false
    /// A touch-target floor for rows that sit among larger controls.
    var minHeight: CGFloat? = nil
    let action: @MainActor () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if chosen {
                    Image(systemName: "checkmark")
                        .font(.scaled(10, weight: .bold))
                        .accessibilityHidden(true)
                }
                Text(label)
                    .font(.golos(12.5, weight: chosen ? .semibold : .regular))
            }
            .foregroundStyle(chosen ? BrandColor.paper : BrandColor.muted600)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .frame(minHeight: minHeight)
            .background(chosen ? BrandColor.ink : Color.clear, in: Capsule())
            .overlay(
                Capsule().stroke(
                    // muted250 is the named non-text rung for 1px strokes,
                    // exempt from the AA text assertion.
                    chosen ? Color.clear : BrandColor.muted250,
                    lineWidth: 1
                )
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(label)
        .accessibilityAddTraits(chosen ? [.isSelected] : [])
    }
}
