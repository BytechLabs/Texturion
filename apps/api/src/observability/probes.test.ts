/**
 * #477 — the synthetic probes.
 *
 * The acceptance criterion that carries the most weight is the cost one: every
 * probe that spends money has a stated ceiling and STOPS when it is reached.
 * The rest of this pins the thing that makes a probe worth having at all —
 * that it can actually fail.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { completeEnv, stubFetch } from "../test/support";
import {
  PROBES,
  PROBE_TIMEOUT_MS,
  SEND_PROBE_MONTHLY_CEILING,
  WEBHOOK_SILENCE_LIMIT_MS,
  probeAuth,
} from "./probes";

const env = completeEnv();

describe("#477 probe declarations", () => {
  it("names every probe once", () => {
    expect(new Set(PROBES).size).toBe(PROBES.length);
  });

  it("caps the billable probe at a stated, small number", () => {
    // At roughly a cent a segment this ceiling is worth about 45¢ a month —
    // sized for a daily probe plus retries, not an hourly one. The number
    // matters less than the fact that there IS one: per the cost posture this
    // is capped before it is prompted.
    expect(SEND_PROBE_MONTHLY_CEILING).toBeGreaterThan(0);
    expect(SEND_PROBE_MONTHLY_CEILING).toBeLessThanOrEqual(100);
  });

  it("gives the carrier a long silence before calling it an outage", () => {
    // A real workspace can be genuinely quiet overnight. A probe that cries
    // wolf at 3am on a slow Tuesday is a probe somebody mutes, and a muted
    // probe is worse than none.
    expect(WEBHOOK_SILENCE_LIMIT_MS).toBeGreaterThanOrEqual(4 * 60 * 60 * 1000);
  });

  it("bounds how long a probe may hang", () => {
    // A probe with no timeout is a cron job that never finishes, which takes
    // every job behind it down with it.
    expect(PROBE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("#477 probeAuth", () => {
  it("passes when auth answers", async () => {
    stubFetch(() => new Response("{}", { status: 200 }));
    const outcome = await probeAuth(env);
    expect(outcome.ok).toBe(true);
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("FAILS on a 401 rather than counting it as a reply", async () => {
    // The distinction that makes this a probe. A broken auth stack answers 401
    // cheerfully all day, and a check that only asked "did a response arrive"
    // would call that healthy.
    stubFetch(() => new Response("", { status: 401 }));
    const outcome = await probeAuth(env);
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toBe("status_401");
  });

  it("fails when the request throws, and records the error NAME only", async () => {
    // Never the message: a fetch message can carry the URL, and the URL carries
    // a key. This row is read by a public page.
    stubFetch(() => {
      throw new TypeError("https://project.supabase.co/auth/v1/health?apikey=secret");
    });
    const outcome = await probeAuth(env);
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toBe("TypeError");
    expect(outcome.detail).not.toContain("apikey");
  });

  it("records a detail short enough for the column", async () => {
    // The column caps `detail` at 64 characters, and an insert that violates it
    // would lose the result — the one row that says something went wrong.
    stubFetch(() => {
      const error = new Error("x");
      error.name = "E".repeat(200);
      throw error;
    });
    const outcome = await probeAuth(env);
    expect(outcome.detail?.length).toBeLessThanOrEqual(64);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
