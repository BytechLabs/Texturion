import SwiftUI

/// #288/#399 — the referral link on the phone, which had none.
///
/// Inside Settings, next to billing, behind the same `billing.manage` capability
/// the endpoint enforces — the reward is a month off the invoice, so it belongs to
/// whoever the invoice belongs to. The MOMENT-based ask lives on the home screen
/// instead; this is the copy of it somebody comes looking for.
///
/// Applying: Zen of Clarity — the draft, one primary action, one fallback, and the
/// four states as a plain list rather than a table. Chunking — what the reward is,
/// how to send it, and what it has done, in that order.
///
/// PARITY. Same copy and same states as web's `referral-card.tsx` and Android's
/// `ReferralCard.kt`, asserted against the shared TypeScript by
/// `ReferralShareTests`.
struct ReferralCard: View {
    let view: ReferralsView

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        SettingsCard(title: ReferralShare.title) {
            VStack(alignment: .leading, spacing: 12) {
                // The reward line is `ReferralShare`'s, asserted against the
                // shared TypeScript; only the full stop is ours.
                Text(ReferralShare.rewardLine + ".")
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)

                ReferralShareBlock(link: view.link, code: view.code)

                if view.referrals.isEmpty {
                    // Said rather than hidden: a card that disappears when there
                    // is nothing to show is a card nobody learns exists.
                    Text(AppStrings.translate(appLocale, "settingsMore.noReferralsYet"))
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.muted600)
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(view.referrals) { row in
                            HStack {
                                Text(ReferralShare.stageLabel(row.stage))
                                    .font(.golos(13))
                                    .foregroundStyle(BrandColor.muted600)
                                Spacer(minLength: 12)
                                Text(String(row.created_at.prefix(10)))
                                    .font(.golos(11.5))
                                    .monospacedDigit()
                                    .foregroundStyle(BrandColor.muted600)
                            }
                        }
                    }
                }

                if view.rewarded_this_year > 0 {
                    // Two whole sentences rather than a spliced plural: French
                    // agrees the adjective as well as the noun, so a shared stem
                    // with a swapped word cannot be translated.
                    Text(
                        view.rewarded_this_year == 1
                            ? AppStrings.translate(
                                appLocale, "settingsMore.freeMonthEarned"
                            )
                            : AppStrings.translate(
                                appLocale,
                                "settingsMore.freeMonthsEarned",
                                ["count": String(view.rewarded_this_year)]
                            )
                    )
                    .font(.golos(13, weight: .medium))
                    .foregroundStyle(BrandColor.ink)
                }
            }
        }
    }
}
