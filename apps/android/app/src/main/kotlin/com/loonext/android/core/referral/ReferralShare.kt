package com.loonext.android.core.referral

import com.loonext.android.core.i18n.AppStrings

/**
 * #288 — one tap, a pre-written message they can edit, sent from the phone they
 * are already holding.
 *
 * The hand-port of `packages/shared/src/referral-share.ts`. `ReferralShareTest`
 * reads that file and asserts every sentence here still matches it, because a
 * draft that reads differently on the phone than on the laptop is a draft an
 * owner stops trusting to say what they meant.
 *
 * ## What this is not
 *
 * The product still distributes nothing. The draft goes to Android's own share
 * sheet — the owner's Messages, WhatsApp or email, their own number, their choice
 * of recipient. Nothing leaves through the carrier and we never learn who saw it.
 * That boundary is why this is not the mass-texting D4 and D11 exclude.
 *
 * ## Why the link is not inside the editable text
 *
 * The first owner who rewrites this in their own words would delete it, send it,
 * and get nothing for a referral they actually made. [shareText] appends it, so
 * there is no version of this that can go out without it.
 *
 * ## #228, and why the English is still pinned
 *
 * Every sentence here is a catalogue key now, and every function takes the
 * reader's language LAST and DEFAULTED. `ReferralShareTest` still reads
 * `packages/shared/src/referral-share.ts` and asserts the ENGLISH matches it
 * character for character, which is exactly what the default preserves: the
 * parity that stops a draft reading differently on the phone than on the laptop
 * is a parity about the source sentence, not about which language it is read in.
 */
object ReferralShare {

    /**
     * The default message, before the owner touches it.
     *
     * First person and plain: a contractor writing to another contractor, not us
     * writing on their behalf. Every claim in it is one BRAND-MESSAGING already
     * makes, and the reward is stated rather than implied.
     */
    const val NOTE_KEY: String = "domain.referralNote"
    val NOTE: String get() = AppStrings.translate(null, NOTE_KEY)

    /** The heading over the share control, on all three clients. */
    const val TITLE_KEY: String = "domain.referralTitle"
    val TITLE: String get() = AppStrings.translate(null, TITLE_KEY)

    /**
     * What the referrer gets, and when.
     *
     * SAYS WHAT THE PAYOUT ACTUALLY WAITS FOR. The reward needs D12 activation:
     * the referee has to send AND be answered. Naming the wrong condition would be
     * worse than being vague — the referrer would watch their friend send a text,
     * expect a month, and conclude we did not pay.
     *
     * No figure here, deliberately. Web appends the amount because it is the only
     * client with the price book and the workspace's currency loaded; a hardcoded
     * number on the phone would be wrong for every Canadian workspace, on the one
     * card asking somebody to vouch for us.
     *
     * UNPUNCTUATED, exactly as the shared module holds it: web continues the
     * sentence with " — CA$109 each.", and the phones close it themselves. That is
     * what lets the parity test compare the two strings literally instead of
     * reasoning about a trailing full stop.
     */
    const val REWARD_LINE_KEY: String = "domain.referralRewardLine"
    val REWARD_LINE: String get() = AppStrings.translate(null, REWARD_LINE_KEY)

    /**
     * The four states a referral passes through, in the words the referrer reads.
     *
     * A crew comparing a laptop and a phone over a van bonnet is comparing these
     * exact strings. An unknown stage returns the raw value rather than throwing:
     * a server ahead of this build must not crash a settings screen.
     */
    fun stageLabel(stage: String, locale: String? = null): String = when (stage) {
        "invited" -> AppStrings.translate(locale, "domain.referralStageInvited")
        "signed_up" -> AppStrings.translate(locale, "domain.referralStageSignedUp")
        "active" -> AppStrings.translate(locale, "domain.referralStageActive")
        "rewarded" -> AppStrings.translate(locale, "domain.referralStageRewarded")
        "voided" -> AppStrings.translate(locale, "domain.referralStageVoided")
        else -> stage
    }

    /** The one tap. */
    const val ACTION_KEY: String = "domain.referralAction"
    val ACTION: String get() = AppStrings.translate(null, ACTION_KEY)

    /** The fallback, for somebody who wants the words somewhere else first. */
    const val COPY_KEY: String = "domain.referralCopy"
    val COPY: String get() = AppStrings.translate(null, COPY_KEY)

    /** Confirmation after the copy. */
    const val COPIED_KEY: String = "domain.referralCopied"
    val COPIED: String get() = AppStrings.translate(null, COPIED_KEY)

    /** The label on the editable draft. */
    const val DRAFT_LABEL_KEY: String = "domain.referralDraftLabel"
    val DRAFT_LABEL: String get() = AppStrings.translate(null, DRAFT_LABEL_KEY)

    /** Said out loud, because an editable box next to a fixed link invites the question. */
    const val LINK_NOTE_KEY: String = "domain.referralLinkNote"
    val LINK_NOTE: String get() = AppStrings.translate(null, LINK_NOTE_KEY)

    /** The ask itself, once the moment has been earned. */
    const val ASK_BODY_KEY: String = "domain.referralAskBody"
    val ASK_BODY: String get() = AppStrings.translate(null, ASK_BODY_KEY)

    /** The primary action on the ask. */
    const val ASK_ACTION_KEY: String = "domain.referralAskAction"
    val ASK_ACTION: String get() = AppStrings.translate(null, ASK_ACTION_KEY)

    /**
     * The way out.
     *
     * A plain button of equal weight, not a greyed-out afterthought. A prompt
     * asking for a favour has no business making "no" hard to find.
     */
    const val ASK_DISMISS_KEY: String = "domain.referralAskDismiss"
    val ASK_DISMISS: String get() = AppStrings.translate(null, ASK_DISMISS_KEY)

    /**
     * The message as it will actually be sent: the owner's words, then the link.
     *
     * [link] is null when the server has no site origin configured, in which case
     * the code carries the referral on its own — read aloud at a supply counter is
     * how a fair share of these will travel anyway. A blank line between the two so
     * the URL is tappable in every messaging app rather than running into the last
     * word.
     */
    fun shareText(note: String, link: String?, code: String, locale: String? = null): String {
        val written = note.trim()
        val tail = link ?: AppStrings.translate(
            locale,
            "domain.referralCodeFallback",
            mapOf("code" to code),
        )
        return if (written.isEmpty()) tail else "$written\n\n$tail"
    }

    /**
     * The headline, in their numbers.
     *
     * The ask opens with what THEY did, not with what we want. An owner who reads
     * "you replied to 37 customers this month" has been handed a fact about their
     * own business before being asked for anything.
     */
    fun askHeadline(customers: Int, locale: String? = null): String =
        if (customers == 1) {
            AppStrings.translate(locale, "domain.referralAskHeadlineOne")
        } else {
            AppStrings.translate(
                locale,
                "domain.referralAskHeadlineMany",
                mapOf("count" to customers.toString()),
            )
        }
}
