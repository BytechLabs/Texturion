package com.loonext.android.push

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
fun parsePush(data: Map<String, String>): PushContent {
    val kind = data["kind"]?.trim()?.takeIf { it.isNotEmpty() }
    val url = normalizeDeepLink(data["url"])
    val title = data["title"]?.trim()?.takeIf { it.isNotEmpty() }
    val body = data["body"]?.trim().orEmpty()
    val tag = coalescingTag(kind, url)

    if (kind == PushKind.CALL || kind == PushKind.CALL_END) {
        // call_end shares the call's channel and — critically — its
        // `call:<session>` tag: the tag IS the revocation key (§9.2). It is
        // never posted; the messaging service cancels by this tag instead.
        return PushContent(
            kind = kind,
            title = title ?: "Incoming call",
            body = body.ifEmpty { "Someone is calling your business number." },
            url = url,
            tag = tag,
            channelId = ChannelIds.INCOMING_CALLS,
        )
    }
    return PushContent(
        kind = kind,
        title = title ?: "Loonext",
        body = body.ifEmpty { "You have a new notification." },
        url = url,
        tag = tag,
        channelId = if (kind == PushKind.MISSED_CALL) {
            ChannelIds.MISSED_CALLS
        } else {
            ChannelIds.MESSAGES
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
 * Derive the notification coalescing tag from a NORMALIZED url:
 * - calls tag per call SESSION (#149: two concurrent calls ring as two
 *   notifications; repeats for one call replace each other; the matching
 *   `call_end` revocation cancels by this exact tag, calls-v3 §9.2)
 * - thread pushes tag per conversation (repeat texts in one thread coalesce)
 * - anything else tags per deep link
 */
fun coalescingTag(kind: String?, normalizedUrl: String): String {
    if (kind == PushKind.CALL || kind == PushKind.CALL_END) {
        val session = queryParam(normalizedUrl, "call")
        return if (session != null) "call:$session" else "call:$normalizedUrl"
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
