package com.loonext.android.features.inbox

/**
 * Pure decision + copy for the global inbound-message toast (#165) — no
 * Android imports, unit-tested on the JVM. The realtime payload is treated as
 * an ID-only routing hint (SPEC §8): these fields steer WHETHER to toast; the
 * toast's content comes from a refetch through the authed API.
 */

/**
 * Toast only a real customer text that landed OUTSIDE the thread the user is
 * looking at:
 *  - `message.created` events only,
 *  - inbound direction only (own sends and notes are not news),
 *  - never for the conversation currently on screen (its thread shows the
 *    bubble itself — a toast on top would be noise),
 *  - a payload with no conversation id can't be routed — skip it.
 */
fun shouldToastInbound(
    eventName: String,
    conversationId: String?,
    direction: String?,
    viewedConversationId: String?,
): Boolean {
    if (eventName != "message.created") return false
    if (conversationId == null) return false
    if (direction != "inbound") return false
    return conversationId != viewedConversationId
}

/**
 * The toast's one line: "Dana: Sure, 3pm works" — name (or formatted number),
 * a colon, and the message body trimmed to one line. A media-only text says
 * what arrived instead of showing an empty snippet.
 */
fun inboundToastLine(
    contactName: String?,
    body: String?,
    hasAttachments: Boolean,
    maxLength: Int = 90,
): String {
    val who = contactName?.trim()?.takeIf { it.isNotEmpty() } ?: "New message"
    val text = body?.trim()?.replace(Regex("\\s+"), " ").orEmpty()
    val snippet = when {
        text.isNotEmpty() -> text
        hasAttachments -> "Sent a photo"
        else -> "Sent a message"
    }
    val line = "$who: $snippet"
    return if (line.length <= maxLength) line else line.take(maxLength - 1).trimEnd() + "…"
}
