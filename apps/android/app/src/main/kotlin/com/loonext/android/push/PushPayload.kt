package com.loonext.android.push

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import java.net.URI
import java.net.URLDecoder

/**
 * Pure push-payload logic (no Android imports — unit-tested on the JVM).
 *
 * The server push contract (apps/api/src/notifications — inbound.ts,
 * missed-call.ts, incoming-call.ts) is a data map of `{title, body, url}`
 * plus `kind: 'call'` for the push-to-wake ring (#135; the server ring
 * window is 45s, calls-v3 §5) and `kind: 'call_end'` for the ring-revocation
 * push (calls-v3 §9.2 — delivery is capability-gated on the `call_end` cap
 * this client declares at token registration). Malformed payloads still
 * render a calm generic notification — a push is never silently dropped
 * (web sw.js parity). `call_end` is the ONE kind that never renders: it
 * exists solely to cancel the `call:<session>` tray entry and dismiss the
 * in-app ring surfaces.
 */

/** The only origin push deep links may target (web sw.js does the same). */
const val APP_ORIGIN = "https://app.loonext.com"

/** Default deep link when a push carries no usable url. */
const val FALLBACK_DEEP_LINK = "$APP_ORIGIN/inbox"

/**
 * Structural `kind` discriminator values. `call` is live today
 * (incoming-call.ts); `missed_call` is the discriminator #151's native sender
 * should set so missed calls land on their own channel — until it does they
 * fall through to the Messages channel (same importance, still delivered).
 */
object PushKind {
    const val CALL = "call"
    const val MISSED_CALL = "missed_call"

    /** A task the reader is assigned, shortly before (or after) its due date. */
    const val TASK_DUE = "task_due"

    /**
     * A teammate handed the reader a conversation, or a whole selection of
     * them at once (#515). One value for both: the reader's next move is
     * identical either way, and the link already says which it was.
     */
    const val CONVERSATION_ASSIGNED = "conversation_assigned"

    /** A teammate put a job on the reader's name (#515). */
    const val TASK_ASSIGNED = "task_assigned"

    /**
     * #564: a customer replying URGENT. Sent on the NATIVE payload only
     * (inbound.ts) — the service worker has no channels to pick from, so the
     * discriminator would be a field nothing reads on web.
     */
    const val EMERGENCY = "emergency"

    /**
     * #607: a customer paid, was refunded, or their bank pulled the money back.
     *
     * ONE kind for all three, because this discriminator decides WHERE a push
     * lands and all three belong in the same place. A refund on a channel a
     * deposit is not would be a switch somebody could silence without ever
     * knowing they had.
     */
    const val PAYMENT = "payment"

    /**
     * Ring revocation on every exit from `ringing` (calls-v3 §9.2). Android
     * FCM sends are data-only with NO collapse key, so the ONLY dismissal
     * mechanism is this client's explicit cancel-by-tag (`call:<session>`).
     */
    const val CALL_END = "call_end"
}

/** One parsed, display-ready push. */
data class PushContent(
    /** Raw `kind` value, null when absent — branch structurally, never on text. */
    val kind: String?,
    val title: String,
    val body: String,
    /** Normalized absolute deep link (always on [APP_ORIGIN]). */
    val url: String,
    /** Coalescing tag: repeats for one thread/call replace, not stack (#149). */
    val tag: String,
    /** Channel this push posts on when rendered as a notification. */
    val channelId: String,
) {
    val isCall: Boolean get() = kind == PushKind.CALL

    /** A `call_end` revocation — cancel `call:<session>` and render NOTHING. */
    val isCallEnd: Boolean get() = kind == PushKind.CALL_END

    /** `call` query param from the wake link (`/calls?call=<call_session_id>`). */
    val callSessionId: String? get() = queryParam(url, "call")
}

/**
 * Parse an FCM data map into displayable content. Every field is optional on
 * the wire; missing/garbage input degrades to a generic notice on the
 * Messages channel with the inbox fallback link.
 */
