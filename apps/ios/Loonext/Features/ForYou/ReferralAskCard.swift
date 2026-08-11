import SwiftUI

/// #288 — the ask, at the moment it has been earned.
///
/// ## What was wrong with where the ask lived
///
/// Nowhere, on this client. And on web it sat in Settings > Billing with no moment
/// attached, which in practice means an owner met it once — poking around billing
/// on the day they signed up — and never again. #288 names both halves as the
/// mistake: "obvious placement at a moment of demonstrated satisfaction rather than
/// buried in settings", and "asking at signup is asking someone to vouch for
/// something they have not used, which costs credibility and converts badly".
///
/// ## What makes this a moment
///
/// The server will not say yes until the product has demonstrably worked: D12
/// activation, a month of it working, and twenty customers replied to in the last
/// thirty days. `referralAskDecision` in packages/shared holds those rules, so this
/// card and the two other clients cannot disagree about when an owner is asked for
/// a favour — and none of them re-derives it.
///
/// Applying: Meaningful Highlights & Context, and Reciprocity — the headline is
/// "You replied to 37 customers this month", a fact about their business handed
/// over before anything is requested. That ordering is the difference between a
/// prompt that reads as earned and one that reads as a pop-up, and #288's own
/// devil's advocate is about exactly that failure.
///
/// Applying: Ethical Friction, inverted — "Not now" is a plain button of the same
/// weight as the ask, not an X in a corner. A card asking for a favour has no
/// business making no hard to find, and the server holds that answer for a quarter.
struct ReferralAskCard: View {
    let moment: ReferralMoment?
    let referrals: ReferralsView?
    let opened: Bool
    /// A `let` with no default, like every other callback here: a default is what
    /// lets an inert card ship (#503).
    let onOpen: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        // Never a skeleton and never an error row. This is a favour being asked on
        // somebody's working screen; if we cannot tell whether it is the right
        // moment, silence is the answer.
        Group {
            if let moment, moment.ask {
                PaperCard {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(ReferralShare.askHeadline(moment.customers))
                            .font(.golos(15, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)

                        Text(ReferralShare.askBody)
                            .font(.golos(13))
                            .foregroundStyle(BrandColor.muted600)
                            .padding(.top, 4)

                        if opened {
                            if let referrals {
                                ReferralShareBlock(link: referrals.link, code: referrals.code)
                                    .padding(.top, 12)
                            } else {
                                // The one place a wait is worth showing: they
                                // pressed a button and are owed an answer about it.
                                Text("Getting your link…")
                                    .font(.golos(13))
                                    .foregroundStyle(BrandColor.muted600)
                                    .padding(.top, 12)
                            }
                        } else {
                            HStack(spacing: 8) {
                                Button(ReferralShare.askAction, action: onOpen)
                                    .font(.golos(13, weight: .medium))
                                    .buttonStyle(.borderedProminent)
                                Button(ReferralShare.askDismiss, action: onDismiss)
                                    .font(.golos(13, weight: .medium))
                                    .buttonStyle(.bordered)
                            }
                            .padding(.top, 12)
                        }
                    }
                    .padding(14)
                }
            }
        }
    }
}
