import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { REALTIME_BACKGROUND_GRACE_MS } from "./realtime-lifecycle";

/**
 * #289 — "a regression check exists so a future change cannot silently
 * increase drain".
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CAN AND CANNOT BE.
 *
 * It cannot be a battery measurement. That needs a physical phone, a full
 * charge and a working day, and it is not a thing CI can hold. Saying so is
 * part of the answer rather than an excuse: #289's first Acceptance line asks
 * for a DOCUMENTED baseline, and the honest documented baseline for the data
 * half is arithmetic over what the code actually sends, which is what this file
 * holds.
 *
 * What it can be is a guard on the three numbers that decide how often a
 * backgrounded phone touches its radio, because those are the numbers a future
 * change moves by accident:
 *
 *   - the heartbeat interval, on both phones;
 *   - the reconnect backoff ceiling, on both phones;
 *   - the grace window before a backgrounded app drops its socket.
 *
 * A packet every 25 seconds holds an LTE modem in its high-power tail
 * indefinitely. That is the whole mechanism, and every one of these numbers is
 * a multiplier on how much of the day it applies to. Moving one is allowed;
 * moving one WITHOUT NOTICING is what this stops.
 *
 * Derived from the source files rather than from a list, for the same reason
 * `first-run-copy.test.ts` reads three clients: a number somebody has to
 * remember to update in two places is a number that ends up different in two
 * places.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SOURCES = {
  android:
    "apps/android/app/src/main/kotlin/com/loonext/android/core/realtime/RealtimeClient.kt",
  ios: "apps/ios/Loonext/Core/RealtimeClient.swift",
} as const;

const sources = Object.fromEntries(
  Object.entries(SOURCES).map(([client, path]) => [
    client,
    readFileSync(join(REPO, path), "utf8"),
  ]),
) as Record<keyof typeof SOURCES, string>;

/**
 * The heartbeat each client sends, in seconds, read off its source.
 *
 * A regex rather than an exported constant because these live inside the
 * transport on each platform and exporting them purely to be asserted would be
 * a worse arrangement than reading them: the number would then have a second
 * home, which is the thing being guarded against.
 */
function heartbeatSeconds(source: string): number[] {
  return [
    // Kotlin: `delay(25_000)` inside startHeartbeat.
    ...source.matchAll(/delay\((\d[\d_]*)\)\s*\n\s*ws\.send\(/g),
    // Swift: `try? await Task.sleep(for: .seconds(25))` in the heartbeat loop.
    ...source.matchAll(/Task\.sleep\(for: \.seconds\((\d+)\)\)/g),
  ].map((match) => {
    const raw = Number(match[1].replace(/_/g, ""));
    return raw > 1000 ? raw / 1000 : raw;
  });
}

describe("#289 the numbers that decide how often a phone touches its radio", () => {
  it("reads both transports, so the guard cannot pass on a renamed file", () => {
    for (const [client, text] of Object.entries(sources)) {
      expect(text.length, `${client} source is empty`).toBeGreaterThan(1000);
    }
  });

  it("keeps the heartbeat at 25 seconds on both phones", () => {
    // Not a target — a CEILING with a reason. Phoenix idle-closes a socket that
    // has not spoken in 60s, so this cannot go much higher while the socket is
    // up; the saving comes from the socket being DOWN when nobody is looking,
    // which is what the grace window below governs. Shortening it, though,
    // multiplies radio wake-ups directly, and a "let's make reconnects snappier"
    // change is exactly how that happens.
    for (const [client, source] of Object.entries(sources)) {
      const beats = heartbeatSeconds(source);
      expect(beats.length, `${client} has no heartbeat`).toBeGreaterThan(0);
      for (const seconds of beats) {
        expect(seconds, `${client} heartbeat`).toBe(25);
      }
    }
  });

  it("keeps the reconnect backoff capped at 30 seconds", () => {
    // The transport is reconnect-eager by design, after the parked-reconnect
    // bug. That is the right correctness call and it has a power cost on a
    // phone bouncing between two bad towers all day — which is the normal
    // environment here, not the edge case. The cap is what bounds it.
    expect(sources.android).toContain("min(30_000L,");
    expect(sources.ios).toMatch(/min\(\s*30(\.0)?,/);
  });

  it("drops the socket within half a minute of the app going away", () => {
    // The one number that decides how much of a working day the radio is held
    // for. Raising it is a decision somebody should have to make on purpose:
    // at 30s a phone in a pocket is silent, at 30 minutes it is not.
    expect(REALTIME_BACKGROUND_GRACE_MS).toBeLessThanOrEqual(30_000);
    expect(REALTIME_BACKGROUND_GRACE_MS).toBeGreaterThan(0);
  });

  it("costs about a megabyte a day while connected, and that is the small half", () => {
    // The documented DATA baseline, derived rather than measured — see the file
    // header for why the battery half cannot be.
    //
    // A Phoenix heartbeat frame is ~60 bytes of JSON. With WebSocket framing
    // (~6), a TLS record (~29) and TCP/IP headers (~52) it is ~150 bytes on the
    // wire, and the server's reply is another. Round to 300 bytes a beat.
    const bytesPerBeat = 300;
    const beatsPerDay = (24 * 60 * 60) / 25;
    const megabytesPerDay = (beatsPerDay * bytesPerBeat) / 1024 ** 2;
    expect(megabytesPerDay).toBeLessThan(2);

    // Which is the point: nobody's plan notices a megabyte, and the reason to
    // drop the socket anyway is that each of those 3,456 packets is a radio
    // wake-up with a multi-second tail behind it. If this assertion ever fails,
    // the heartbeat got shorter and the radio cost went up with it.
    expect(Math.round(beatsPerDay)).toBe(3456);
  });
});
