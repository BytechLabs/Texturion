import SwiftUI

/// #367 depth (1) — what the caller said, above the transcript it came from.
///
/// ABOVE, and that is the whole layout decision. The transcript is the record;
/// this is the shortcut, and a shortcut printed after the thing it shortens is
/// not one. Somebody glancing at a row on a roof reads two labelled lines and
/// knows whether to call back, with the transcript underneath for when two lines
/// are not enough — the same relationship the player already has to the words.
///
/// Rows for present fields only, never a labelled blank. `VoicemailIntake.lines`
/// enforces that for all three clients, because a blank "Address" reads as "we
/// looked and the caller gave none", which is a claim we cannot make. The caller
/// renders nothing at all when the list is empty rather than an empty titled box.
///
/// The Lou mark plus "From the voicemail" is PORTAL-UX §3.1 — the card names the
/// signal that placed it. The mark says a machine did this, the label says where
/// it read it, and the transcript directly below is what makes both checkable
/// rather than a black box.
struct VoicemailIntakeSummary: View {
    let lines: [VoicemailIntakeLine]

    /// #228: after the required `let`, so the memberwise init `CallsView` builds
    /// this with keeps the same argument order. The ROWS arrive already in the
    /// reader's language (the caller resolves them); this is only for the
    /// provenance label above them.
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                AiOrb(state: .idle, size: 11)
                Text(AppStrings.translate(appLocale, voicemailIntakeSourceKey))
                    .font(.golos(10.5, weight: .semibold))
            }
            .foregroundStyle(BrandColor.muted500)
            .padding(.bottom, 3)
            ForEach(lines) { line in
                HStack(alignment: .top, spacing: 8) {
                    // Fixed label column so the values share one left edge: four
                    // ragged ones is four things to read instead of one.
                    Text(line.label)
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.muted500)
                        .frame(width: 66, alignment: .leading)
                    Text(line.value)
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        // One label for the block rather than eight nodes to swipe through:
        // VoiceOver should read "From the voicemail. Problem, water heater
        // leaking. Address, 12 Mill Road." as one thing, because that is what it
        // is — and the fixed label column that makes it scannable by eye is
        // meaningless to a screen reader.
        .accessibilityElement(children: .combine)
    }
}
