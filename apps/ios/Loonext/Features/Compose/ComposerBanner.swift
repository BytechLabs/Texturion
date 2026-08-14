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
    /// #423: the carrier suspended a registration that WAS approved. Its own
    /// case for the same reason usTextingOff is: the registrationPending copy
    /// promises approval is coming, and for a suspended workspace that is
    /// false — they were approved, nothing is under review, and waiting
    /// achieves nothing.
    case registrationSuspended
    case usageCap
    /// #396: an inbound message on this thread READ as a plain-English
    /// opt-out. The only case here that does not describe a block — every
    /// other says why a message cannot go. This says a message SHOULD not, and
    /// leaves the decision with the person: an opt-out cannot be lifted by us
    /// (#331), so acting on a guess would silence a real lead for good.
    case optOutHint

    /// #363: this member may read the thread and write internal notes, but may
    /// not text the customer on this number (`number_access.level = 'note'`).
    ///
    /// The one send-blocking condition that had no banner. Every other blocked
    /// send says why on screen; this one just quietly had no text composer,
    /// which reads as the product being broken rather than as a permission —
    /// and the worse version is a tech who believes they replied and did not.
    case numberAccess
    /// #315: this person may READ the workspace and change nothing in it — the
    /// view-only observer (an owner's partner, an accountant, a consultant).
    ///
    /// Its own case rather than reusing `numberAccess`, because the two are
    /// different facts with different remedies: number access is about ONE
    /// number and an owner can widen it; this is about the role and only a role
    /// change fixes it. Telling an accountant to "ask for access to this
    /// number" would send them to the wrong conversation.
    case readOnly
}

