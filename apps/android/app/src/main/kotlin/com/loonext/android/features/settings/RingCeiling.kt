package com.loonext.android.features.settings

import androidx.compose.runtime.Composable
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.PhoneNumberSummary

/**
 * #366 — what to say when the crew outgrows a single call's fan-out.
 *
 * A call rings a bounded number of phones. A crew larger than that used to
 * have the same members left out of every call, and nothing in the product
 * said so — the warning went to Sentry, not to the owner and not to the
 * people who were not ringing.
 *
 * Null — say nothing — is the answer for almost every workspace, and that
 * matters: a line about a limit nobody is near is noise that trains people to
 * skip the card it sits on. The ceiling arrives from the server rather than
 * being hard-coded here, so a client can never disagree with the engine.
 *
 * Same words as web and iOS, deliberately.
 */
@Composable
fun ringCeilingLine(number: PhoneNumberSummary): String? {
    val targets = number.ring_targets ?: return null
    val limit = number.ring_target_limit ?: return null
    if (targets <= limit) return null
    return t(
        "settingsMore.ringCeilingLine",
        "targets" to "$targets",
        "limit" to "$limit",
    )
}
