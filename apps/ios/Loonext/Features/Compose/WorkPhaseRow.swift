import SwiftUI

/// #294 — before or after, on the note carrying the photos.
///
/// ## Evaluation
///
/// A tech attaching photos to a note has one more thing to say, and it is the one
/// classification the trade actually uses: is this how it looked when I arrived, or
/// how I left it. The whole value depends on it costing nothing — somebody standing in
/// a customer's kitchen with wet hands will not open a menu.
///
/// ## What binds it
///
/// *Prioritize Intent* — it appears only once there are photos. A before/after choice
/// on a text-only note is noise on the most common thing anybody does in this
/// composer.
///
/// *Smart Defaults, and the one place that rule inverts* — nothing is preselected.
/// Everywhere else a sensible default saves a decision; here it would invent one. Most
/// notes are neither, so defaulting to Before would mislabel the majority, and a job
/// record that is confidently wrong is worse than one that says nothing.
///
/// *Zen of Clarity* — two chips, not a three-option menu with "None". Tapping the
/// selected one clears it, so there is no third control for undo.
///
/// *Relationship Strength* — directly under the file chips it describes, because it is
/// a property of those files rather than of the note's words.
@MainActor
struct WorkPhaseRow: View {
    let value: String?
    let onChange: @MainActor (String?) -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        HStack(spacing: 8) {
            ForEach(WorkPhase.all, id: \.self) { phase in
                let on = value == phase
                Button {
                    // Tap the selected one to clear it: the honest answer for most
                    // notes is neither, and it has to be reachable after a mis-tap.
                    onChange(on ? nil : phase)
                } label: {
                    Text(WorkPhase.label(phase, locale: appLocale))
                        .font(.golos(12.5))
                        .foregroundStyle(on ? BrandColor.paper : BrandColor.muted600)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(
                            on ? BrandColor.ink : BrandColor.canvas,
                            in: Capsule()
                        )
                        .overlay(
                            Capsule().stroke(
                                // muted250 is the named non-text rung for 1px
                                // strokes, exempt from the AA text assertion.
                                on ? Color.clear : BrandColor.muted250,
                                lineWidth: 1
                            )
                        )
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? [.isSelected] : [])
            }
            Text(AppStrings.translate(appLocale, WorkPhase.hintKey))
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted600)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(AppStrings.translate(appLocale, "thread.workPhaseAria"))
    }
}
