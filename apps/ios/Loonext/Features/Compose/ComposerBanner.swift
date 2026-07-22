import SwiftUI

/// Banner states that REPLACE the text composer — a pure precedence selector
/// (port of apps/web thread/composer-banner.ts via the Android twin) so the
/// rule is unit-testable. Order, most permanent first:
///
///   1. optedOut            — per-contact, never unblocked by paying
///   2. subscription        — past_due / canceled blocks every send
///   3. registrationPending — US destination before campaign approval
///   4. usageCap            — recoverable by the owner
///
/// nil = composer enabled. The API enforces each gate independently; this
/// selector only decides what the user sees. Notes stay available under every
/// banner.
enum ComposerBanner: Equatable, Sendable {
    case optedOut
    case subscription(String)
    case registrationPending
    case usageCap
}

func selectComposerBanner(
    contactOptedOut: Bool,
    subscriptionStatus: String,
    destinationCountry: String?,
    usApproved: Bool,
    usage: Usage?
) -> ComposerBanner? {
    if contactOptedOut { return .optedOut }
    if subscriptionStatus != SubscriptionStatus.active {
        return .subscription(subscriptionStatus)
    }
    if destinationCountry == "US" && !usApproved { return .registrationPending }
    if let usage, let cap = usage.cap_segments, usage.used_segments >= cap {
        return .usageCap
    }
    return nil
}

/// The US-send gate exactly as the API computes it: campaign approved, not
/// deactivated, and the company does US texting at all.
func usSendApproved(_ company: CompanyView) -> Bool {
    guard let campaign = company.registration.campaign else { return false }
    return (company.country == "US" || company.us_texting_enabled) &&
        campaign.status == "approved" &&
        campaign.deactivated_at == nil
}

/// Honest, calm one-liner copy per banner (Loonext voice — no hype).
func bannerCopy(_ banner: ComposerBanner) -> (title: String, body: String) {
    switch banner {
    case .optedOut:
        return (
            "This customer opted out",
            "They texted STOP or were opted out manually. You can't text them unless they opt back in. Internal notes still work."
        )
    case .subscription:
        return (
            "Texting is paused",
            "Your subscription isn't active, so outbound texts are blocked. An owner can fix this in billing. Internal notes still work."
        )
    case .registrationPending:
        return (
            "US texting isn't approved yet",
            "Carriers are still reviewing your registration. Texts to US numbers will send once it's approved. Internal notes still work."
        )
    case .usageCap:
        return (
            "You've hit this month's cap",
            "Outbound texts pause until the cap is raised or the month rolls over. Internal notes still work."
        )
    }
}

/// The card that stands in for the text composer (notes remain below it).
struct ComposerBannerCard: View {
    let banner: ComposerBanner

    var body: some View {
        let copy = bannerCopy(banner)
        VStack(alignment: .leading, spacing: 3) {
            Text(copy.title)
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Text(copy.body)
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted600)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            BrandColor.cream,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}
