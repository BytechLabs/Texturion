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
    /// The associated flag tells the two opt-outs apart, because only one of
    /// them has anything the reader can do about it: a STOP the customer sent
    /// is a carrier block only they can lift, while an opt-out someone recorded
    /// by hand comes off in a tap on the contact.
    case optedOut(carrierBlocked: Bool)
    case subscription(String)
    case registrationPending
    /// A US destination in a workspace that does not do US texting at all: a
    /// Canadian company that never added it. Split out of registrationPending
    /// because no registration exists to approve, so the wait copy promised an
    /// outcome that could not arrive however long the reader waited.
    case usTextingOff
    case usageCap
}

func selectComposerBanner(
    contactOptedOut: Bool,
    contactOptOutSource: String?,
    subscriptionStatus: String,
    destinationCountry: String?,
    usApproved: Bool,
    usTextingOff: Bool,
    usage: Usage?
) -> ComposerBanner? {
    if contactOptedOut {
        return .optedOut(carrierBlocked: contactOptOutSource == optOutSourceStop)
    }
    if subscriptionStatus != SubscriptionStatus.active {
        return .subscription(subscriptionStatus)
    }
    if destinationCountry == "US" && !usApproved {
        return usTextingOff ? .usTextingOff : .registrationPending
    }
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

/// The workspace does not do US texting at all, so `usSendApproved` is false
/// for a reason no amount of waiting fixes. Only Canadian companies can be in
/// this state: US texting is inherent to a US company.
func usTextingOff(_ company: CompanyView) -> Bool {
    company.country == "CA" && !company.us_texting_enabled
}

/// Honest, calm one-liner copy per banner (Loonext voice — no hype).
func bannerCopy(_ banner: ComposerBanner) -> (title: String, body: String) {
    switch banner {
    // Say what can actually be done about it, rather than covering both cases
    // at once and leaving the reader to guess which one they are in.
    case .optedOut(let carrierBlocked):
        return carrierBlocked
            ? (
                "This customer opted out",
                "They texted STOP, so their carrier is blocking your texts. Only they can undo it, by texting START to your number. Internal notes still work."
            )
            : (
                "This customer opted out",
                "Someone marked them opted out. You can undo that on their contact. Internal notes still work."
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
    case .usTextingOff:
        return (
            "US texting isn't on for this workspace",
            "This is a US number, and texting US numbers is an add-on your workspace hasn't turned on. An owner can add it in settings. Calls to this customer still work, and internal notes still work."
        )
    case .usageCap:
        return (
            "You've hit this month's cap",
            "Outbound texts pause until the cap is raised or the month rolls over. Internal notes still work."
        )
    }
}

/// Whether this banner should offer the call as a way forward.
///
/// Carrier registration gates TEXTING only, so a call to the same customer
/// connects today, on every plan. An opted-out contact is deliberately
/// excluded: a STOP revokes consent for the business to reach out, not only to
/// text, so the phone must never be offered as a way around it.
func offersCallInstead(_ banner: ComposerBanner) -> Bool {
    switch banner {
    case .registrationPending, .usTextingOff: return true
    case .optedOut, .subscription, .usageCap: return false
    }
}

/// The card that stands in for the text composer (notes remain below it).
struct ComposerBannerCard: View {
    let banner: ComposerBanner
    /// Place a call to this customer. Nil withholds the offer entirely.
    var onCallInstead: (@MainActor () -> Void)?

    var body: some View {
        let copy = bannerCopy(banner)
        VStack(alignment: .leading, spacing: 3) {
            Text(copy.title)
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Text(copy.body)
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted600)
            if let onCallInstead, offersCallInstead(banner) {
                Button("Call them instead", action: onCallInstead)
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                    .buttonStyle(.plain)
                    .padding(.top, 6)
            }
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
