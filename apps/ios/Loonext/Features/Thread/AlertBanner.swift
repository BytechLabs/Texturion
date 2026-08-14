import SwiftUI

/// #244 — the strip on a thread nobody has picked up.
///
/// Design notes, and the principles behind them:
///
/// - **The point is the NAME.** "When everyone is notified, no one is
///   accountable." This turns "somebody should call these people" into "I have
///   this", visible to everybody else who opens the thread.
///   *Applying: Prioritize Intent — the core action first, and there is one.*
/// - **It shows on every route into the thread**, not just the notification's
///   deep link: the person best placed to claim it is often not the one who was
///   paged, because that person is asleep.
/// - **It disappears the moment it is claimed.** A banner that lingers after
///   somebody took it teaches the crew to ignore banners.
/// - **No confirmation.** Taking responsibility for a callback is reversible by
///   telling the crew. *Applying: Ethical Friction, on the irreversible edge
///   only, and this edge is the opposite of that.*
///
/// Mirrors the web and Android banners; `OnCallCopyTests` keeps the words
/// identical.
struct AlertBanner: View {
    let alert: OpenAlert?
    let viewerId: String?
    let onClaim: (String) -> Void

    /// #228: after the required `let`s, so the memberwise init this is built
    /// with in `ThreadView` keeps the same argument order.
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        // Absent on nearly every thread. Reserving space for it would be a
        // permanent cost paid for a rare event.
        if let alert {
            HStack(spacing: 8) {
                Image(systemName: "bell.badge")
                    .font(.scaled(13, weight: .medium))
                    .foregroundStyle(BrandColor.olive)
                Text(waitingLine(alert))
                    .font(.golos(13))
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button(AppStrings.translate(appLocale, OnCall.bannerClaimKey)) {
                    onClaim(alert.id)
                }
                    .font(.golos(13, weight: .semibold))
                    .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(BrandColor.avatarTint)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }

    private func waitingLine(_ alert: OpenAlert) -> String {
        let waiting = AppStrings.translate(appLocale, OnCall.bannerWaitingKey)
        guard let paged = alert.on_call_name,
              alert.on_call_user_id != viewerId
        else { return waiting }
        // #228: " was told first" is still English on BOTH phones — it has no
        // key in either catalogue, so this is an extraction gap rather than a
        // dropped argument. Translating it here alone would put a French
        // sentence on iOS and an English one on Android for the same alert.
        return "\(waiting) · \(paged) was told first"
    }
}
