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

    /// #228 — how every sentence here reaches a reader.
    ///
    /// Nothing in `Core/` has an `@Environment(\.appLocale)` to read, so each
    /// sentence is a KEY and the un-suffixed name is a computed `static var`
    /// over it. That is load-bearing twice here: `ReferralShareTests` reads
    /// `packages/shared/src/referral-share.ts` and asserts every one of these
    /// still appears in it verbatim, and the share sheet that has not been
    /// handed a reader keeps drafting exactly what it drafted before.
    private static func say(_ key: String, _ locale: String? = nil) -> String {
        AppStrings.translate(locale, key)
    }

    /// The default message, before the owner touches it.
    ///
    /// First person and plain: a contractor writing to another contractor, not us
    /// writing on their behalf. Every claim in it is one BRAND-MESSAGING already
    /// makes, and the reward is stated rather than implied.
    static let noteKey = "domain.referralNote"
    static var note: String { say(noteKey) }

    /// The same draft, in the reader's language, for the sheet that has one.
    static func localisedNote(_ locale: String? = nil) -> String {
        say(noteKey, locale)
    }

    /// The heading over the share control, on all three clients.
    static let titleKey = "domain.referralTitle"
    static var title: String { say(titleKey) }

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
    static let rewardLineKey = "domain.referralRewardLine"
    static var rewardLine: String { say(rewardLineKey) }

    /// The one tap.
    static let actionKey = "domain.referralAction"
    static var action: String { say(actionKey) }

    /// The fallback, for somebody who wants the words somewhere else first.
    static let copyKey = "domain.referralCopy"
    static var copy: String { say(copyKey) }

    /// Confirmation after the copy.
    static let copiedKey = "domain.referralCopied"
    static var copied: String { say(copiedKey) }

    /// The label on the editable draft.
    static let draftLabelKey = "domain.referralDraftLabel"
    static var draftLabel: String { say(draftLabelKey) }

    /// Said out loud, because an editable box next to a fixed link invites the
    /// question of whether the link is going too.
    static let linkNoteKey = "domain.referralLinkNote"
    static var linkNote: String { say(linkNoteKey) }

    /// The ask itself, once the moment has been earned.
    static let askBodyKey = "domain.referralAskBody"
    static var askBody: String { say(askBodyKey) }

    /// The primary action on the ask.
    static let askActionKey = "domain.referralAskAction"
    static var askAction: String { say(askActionKey) }

    /// The way out.
    ///
    /// A plain button of equal weight, not a greyed-out afterthought. A prompt
    /// asking for a favour has no business making "no" hard to find.
    static let askDismissKey = "domain.referralAskDismiss"
    static var askDismiss: String { say(askDismissKey) }

    /// The four states a referral passes through, in the words the referrer reads.
    ///
    /// A crew comparing a laptop and a phone over a van bonnet is comparing these
    /// exact strings. An unknown stage returns the raw value rather than trapping:
    /// a server ahead of this build must not blank a settings card.
    static func stageLabel(_ stage: String, locale: String? = nil) -> String {
        switch stage {
        case "invited": return say("domain.referralStageInvited", locale)
        case "signed_up": return say("domain.referralStageSignedUp", locale)
        case "active": return say("domain.referralStageActive", locale)
        case "rewarded": return say("domain.referralStageRewarded", locale)
        case "voided": return say("domain.referralStageVoided", locale)
        // A stage this build has never heard of reads as itself, unchanged: a
        // server ahead of this app must not blank a settings card, and the raw
        // wire value is not ours to translate.
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
    static func shareText(
        note: String,
        link: String?,
        code: String,
        locale: String? = nil
    ) -> String {
        let written = note.trimmingCharacters(in: .whitespacesAndNewlines)
        // The CODE is never translated — it is what somebody types into a
        // sign-up form — but the sentence around it is.
        let tail = link
            ?? AppStrings.translate(
                locale, "domain.referralCodeFallback", ["code": code]
            )
        return written.isEmpty ? tail : "\(written)\n\n\(tail)"
    }

    /// The headline, in their numbers.
    ///
    /// The ask opens with what THEY did, not with what we want. An owner who reads
    /// "you replied to 37 customers this month" has been handed a fact about their
    /// own business before being asked for anything.
    static func askHeadline(_ customers: Int, locale: String? = nil) -> String {
        customers == 1
            ? say("domain.referralAskHeadlineOne", locale)
            : AppStrings.translate(
                locale,
                "domain.referralAskHeadlineMany",
                ["count": String(customers)]
            )
    }
}
