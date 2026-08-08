import Foundation

/// #288 — one tap, a pre-written message they can edit, sent from the phone they
/// are already holding.
///
/// The hand-port of `packages/shared/src/referral-share.ts`. `ReferralShareTests`
/// reads that file and asserts every sentence here still matches it, because a
/// draft that reads differently on the phone than on the laptop is a draft an
/// owner stops trusting to say what they meant.
///
/// ## What this is not
///
/// The product still distributes nothing. The draft goes to iOS's own share sheet
/// — the owner's Messages, WhatsApp or Mail, their own number, their choice of
/// recipient. Nothing leaves through the carrier and we never learn who saw it.
/// That boundary is why this is not the mass-texting D4 and D11 exclude.
///
/// ## Why the link is not inside the editable text
///
/// The first owner who rewrites this in their own words would delete it, send it,
/// and get nothing for a referral they actually made. ``shareText(note:link:code:)``
/// appends it, so there is no version of this that can go out without it.
enum ReferralShare {

    /// The default message, before the owner touches it.
    ///
    /// First person and plain: a contractor writing to another contractor, not us
    /// writing on their behalf. Every claim in it is one BRAND-MESSAGING already
    /// makes, and the reward is stated rather than implied.
    static let note =
        "We run our business line through Loonext — calls and texts land in one "
        + "inbox and whoever's free answers. Flat price, no per-seat fee. Sign up "
        + "with my link and we both get a free month."

    /// The heading over the share control, on all three clients.
    static let title = "Refer another crew"

    /// What the referrer gets, and when.
    ///
    /// SAYS WHAT THE PAYOUT ACTUALLY WAITS FOR. The reward needs D12 activation:
    /// the referee has to send AND be answered. Naming the wrong condition would
    /// be worse than being vague — the referrer would watch their friend send a
    /// text, expect a month, and conclude we did not pay.
    ///
    /// No figure here, deliberately. Web appends the amount because it is the only
    /// client with the price book and the workspace's currency loaded; a hardcoded
    /// number on the phone would be wrong for every Canadian workspace, on the one
    /// card asking somebody to vouch for us.
    ///
    /// UNPUNCTUATED, exactly as the shared module holds it: web continues the
    /// sentence with " — CA$109 each.", and the phones close it themselves.
    static let rewardLine =
        "Send this to another business. When they sign up and a customer texts them "
        + "back, you both get a month free"

    /// The one tap.
    static let action = "Share"

    /// The fallback, for somebody who wants the words somewhere else first.
    static let copy = "Copy"

    /// Confirmation after the copy.
    static let copied = "Copied"

    /// The label on the editable draft.
    static let draftLabel = "Your message"

    /// Said out loud, because an editable box next to a fixed link invites the
    /// question of whether the link is going too.
    static let linkNote = "Your link goes on the end automatically."

    /// The ask itself, once the moment has been earned.
    static let askBody =
        "Know another crew still running their business off one person's cell? "
        + "Send them your link — you both get a free month."

    /// The primary action on the ask.
    static let askAction = "Share your link"

    /// The way out.
    ///
    /// A plain button of equal weight, not a greyed-out afterthought. A prompt
    /// asking for a favour has no business making "no" hard to find.
    static let askDismiss = "Not now"

    /// The four states a referral passes through, in the words the referrer reads.
    ///
    /// A crew comparing a laptop and a phone over a van bonnet is comparing these
    /// exact strings. An unknown stage returns the raw value rather than trapping:
    /// a server ahead of this build must not blank a settings card.
    static func stageLabel(_ stage: String) -> String {
        switch stage {
        case "invited": return "Signed up, no replies yet"
        case "signed_up": return "Up and running"
        case "active": return "Still going after 30 days"
        case "rewarded": return "Free month applied"
        case "voided": return "Not counted"
        default: return stage
        }
    }

    /// The message as it will actually be sent: the owner's words, then the link.
    ///
    /// `link` is nil when the server has no site origin configured, in which case
    /// the code carries the referral on its own — read aloud at a supply counter is
    /// how a fair share of these will travel anyway. A blank line between the two so
    /// the URL is tappable in every messaging app rather than running into the last
    /// word.
    static func shareText(note: String, link: String?, code: String) -> String {
        let written = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let tail = link ?? "Use my code \(code) when you sign up."
        return written.isEmpty ? tail : "\(written)\n\n\(tail)"
    }

    /// The headline, in their numbers.
    ///
    /// The ask opens with what THEY did, not with what we want. An owner who reads
    /// "you replied to 37 customers this month" has been handed a fact about their
    /// own business before being asked for anything.
    static func askHeadline(_ customers: Int) -> String {
        customers == 1
            ? "You replied to 1 customer this month."
            : "You replied to \(customers) customers this month."
    }
}
