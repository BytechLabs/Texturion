/**
 * #289 — what the realtime socket does when the phone is not being looked at.
 *
 * Today it does nothing different, and that is the finding rather than a bug
 * report: both phone apps connect on sign-in and disconnect on sign-out, so a
 * backgrounded app holds a WebSocket and sends a heartbeat every 25 seconds for
 * as long as the process lives.
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
 * cellular radio on a phone in somebody's pocket is held awake all day by an app
 * they are not using. That is what puts a name on the battery screen, and #289
 * is explicit that landing there is fatal and silent — nobody files a bug, they
 * uninstall.
 *
 * ---------------------------------------------------------------------------
 * WHY DROPPING THE SOCKET COSTS NOTHING.
 *
 * Everything that must reach a person who is not looking at the app already
 * arrives by push (#151): a new message, a task, and — the one that would be
 * unforgivable to miss — an incoming call, which is woken by a `call` push and
 * answered through `onIncomingCallPush`, never by a socket frame. The socket
 * exists to keep a VISIBLE screen live. There is no visible screen.
 *
 * And catching up is already built: reconnecting emits the signal every open
 * surface refetches its first page on, which is the same path a tunnel or a
 * lift already exercises many times a day.
 */

/**
 * How long the app stays connected after it stops being looked at.
 *
 * Not zero, deliberately. Somebody photographing a job switches to the camera
 * and back, checks an address in Maps, answers a text on their personal line —
 * all in a few seconds. Tearing the socket down and rebuilding it for each of
 * those would cost MORE radio than staying up: a fresh connection is a DNS
 * lookup, a TCP handshake, a TLS handshake and a channel join, against one
 * 300-byte heartbeat.
 *
 * Thirty seconds covers the app-switch case and is far short of the minutes a
 * phone spends in a pocket.
 */
export const REALTIME_BACKGROUND_GRACE_MS = 30_000;

/** The lifecycle states both phone shells can report. */
export type AppVisibility = "foreground" | "background";

export interface RealtimeLifecycleInput {
  visibility: AppVisibility;
  /** Milliseconds since the app went to the background, if it is there. */
  backgroundedForMs: number;
  /**
   * A call is live on this device.
   *
   * The one thing that keeps the socket up regardless. Call state rides
   * realtime — hold, transfer, the far end hanging up — and a call is also
   * precisely when the phone is out of the pocket, plugged in as often as not,
   * and being actively used. Dropping the socket under a live call would trade
   * a battery saving nobody asked for against a call that silently stops
   * updating.
   */
  callActive: boolean;
}

/** Should the realtime socket be connected right now? */
export function shouldHoldRealtime(input: RealtimeLifecycleInput): boolean {
  if (input.callActive) return true;
  if (input.visibility === "foreground") return true;
  return input.backgroundedForMs < REALTIME_BACKGROUND_GRACE_MS;
}

/**
 * Milliseconds until the socket should be dropped, or null when it should stay.
 *
 * Returned rather than computed by each client so the two phones schedule the
 * same timer off the same arithmetic — and so "should it be up" and "when does
 * that change" cannot disagree, which is the shape of bug that leaves a socket
 * open forever on one platform.
 */
export function realtimeDropDelayMs(
  input: RealtimeLifecycleInput,
): number | null {
  if (!shouldHoldRealtime(input)) return 0;
  if (input.callActive || input.visibility === "foreground") return null;
  return Math.max(0, REALTIME_BACKGROUND_GRACE_MS - input.backgroundedForMs);
}
