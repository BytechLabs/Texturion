package com.loonext.android.features.compose

import java.time.Instant
import java.time.format.DateTimeParseException

/**
 * #408 — two techs answering the same customer, thirty seconds apart.
 *
 * A customer texts "Can you come Tuesday?". Two techs get the notification,
 * both open the thread, both type, and the customer receives "Yes, 9am works"
 * followed by "Sorry, we're booked Tuesday". From the same business.
 *
 * The product creates that race on purpose and that is still right: an
 * unassigned inbound notifies EVERY active member, which is correct for "never
 * miss a lead". The window between "everyone is told" and "somebody claims it"
 * is the window both replies get written in.
 *
 * SO THIS WARNS, IT DOES NOT BLOCK. A duplicate reply is genuinely better than
 * no reply, and anything discouraging a tech from answering works against the
 * five-minute window that decides the job.
 *
 * Hand-port of packages/shared/src/duplicate-reply.ts — the same assertion
 * table runs in all three languages, because a warning that exists only on web
 * protects nobody in a truck.
 */
data class DuplicateReplyWarning(val warn: Boolean, val byUserId: String?)

private val NO_WARNING = DuplicateReplyWarning(warn = false, byUserId = null)

/**
 * Should we ask before this send? Yes when somebody OTHER than the sender put
 * an outbound into this thread at or after the moment the draft began.
 *
 * A null [draftStartedAt] never warns: a draft restored after a process death
 * has no start moment we can honestly claim, and a confirmation we cannot
 * justify is worse than none — the first false one teaches people to dismiss
 * the true ones.
 */
fun duplicateReplyWarning(
    draftStartedAt: String?,
    lastOutboundAt: String?,
    lastOutboundByUserId: String?,
    meUserId: String,
): DuplicateReplyWarning {
    if (draftStartedAt == null || lastOutboundAt == null) return NO_WARNING
    // Your own send is not a collision. Sending twice in a row is deliberate
    // and ordinary — a correction, an address, a second thought.
    if (lastOutboundByUserId == meUserId) return NO_WARNING

    val started = parseInstant(draftStartedAt) ?: return NO_WARNING
    val landed = parseInstant(lastOutboundAt) ?: return NO_WARNING
    if (landed.isBefore(started)) return NO_WARNING
    return DuplicateReplyWarning(warn = true, byUserId = lastOutboundByUserId)
}

/**
 * An unreadable timestamp is silence: never stand between a tech and a waiting
 * customer on the strength of a date that failed to parse.
 */
private fun parseInstant(value: String): Instant? = try {
    Instant.parse(value)
} catch (_: DateTimeParseException) {
    null
}

/**
 * The sentence the confirmation opens with. Names the person when we know
 * them, because "Sam replied" is a fact somebody can act on — they can ask Sam
 * — and "someone replied" is not.
 */
fun duplicateReplyPrompt(who: String?, secondsAgo: Long): String {
    val ago = when {
        secondsAgo < 60 -> "just now"
        secondsAgo < 3600 -> {
            val m = secondsAgo / 60
            "$m minute${if (m == 1L) "" else "s"} ago"
        }
        secondsAgo < 86_400 -> {
            val h = secondsAgo / 3600
            "$h hour${if (h == 1L) "" else "s"} ago"
        }
        else -> "since you started writing"
    }
    val name = who?.trim().orEmpty()
    return if (name.isNotEmpty()) {
        "$name replied $ago."
    } else {
        "An automatic reply went out $ago."
    }
}
