package com.loonext.android.core.realtime

/**
 * #289 — what the realtime socket does when the phone is not being looked at.
 *
 * Hand-ported from packages/shared/src/realtime-lifecycle.ts and covered by the
 * same vectors. Two platforms disagreeing about when to drop a socket is how
 * one of them ends up holding it forever, and the symptom of that is a name on
 * the battery screen rather than a bug report.
 *
 * ---------------------------------------------------------------------------
 * WHY 25 SECONDS IS THE WHOLE PROBLEM, AND WHY IT IS NOT ABOUT BYTES.
 *
 * A Phoenix heartbeat frame is about 60 bytes; with WebSocket framing, a TLS
 * record and TCP/IP headers it is roughly 300 bytes on the wire in both
 * directions. At one every 25 seconds that is ~3,456 a day — around a megabyte.
 * Nobody's data plan notices a megabyte.
 *
 * The radio does. On LTE a transmission is followed by a tail during which the
 * modem stays in a high-power state waiting for more traffic, and that tail is
 * measured in seconds. A packet every 25 seconds never lets it expire: the
 * cellular radio on a phone in somebody's pocket is held awake all day by an
 * app they are not using. That is what puts a name on the battery screen, and
 * #289 is explicit that landing there is fatal and silent — nobody files a bug,
 * they uninstall.
 *
 * ---------------------------------------------------------------------------
 * WHY DROPPING IT COSTS NOTHING.
 *
 * Everything that must reach somebody not looking at the app already arrives by
 * push (#151): a message, a task, and — the one that would be unforgivable to
 * miss — an incoming call, which is woken by a `call` push through
 * [com.loonext.android.push.PushHooks.callWakeHandler] and never by a socket
 * frame. The socket keeps a VISIBLE screen live. There is no visible screen.
 *
 * Catching up is already built: reconnecting emits the signal every open
 * surface refetches its first page on, which is the same path a tunnel or a
 * lift exercises many times a day.
 */
object RealtimeLifecycle {

    /**
     * How long the app stays connected after it stops being looked at.
     *
     * Not zero, deliberately. Somebody photographing a job switches to the
     * camera and back, checks an address in Maps, answers a text on their
     * personal line — all in a few seconds. Tearing the socket down and
     * rebuilding it for each of those would cost MORE radio than staying up: a
     * fresh connection is a DNS lookup, a TCP handshake, a TLS handshake and a
     * channel join, against one 300-byte heartbeat.
     */
    const val BACKGROUND_GRACE_MS = 30_000L

    /** Should the realtime socket be connected right now? */
    fun shouldHold(
        foreground: Boolean,
        backgroundedForMs: Long,
        callActive: Boolean,
    ): Boolean {
        if (callActive) return true
        if (foreground) return true
        return backgroundedForMs < BACKGROUND_GRACE_MS
    }

    /**
     * Milliseconds until the socket should be dropped, or null when it stays.
     *
     * Shares its arithmetic with [shouldHold] rather than restating it, so "is
     * the socket wanted" and "when does that change" cannot disagree — which is
     * the shape of bug that schedules a drop and then refuses to perform it.
     */
    fun dropDelayMs(
        foreground: Boolean,
        backgroundedForMs: Long,
        callActive: Boolean,
    ): Long? {
        if (!shouldHold(foreground, backgroundedForMs, callActive)) return 0
        if (callActive || foreground) return null
        return (BACKGROUND_GRACE_MS - backgroundedForMs).coerceAtLeast(0)
    }
}
