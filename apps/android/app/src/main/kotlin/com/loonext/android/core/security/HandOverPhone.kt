package com.loonext.android.core.security

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale

/**
 * #330 — handing the phone to whoever is covering the rest of the shift.
 *
 * The hand-port of `packages/shared/src/hand-over-phone.ts`.
 *
 * D12's customer is a crew of one to ten texting customers from PERSONAL handsets,
 * and a spare phone lives in the truck. It gets handed to whoever is on this evening.
 * Until now the only way to do that honestly was Settings, then Profile, then scroll,
 * then "Sign out on this device" — so the fast path was to hand the phone over signed
 * in as somebody else, which attributes every reply to the wrong person and gives
 * them permissions that are not theirs.
 *
 * ## Why there is no stored account switcher
 *
 * The obvious feature is two signed-in accounts and a toggle. It is the wrong one
 * here: keeping the previous person's session on the device is exactly what this
 * issue exists to stop, and it would contradict what the privacy policy now promises
 * — everything goes when the session ends. So a handover is a full, clean exit, made
 * fast rather than made partial.
 *
 * ## The one thing it must not do quietly
 *
 * Ending the session clears the offline outbox, because a message half-written to a
 * homeowner must not sit on a phone the business does not own. That means a handover
 * DISCARDS anything still waiting for signal — and the person tapping it is the only
 * one who can be told, since a session the server revokes has nobody to ask.
 *
 * ## #228 — where the words went, and why there are two ways in
 *
 * The sentences moved to `ShellStrings`, unchanged to the character. Each is
 * reachable two ways, and the pair is not duplication:
 *
 *   [action] / [title] / [confirm] / [cancel] / [body] take a LOCALE, defaulted
 *   to English exactly as `AppLock.headline` next door does, so a caller inside
 *   composition passes `LocalAppLocale.current` and the person reads their own
 *   language.
 *
 *   [ACTION] / [TITLE] / [CONFIRM] / [CANCEL] are the English, and English is
 *   the point of them: `HandOverPhoneTest` holds these four against
 *   `packages/shared/src/hand-over-phone.ts` word for word, which is the guard
 *   that keeps three clients saying one thing. A locale-aware property cannot do
 *   that, and a test that asked for French would be asking the shared module a
 *   question it does not answer.
 */
object HandOverPhone {

    /** The action, named for what somebody is actually doing. */
    fun action(locale: String = MessageLocale.EN): String =
        AppStrings.translate(locale, "shell.handOverAction")

    /** The confirmation's heading. */
    fun title(locale: String = MessageLocale.EN): String =
        AppStrings.translate(locale, "shell.handOverTitle")

    /** Goes through with it. */
    fun confirm(locale: String = MessageLocale.EN): String =
        AppStrings.translate(locale, "shell.handOverConfirm")

    /** Backs out. */
    fun cancel(locale: String = MessageLocale.EN): String =
        AppStrings.translate(locale, "shell.handOverCancel")

    /** The English labels, held to the shared module by `HandOverPhoneTest`. */
    val ACTION: String get() = action()
    val TITLE: String get() = title()
    val CONFIRM: String get() = confirm()
    val CANCEL: String get() = cancel()

    /**
     * What happens, in the order it matters to the person holding the phone.
     *
     * [unsent] is how many messages are still waiting for signal. Naming the number
     * rather than saying "any unsent messages" is the difference between a warning
     * somebody reads past and one they act on.
     *
     * Two warning sentences rather than one with a count, in both languages: "1
     * messages" is the shape that tells a reader nobody proofread the thing they
     * are being asked to act on.
     */
    fun body(unsent: Int, locale: String = MessageLocale.EN): String {
        val first = AppStrings.translate(locale, "shell.handOverBody")
        if (unsent <= 0) return first
        val warning = if (unsent == 1) {
            AppStrings.translate(locale, "shell.handOverUnsentOne")
        } else {
            AppStrings.translate(
                locale,
                "shell.handOverUnsentMany",
                mapOf("count" to "$unsent"),
            )
        }
        return "$first\n\n$warning"
    }

    /**
     * Is there anything to lose by handing the phone over right now?
     *
     * Split out so the confirmation can be coloured as a warning rather than a
     * routine question, without re-deriving the rule from the copy.
     */
    fun costs(unsent: Int): Boolean = unsent > 0
}
