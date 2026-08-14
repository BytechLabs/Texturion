package com.loonext.android.core.oncall

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.snooze.parseInstantMillis

/**
 * #538 (audit) — turning your own notifications off while you are the one on call.
 *
 * The hand-port of `packages/shared/src/on-call-notifications.ts`.
 *
 * ## What the audit found
 *
 * The issue asked for other places that would benefit from a confirmation. Almost
 * everywhere already had one: leaving a workspace names the consequence, turning
 * your own two-factor off names it, releasing a number names it. The notifications
 * screen did not, and it is the one where silence is the whole failure.
 *
 * A crew nominates somebody on call. Unclaimed leads page that person. If they
 * switch push off — perfectly reasonable on an ordinary evening — the pages still
 * fire and reach nothing. Nobody else is told, because as far as the system is
 * concerned the alert was delivered. The customer texted, nobody answered, and the
 * first anyone hears about it is the customer going somewhere else.
 *
 * ## Why this warns and does not refuse
 *
 * Somebody who wants their phone quiet is entitled to a quiet phone, and a product
 * that refuses would be a product people work around by turning the phone off —
 * which is worse, because then we cannot tell.
 */
object OnCallSilence {

    /**
     * The confirm button, which says what happens rather than "OK".
     *
     * #228: the KEY is the constant, because `t()` is `@Composable` and this
     * object is not. The old name stays as a property over it, so a call site
     * that has not been given the reader's language keeps its English.
     */
    const val CONFIRM_KEY = "domain.onCallSilenceConfirm"
    val CONFIRM: String get() = AppStrings.translate(null, CONFIRM_KEY)

    /** ...and the way out. */
    const val CANCEL_KEY = "domain.onCallSilenceCancel"
    val CANCEL: String get() = AppStrings.translate(null, CANCEL_KEY)

    /** One shift, reduced to what this decision needs. */
    data class Shift(val userId: String, val startsAt: String, val endsAt: String)

    /**
     * Is this member on call at this instant, for any number?
     *
     * The end is EXCLUSIVE, so two people handing over at six o'clock do not both
     * count for that minute — otherwise the handover warns the wrong person.
     */
    fun isOnCallNow(shifts: List<Shift>, userId: String, nowMillis: Long): Boolean =
        shifts.any { shift ->
            if (shift.userId != userId) return@any false
            val from = parseInstantMillis(shift.startsAt)
            val until = parseInstantMillis(shift.endsAt)
            // An unreadable stamp is treated as NOT covering the moment. Assuming it
            // does would warn somebody who is not on call, and a warning that fires
            // wrongly is one people learn to dismiss.
            if (from == null || until == null) return@any false
            nowMillis >= from && nowMillis < until
        }

    /**
     * What to say before somebody on call goes quiet.
     *
     * Null when there is nothing to warn about — not on call, or switching something
     * ON — so a caller can ask unconditionally. Turning notifications back on is the
     * good outcome, and a dialog there would be punishing the fix.
     */
    fun warning(
        onCall: Boolean,
        turningOff: Boolean,
        channel: String,
        // #228: last and defaulted, so the parity test against the shared
        // TypeScript keeps comparing English to English.
        locale: String? = null,
    ): String? {
        if (!onCall || !turningOff) return null
        val what = AppStrings.translate(
            locale,
            if (channel == "push") {
                "domain.onCallSilenceChannelPush"
            } else {
                "domain.onCallSilenceChannelEmail"
            },
        )
        return AppStrings.translate(
            locale,
            "domain.onCallSilenceWarning",
            mapOf("what" to what),
        )
    }
}
