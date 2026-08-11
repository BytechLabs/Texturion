import SwiftUI

/// #250 — "this looks like a robotext", said out loud rather than acted on.
///
/// # Why a banner and not a filter
///
/// Every genuine new customer is an unknown sender with no prior outbound,
/// because that is what a new lead IS. So a classifier that hides threads eats
/// exactly the messages that make our customers money, and a misfiled customer
/// is a lost job. The suspicion changes one thing only — we do not wake
/// somebody's phone — and this banner is the whole of its visible effect.
///
/// # It says WHY, in the server's words
///
/// A verdict somebody cannot check is one they learn to dismiss, so the reasons
/// travel with the flag and are rendered verbatim. The scoring threshold
/// guarantees at least two: one signal is never enough to suspect.
@MainActor
struct SpamSuspectedBanner: View {
    let reasons: [String]
    /// Clearing it needs a PATCH, which `read_only` cannot make. An observer
    /// still reads the reasons — hiding the explanation from somebody who can
    /// see the thread would leave them with an unexplained quiet thread.
    let canAct: Bool
    let onNotSpam: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.shield")
                    .font(.scaled(12, weight: .medium))
                    .foregroundStyle(BrandColor.muted500)
                Text("This looks like spam")
                    .font(.golos(12.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Spacer(minLength: 8)
                if canAct {
                    Button("Not spam", action: onNotSpam)
                        .buttonStyle(.plain)
                        .font(.golos(12.5, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                }
            }
            Text(
                "We didn't send a notification for it. Nothing is hidden, and "
                    + "you can reply as normal."
            )
            .font(.golos(11.5))
            .foregroundStyle(BrandColor.muted500)
            .fixedSize(horizontal: false, vertical: true)
            ForEach(reasons, id: \.self) { why in
                Text(why)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(BrandColor.inset, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, 18)
        .padding(.vertical, 5)
    }
}

#Preview("Spam suspected") {
    SpamSuspectedBanner(
        reasons: [
            "The sender is a shortcode or a name, not a phone somebody could call back.",
            "It carries the unsubscribe footer a bulk sender is required to add.",
        ],
        canAct: true,
        onNotSpam: {}
    )
    .background(BrandColor.canvas)
}