func selectComposerBanner(
    contactOptedOut: Bool,
    contactOptOutSource: String?,
    subscriptionStatus: String,
    destinationCountry: String?,
    usApproved: Bool,
    usTextingOff: Bool,
    usage: Usage?,
    optOutHint: Bool = false,
    usSuspended: Bool = false,
    /// #106/#363: this caller's level on THIS conversation's number.
    viewerLevel: String = "text",
    /// #315: the viewer holds `conversations.read` and nothing else. Checked
    /// before the per-number level for the same reason that one is checked
    /// before everything else — it is the fact about the reader that is true in
    /// every conversation, on every number.
    viewerReadOnly: Bool = false
) -> ComposerBanner? {
    // #363 FIRST, and the reason is worth stating: every other banner
    // describes a fact about the CONVERSATION or the workspace, and this one
    // describes a fact about the READER. A note-only member told "your
    // subscription is past due" learns something true, irrelevant and
    // unfixable by them — they could not text on this number either way, and
    // they cannot pay the bill. "Ask an owner" is the only line they can act
    // on, and it stays true in every other conversation on this number.
    if viewerReadOnly { return .readOnly }
    if viewerLevel == "note" { return .numberAccess }
    if contactOptedOut {
        return .optedOut(carrierBlocked: isCarrierEnforcedOptOut(contactOptOutSource))
    }
    if subscriptionStatus != SubscriptionStatus.active {
        return .subscription(subscriptionStatus)
    }
    if destinationCountry == "US" && !usApproved {
        // Most-specific-to-this-reader first: a workspace that never turned US
        // texting on has no live registration to discuss; then the #423
        // suspension, which is a state they WERE out of; then the ordinary
        // pre-approval wait.
        if usTextingOff { return .usTextingOff }
        if usSuspended { return .registrationSuspended }
        return .registrationPending
    }
    if let usage, let cap = usage.cap_segments, usage.used_segments >= cap {
        return .usageCap
    }
    // #396 LAST, deliberately: every case above says a message CANNOT go, and
    // where nothing can be sent no obligation can be breached. This one matters
    // exactly when the composer is otherwise open — the moment somebody is
    // about to reply to a person who asked them not to.
    if optOutHint { return .optOutHint }
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

/// #423: the carrier suspended a registration that had been approved. Read off
/// the same campaign row `usSendApproved` reads, so the two can never disagree
/// about which state the workspace is in.
func usSuspended(_ company: CompanyView) -> Bool {
    company.registration.campaign?.status == "suspended"
}

/// The workspace does not do US texting at all, so `usSendApproved` is false
/// for a reason no amount of waiting fixes. Only Canadian companies can be in
/// this state: US texting is inherent to a US company.
func usTextingOff(_ company: CompanyView) -> Bool {
    company.country == "CA" && !company.us_texting_enabled
}

/// Honest, calm one-liner copy per banner (Loonext voice — no hype), as the
/// CATALOGUE KEYS that hold it.
///
/// #228: split from `bannerCopy` exactly the way Android's
/// `bannerCopyKeys`/`bannerCopy` pair is, so the selector above can be tested
/// against a key — a name that does not move when a sentence is reworded —
/// while the screen still gets words. Every key here is Android's, character for
/// character, because a crew that switches phones must not meet a different
/// explanation of why their texts are blocked.
func bannerCopyKeys(_ banner: ComposerBanner) -> (title: String, body: String) {
    switch banner {
    // Say what can actually be done about it, rather than covering both cases
    // at once and leaving the reader to guess which one they are in.
    case .optedOut(let carrierBlocked):
        return carrierBlocked
            ? ("thread.bannerOptedOutTitle", "thread.bannerOptedOutCarrierBody")
            : ("thread.bannerOptedOutTitle", "thread.bannerOptedOutManualBody")
    case .subscription:
        return ("thread.bannerSubscriptionTitle", "thread.bannerSubscriptionBody")
    case .registrationPending:
        return (
            "thread.bannerRegistrationPendingTitle",
            "thread.bannerRegistrationPendingBody"
        )
    case .usTextingOff:
        return ("thread.bannerUsTextingOffTitle", "thread.bannerUsTextingOffBody")
    // #423. Deliberately NOT the pending copy: promising approval to a
    // workspace that WAS approved is a wait that never ends, and it sends them
    // hunting for a form to fill in. Say what happened, who is acting on it,
    // and what still works — the same three things the email says, so the two
    // never contradict each other.
    case .registrationSuspended:
        return (
            "thread.bannerRegistrationSuspendedTitle",
            "thread.bannerRegistrationSuspendedBody"
        )
    case .usageCap:
        return ("thread.bannerUsageCapTitle", "thread.bannerUsageCapBody")
    // #315: names the ROLE, not the number — an accountant sent to "ask for
    // access to this number" would go looking in the wrong place.
    case .readOnly:
        return ("thread.bannerReadOnlyTitle", "thread.bannerReadOnlyBody")
    // #363: what is true, and what to do.
    case .numberAccess:
        return ("thread.bannerNumberAccessTitle", "thread.bannerNumberAccessBody")
    // #396: says what was seen and who decides. It does NOT opt anyone out —
    // only the customer can, and only they can lift it, so a wrong guess would
    // silence a real lead for good.
    case .optOutHint:
        return ("thread.bannerOptOutHintTitle", "thread.bannerOptOutHintBody")
    }
}

/// The same copy, resolved. `locale` is defaulted and last, so every existing
/// caller and the assertion table read English exactly as before.
func bannerCopy(
    _ banner: ComposerBanner,
    locale: String? = nil
) -> (title: String, body: String) {
    let keys = bannerCopyKeys(banner)
    return (
        title: AppStrings.translate(locale, keys.title),
        body: AppStrings.translate(locale, keys.body)
    )
}

/// Whether this banner should offer the call as a way forward.
///
/// Carrier registration gates TEXTING only, so a call to the same customer
/// connects today, on every plan. An opted-out contact is deliberately
/// excluded: a STOP revokes consent for the business to reach out, not only to
/// text, so the phone must never be offered as a way around it.
func offersCallInstead(_ banner: ComposerBanner) -> Bool {
    switch banner {
    // #423: registration gates TEXTING only, so the call still connects — and
    // during a suspension it is the only thing the reader can do now.
    case .registrationPending, .usTextingOff, .registrationSuspended: return true
    // #396: never offer the phone as a way around a request to be left alone —
    // the same reasoning that excludes an opted-out contact.
    // #363: whether a note-only member may CALL is a separate access question,
    // and pointing at a second thing they may also lack would be a second dead
    // end.
    // #315: a view-only observer cannot place a call either — calling and
    // texting are the same capability (conversations.send), so offering the
    // phone here would be the dead end this function exists to avoid.
    case .optedOut, .subscription, .usageCap, .optOutHint, .numberAccess,
         .readOnly:
        return false
    }
}

/// The card that stands in for the text composer (notes remain below it).
/// #253 — the stable key for a banner, so one failure reported from three
/// platforms lands in the support inbox under one name.
///
/// Mirrors the shared `ComposerBanner` kind strings exactly (web's
/// discriminant, `supportSituation`'s keys). A key invented here would make the
/// pattern that matters most — five reports of the same carrier suspension in
/// one morning — invisible.
func bannerKind(_ banner: ComposerBanner) -> String {
    switch banner {
    case .optedOut: "opted_out"
    case .subscription: "subscription"
    case .registrationPending: "registration_pending"
    case .registrationSuspended: "registration_suspended"
    case .usTextingOff: "us_texting_off"
    case .usageCap: "usage_cap"
    case .optOutHint: "opt_out_hint"
    case .numberAccess: "number_access"
    case .readOnly: "read_only"
    }
}

struct ComposerBannerCard: View {
    let banner: ComposerBanner
    /// Place a call to this customer. Nil withholds the offer entirely.
    var onCallInstead: (@MainActor () -> Void)?
    /// #253: tell us about THIS failure. Nil withholds the offer — used where
    /// no workspace context is loaded yet, because a report with no workspace
    /// in it costs a round trip before anyone can act on it.
    var onReport: (@MainActor () -> Void)?

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        let copy = bannerCopy(banner, locale: appLocale)
        VStack(alignment: .leading, spacing: 3) {
            Text(copy.title)
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Text(copy.body)
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted600)
            if let onCallInstead, offersCallInstead(banner) {
                Button(
                    AppStrings.translate(appLocale, "thread.callThemInstead"),
                    action: onCallInstead
                )
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                    .buttonStyle(.plain)
                    .padding(.top, 6)
            }
            // #253 — one tap from the banner that just said something failed,
            // to telling us. Every case gets it, including the ones the reader
            // can fix: deciding which failures deserve a voice is exactly the
            // asymmetry #253 is about. A report we did not need costs one read;
            // one we never got costs a customer we then record as churn.
            //
            // Deliberately quieter than "Call them instead" — where a remedy
            // exists, taking it is the right move and the layout must say so.
            if let onReport {
                Button(
                    AppStrings.translate(appLocale, "thread.reportThis"),
                    action: onReport
                )
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted500)
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
