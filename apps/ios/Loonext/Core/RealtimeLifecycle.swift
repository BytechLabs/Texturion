import Foundation

/**
 #289 — what the realtime socket does when the phone is not being looked at.

 Hand-ported from packages/shared/src/realtime-lifecycle.ts and covered by the
 same vectors. Two platforms disagreeing about when to drop a socket is how one
 of them ends up holding it forever, and the symptom of that is a name on the
 battery screen rather than a bug report.

 ---------------------------------------------------------------------------
 WHY 25 SECONDS IS THE WHOLE PROBLEM, AND WHY IT IS NOT ABOUT BYTES.

 A Phoenix heartbeat frame is about 60 bytes; with WebSocket framing, a TLS
 record and TCP/IP headers it is roughly 300 bytes on the wire in both
 directions. At one every 25 seconds that is ~3,456 a day — around a megabyte.
 Nobody's data plan notices a megabyte.

 The radio does. On LTE a transmission is followed by a tail during which the
 modem stays in a high-power state waiting for more traffic, and that tail is
 measured in seconds. A packet every 25 seconds never lets it expire: the
 cellular radio on a phone in somebody's pocket is held awake all day by an app
 they are not using. That is what puts a name on the battery screen, and #289 is
 explicit that landing there is fatal and silent — nobody files a bug, they
 uninstall.

 ---------------------------------------------------------------------------
 WHY DROPPING IT COSTS NOTHING.

 Everything that must reach somebody not looking at the app already arrives by
 push (#151): a message, a task, and — the one that would be unforgivable to
 miss — an incoming call, which is woken by a `call` push through `PushHooks`
 and never by a socket frame. The socket keeps a VISIBLE screen live. There is
 no visible screen.

 iOS suspends a backgrounded process within seconds anyway, which sounds like it
 makes this moot and does the opposite: the socket is torn down by the system
 without the app ever saying so, so the server sees a dead connection and the
 app resumes into a reconnect it did not schedule. Saying it explicitly is what
 makes the behaviour a decision rather than a side effect — which is #289's
 Acceptance line in as many words.
 */
enum RealtimeLifecycle {

    /**
     How long the app stays connected after it stops being looked at.

     Not zero, deliberately. Somebody photographing a job switches to the camera
     and back, checks an address in Maps, answers a text on their personal line
     — all in a few seconds. Tearing the socket down and rebuilding it for each
     of those would cost MORE radio than staying up: a fresh connection is a DNS
     lookup, a TCP handshake, a TLS handshake and a channel join, against one
     300-byte heartbeat.
     */
    static let backgroundGraceMs = 30_000

    /// Should the realtime socket be connected right now?
    static func shouldHold(
        foreground: Bool,
        backgroundedForMs: Int,
        callActive: Bool
    ) -> Bool {
        if callActive { return true }
        if foreground { return true }
        return backgroundedForMs < backgroundGraceMs
    }

    /**
     Milliseconds until the socket should be dropped, or nil when it stays.

     Shares its arithmetic with `shouldHold` rather than restating it, so "is the
     socket wanted" and "when does that change" cannot disagree — which is the
     shape of bug that schedules a drop and then refuses to perform it.
     */
    static func dropDelayMs(
        foreground: Bool,
        backgroundedForMs: Int,
        callActive: Bool
    ) -> Int? {
        guard shouldHold(
            foreground: foreground,
            backgroundedForMs: backgroundedForMs,
            callActive: callActive
        ) else { return 0 }
        if callActive || foreground { return nil }
        return max(0, backgroundGraceMs - backgroundedForMs)
    }
}
