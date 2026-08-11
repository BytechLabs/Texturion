package com.loonext.android.features.inbox

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberFirsts
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.model.SubscriptionStatus

/**
 * #476 — the first-run checklist's derivations and copy, kept out of the
 * composable so they can be tested and so the strings sit in one place.
 *
 * # The copy is a hand-port, and it is checked
 *
 * Web owns the wording. The sentences themselves moved to
 * `core/i18n/InboxStrings.kt` under #228 — this file now names the KEYS — and
 * `packages/shared/src/first-run-copy.test.ts` reads all three clients'
 * catalogues and fails when one drifts. Three wordings of the same idea is the
 * failure #376 and #392 describe, and this card exists on three platforms.
 *
 * # Why the locale is a parameter rather than a default
 *
 * These are plain functions, so there is no composition to read the reader's
 * language from — the tab passes it down from `LocalAppLocale`. It is REQUIRED
 * on every one of them: a default would turn "nobody passed it" into an English
 * checklist on a French phone instead of a compile error, which is the same
 * failure #503 records for a defaulted navigation callback.
 *
 * # Why derivations rather than a "seen it" flag
 *
 * Every item answers a question about real data, so the list empties itself as
 * the person actually does the things. Nothing is stored except the dismissal.
 */

/** One row of the checklist. */
data class StartedStep(
    val key: String,
    val done: Boolean,
    val label: String,
    val hint: String? = null,
)

/**
 * Whether the workspace has paid, hand-ported from web's `hasPaid`.
 *
 * NOT `CompanyView.subscriptionActive`, which is only `active`. That is
 * strictly narrower than web and would hide the card from a past_due
 * workspace that web shows it to — the card would vanish at the exact moment
 * somebody is most likely to be confused about the state of their account.
 */
fun hasPaidStatus(status: String?): Boolean =
    status == SubscriptionStatus.ACTIVE ||
        status == SubscriptionStatus.PAST_DUE ||
        status == SubscriptionStatus.UNPAID

/**
 * The setup list, for whoever can actually do the setup.
 *
 * `signup` is credited done on purpose: this list only renders after payment,
 * so the reader picked a plan and paid before ever seeing it. A setup list
 * that starts at zero for somebody who has already done something reads as
 * "none of that counted".
 * *Applying: the Goal Gradient Effect.*
 */
fun ownerSteps(
    numbers: List<PhoneNumberSummary>,
    hasConversation: Boolean,
    usedSegments: Long,
    activeMemberCount: Int,
    locale: String,
): List<StartedStep> {
    fun say(key: String) = AppStrings.translate(locale, key)
    val numberDone = numbers.any { it.status == NumberStatus.ACTIVE }
    val numberStalled = !numberDone && numbers.any { it.status == NumberStatus.PROVISION_FAILED }
    return listOf(
        StartedStep("signup", done = true, label = say("inbox.startedOwnerSignupLabel")),
        StartedStep(
            key = "number",
            done = numberDone,
            label = say("inbox.startedOwnerNumberLabel"),
            hint = when {
                numberDone -> null
                // Don't promise "under a minute" once a purchase has actually
                // stalled: the honest delayed line matches the app-wide banner.
                numberStalled -> say("inbox.startedOwnerNumberStalledHint")
                else -> say("inbox.startedOwnerNumberHint")
            },
        ),
        StartedStep(
            key = "inbound",
            done = hasConversation,
            label = say("inbox.startedOwnerInboundLabel"),
            hint = if (hasConversation) null else say("inbox.startedOwnerInboundHint"),
        ),
        StartedStep(
            key = "reply",
            done = usedSegments > 0,
            label = say("inbox.startedOwnerReplyLabel"),
            hint = if (usedSegments > 0) null else say("inbox.startedOwnerReplyHint"),
        ),
        StartedStep(
            key = "teammate",
            done = activeMemberCount > 1,
            label = say("inbox.startedOwnerTeammateLabel"),
        ),
    )
}

/**
 * What changes about a crew member's day, derived from what they have done.
 *
 * NOTHING ABOUT SETUP. The workspace already works, they were invited into a
 * running one. The one genuinely dangerous thing to get wrong is the note: a
 * note is not a text, and learning that by accident means a customer received
 * something meant for a colleague.
 * *Applying: Chunking — three things, which is what a person holds.*
 */
fun memberSteps(firsts: MemberFirsts, locale: String): List<StartedStep> {
    fun say(key: String) = AppStrings.translate(locale, key)
    return listOf(
        StartedStep(
            key = "reply",
            done = firsts.replied,
            label = say("inbox.startedMemberReplyLabel"),
            hint = if (firsts.replied) null else say("inbox.startedMemberReplyHint"),
        ),
        StartedStep(
            key = "note",
            done = firsts.noted,
            label = say("inbox.startedMemberNoteLabel"),
            hint = if (firsts.noted) null else say("inbox.startedMemberNoteHint"),
        ),
        StartedStep(
            key = "done",
            done = firsts.marked_done,
            label = say("inbox.startedMemberDoneLabel"),
            hint = if (firsts.marked_done) null else say("inbox.startedMemberDoneHint"),
        ),
    )
}

/** A finished list has nothing left to say, so it stops saying it. */
fun stepsComplete(steps: List<StartedStep>): Boolean = steps.all { it.done }

/** Which of the two cards this person should see, or neither. */
enum class StartedAudience { SETUP, DOING_THE_JOB, NONE }

/**
 * #315: capability sets, not ranks.
 *
 * Web branches on `role === "owner" || role === "admin"` and everybody else
 * falls through to the member card. That leaves `read_only` reading a
 * checklist whose three items — reply, note, mark done — are all things the
 * role provably cannot do, because it holds only `workspace.access` and
 * `conversations.read`. So the member card asks for the axis its items
 * actually need, and a read-only observer sees no card rather than a list of
 * instructions they cannot follow.
 */
fun startedAudience(role: String?): StartedAudience = when {
    MemberRole.has(role, Capability.SETTINGS_MANAGE) -> StartedAudience.SETUP
    MemberRole.has(role, Capability.CONVERSATIONS_SEND) -> StartedAudience.DOING_THE_JOB
    else -> StartedAudience.NONE
}

/** Active members, the API's own filter (`deactivated_at IS NULL`). */
fun countActiveMembers(members: List<Member>): Int =
    members.count { it.deactivated_at == null }
