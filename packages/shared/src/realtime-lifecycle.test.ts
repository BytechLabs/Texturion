import { describe, expect, it } from "vitest";

import {
  REALTIME_BACKGROUND_GRACE_MS,
  realtimeDropDelayMs,
  shouldHoldRealtime,
} from "./realtime-lifecycle";

/**
 * #289 — the socket a backgrounded phone should not be holding.
 *
 * Vectors shared with the Kotlin and Swift ports. Two platforms disagreeing
 * about when to drop a socket is how one of them ends up holding it forever,
 * and the symptom of that is a name on the battery screen rather than a bug
 * report.
 */
describe("holding the realtime socket", () => {
  const foreground = {
    visibility: "foreground" as const,
    backgroundedForMs: 0,
    callActive: false,
  };

  it("holds it while somebody is looking at the app", () => {
    expect(shouldHoldRealtime(foreground)).toBe(true);
    expect(realtimeDropDelayMs(foreground)).toBeNull();
  });

  it("holds it through a quick app-switch", () => {
    // Photographing a job, checking an address in Maps, answering a text on a
    // personal line. Tearing the socket down and rebuilding it for each of
    // those costs MORE radio than staying up: a fresh connection is a DNS
    // lookup, a TCP handshake, a TLS handshake and a channel join, against one
    // 300-byte heartbeat.
    expect(
      shouldHoldRealtime({
        visibility: "background",
        backgroundedForMs: 5_000,
        callActive: false,
      }),
    ).toBe(true);
  });

  it("drops it once the phone is genuinely in a pocket", () => {
    expect(
      shouldHoldRealtime({
        visibility: "background",
        backgroundedForMs: REALTIME_BACKGROUND_GRACE_MS,
        callActive: false,
      }),
    ).toBe(false);
  });

  it("never drops it under a live call, however long the app is backgrounded", () => {
    // Call state rides realtime — hold, transfer, the far end hanging up. A
    // call is also exactly when the phone is out of the pocket and often
    // plugged in. Dropping the socket here would trade a saving nobody asked
    // for against a call that silently stops updating.
    for (const backgroundedForMs of [0, REALTIME_BACKGROUND_GRACE_MS, 60 * 60_000]) {
      expect(
        shouldHoldRealtime({
          visibility: "background",
          backgroundedForMs,
          callActive: true,
        }),
        `${backgroundedForMs}ms`,
      ).toBe(true);
      expect(
        realtimeDropDelayMs({
          visibility: "background",
          backgroundedForMs,
          callActive: true,
        }),
      ).toBeNull();
    }
  });
});

describe("when to schedule the drop", () => {
  it("counts down the remaining grace", () => {
    expect(
      realtimeDropDelayMs({
        visibility: "background",
        backgroundedForMs: 10_000,
        callActive: false,
      }),
    ).toBe(REALTIME_BACKGROUND_GRACE_MS - 10_000);
  });

  it("says drop it now once the grace is spent", () => {
    expect(
      realtimeDropDelayMs({
        visibility: "background",
        backgroundedForMs: REALTIME_BACKGROUND_GRACE_MS + 1,
        callActive: false,
      }),
    ).toBe(0);
  });

  it("never returns a negative delay", () => {
    // A phone that was backgrounded overnight comes back with a huge elapsed
    // figure. A negative timer is either an immediate fire or a crash,
    // depending on the platform, and only one of those is the intent.
    const delay = realtimeDropDelayMs({
      visibility: "background",
      backgroundedForMs: 24 * 60 * 60_000,
      callActive: false,
    });
    expect(delay).toBe(0);
  });

  it("agrees with shouldHoldRealtime at every boundary", () => {
    // The two answer the same question — "is the socket wanted" and "when does
    // that change" — and a client wires both. If they can disagree, one
    // platform schedules a drop it then refuses to perform, and the socket
    // stays up forever.
    for (const backgroundedForMs of [
      0,
      1,
      REALTIME_BACKGROUND_GRACE_MS - 1,
      REALTIME_BACKGROUND_GRACE_MS,
      REALTIME_BACKGROUND_GRACE_MS + 1,
    ]) {
      const input = {
        visibility: "background" as const,
        backgroundedForMs,
        callActive: false,
      };
      const held = shouldHoldRealtime(input);
      const delay = realtimeDropDelayMs(input);
      expect(delay === 0, `${backgroundedForMs}ms`).toBe(!held);
    }
  });
});