fun parsePush(
    data: Map<String, String>,
    locale: String = MessageLocale.DEFAULT,
): PushContent {
    val kind = data["kind"]?.trim()?.takeIf { it.isNotEmpty() }
    val url = normalizeDeepLink(data["url"])
    val title = data["title"]?.trim()?.takeIf { it.isNotEmpty() }
    val body = data["body"]?.trim().orEmpty()
    val tag = coalescingTag(kind, url, data["tag"])

    if (kind == PushKind.CALL || kind == PushKind.CALL_END) {
        // call_end shares the call's channel and — critically — its
        // `call:<session>` tag: the tag IS the revocation key (§9.2). It is
        // never posted; the messaging service cancels by this tag instead.
        return PushContent(
            kind = kind,
            title = title ?: AppStrings.translate(locale, "push.fallbackIncomingTitle"),
            body = body.ifEmpty {
                AppStrings.translate(locale, "push.fallbackIncomingBody")
            },
            url = url,
            tag = tag,
            channelId = ChannelIds.INCOMING_CALLS,
        )
    }
    return PushContent(
        kind = kind,
        title = title ?: "Loonext",
        body = body.ifEmpty { AppStrings.translate(locale, "push.fallbackGenericBody") },
        url = url,
        tag = tag,
        channelId = when (kind) {
            // #564: its own high-importance channel. On the Messages channel an
            // urgent text buzzed exactly as loudly as "on my way?" and was
            // silenced by the same switch — while the reply we send that
            // customer says the crew has been alerted.
            PushKind.EMERGENCY -> ChannelIds.EMERGENCY
            // #607: money is not a message. On the Messages channel a deposit
            // landing was silenced by the same switch as "on my way?", and the
            // person most likely to have muted the inbox for the afternoon is
            // the one standing in the driveway waiting on it.
            PushKind.PAYMENT -> ChannelIds.PAYMENTS
            PushKind.MISSED_CALL -> ChannelIds.MISSED_CALLS
            PushKind.TASK_DUE -> ChannelIds.TASK_REMINDERS
            PushKind.CONVERSATION_ASSIGNED, PushKind.TASK_ASSIGNED ->
                ChannelIds.ASSIGNMENTS
            // An unknown kind is a newer server than this build: render it on
            // the general channel rather than dropping it.
            else -> ChannelIds.MESSAGES
        },
    )
}

/**
 * Normalize a push deep link (web sw.js parity):
 * - relative paths resolve against [APP_ORIGIN]
 * - legacy `/conversations/{id}` becomes `/inbox/{id}`
 * - query strings are preserved (the `/calls?call=…` wake link needs its param)
 * - foreign-origin or unparseable urls fall back to [FALLBACK_DEEP_LINK]
 */
fun normalizeDeepLink(raw: String?): String {
    val trimmed = raw?.trim().orEmpty()
    if (trimmed.isEmpty()) return FALLBACK_DEEP_LINK
    val absolute = if (trimmed.startsWith("/")) APP_ORIGIN + trimmed else trimmed
    val uri = try {
        URI(absolute)
    } catch (_: Exception) {
        return FALLBACK_DEEP_LINK
    }
    if (uri.scheme != "https" || uri.host != "app.loonext.com") return FALLBACK_DEEP_LINK
    val path = uri.rawPath.orEmpty().ifEmpty { "/inbox" }
    val normalizedPath = Regex("^/conversations/([^/?#]+)$").find(path)
        ?.let { "/inbox/${it.groupValues[1]}" }
        ?: path
    val query = uri.rawQuery?.let { "?$it" }.orEmpty()
    return "$APP_ORIGIN$normalizedPath$query"
}

/**
 * Derive the notification coalescing tag.
 *
 * The SERVER's `tag` wins when it sends one (#266): it is the single collapse
 * identity shared with iOS's apns-collapse-id and the web tag, and it knows
 * things this url does not — a mention keys on the NOTE, so two asks in one
 * thread stay two alerts instead of the second erasing the first.
 *
 * Calls are the one exception: `call:<session>` is the REVOCATION key
 * `call_end` cancels by (§9.2), so it stays derived from the session on the
 * link and is never overridden.
 *
 * Without a server tag (older server, malformed payload) fall back to the url:
 * - task reminders tag per TASK, not per conversation: the reminder deep-links
 *   to the job over its customer's thread, and tagging on the thread would let
 *   a reminder and an incoming text replace one another
 * - thread pushes tag per conversation (repeat texts in one thread coalesce)
 * - anything else tags per deep link
 */
fun coalescingTag(kind: String?, normalizedUrl: String, serverTag: String? = null): String {
    if (kind == PushKind.CALL || kind == PushKind.CALL_END) {
        val session = queryParam(normalizedUrl, "call")
        return if (session != null) "call:$session" else "call:$normalizedUrl"
    }
    serverTag?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    if (kind == PushKind.TASK_DUE) {
        val task = queryParam(normalizedUrl, "task")
        return if (task != null) "task:$task" else "task:$normalizedUrl"
    }
    val conversation = Regex("^${Regex.escape(APP_ORIGIN)}/inbox/([^/?#]+)")
        .find(normalizedUrl)?.groupValues?.get(1)
    return if (conversation != null) "conversation:$conversation" else "notice:$normalizedUrl"
}

/** First value of a query parameter, decoded; null when absent/unparseable. */
fun queryParam(url: String, name: String): String? {
    val rawQuery = try {
        URI(url).rawQuery
    } catch (_: Exception) {
        null
    } ?: return null
    for (pair in rawQuery.split('&')) {
        val eq = pair.indexOf('=')
        val key = if (eq >= 0) pair.substring(0, eq) else pair
        if (key != name) continue
        val value = if (eq >= 0) pair.substring(eq + 1) else ""
        return try {
            URLDecoder.decode(value, "UTF-8")
        } catch (_: Exception) {
            value
        }.takeIf { it.isNotEmpty() }
    }
    return null
}
