/**
 * D142 P01: the hourly ring-success watch.
 *
 * The counting and the verdict are the SQL function's, and
 * supabase/tests/ring_success.test.sql proves them. What is proved here is
 * what the job does with the verdicts: every row reaches the log with its n,
 * nothing short of a sufficient sample alerts, a new drop alerts at once, and
 * a drop that persists is repeated only every six hours.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { completeEnv, stubFetch } from "../test/support";
import { opsCaptures, resetSentryCaptures } from "../test/sentry-mock";
import {
  RING_SUCCESS_PREFIX,
  runRingSuccessWatch,
  type RingSuccessRow,
} from "./ring-success";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

const env = completeEnv();
const RPC = "/rest/v1/rpc/api_ring_success";

function row(overrides: Partial<RingSuccessRow>): RingSuccessRow {
  return {
    platform: "android",
    app_version: "1.42.0",
    attempts: 40,
    rang_in_time: 38,
    ring_rate: 0.95,
    baseline_attempts: 120,
    baseline_rate: 0.95,
    threshold: 0.8466,
    answered_sessions: 12,
    verdict: "pass",
    ...overrides,
  };
}

const androidDrop = row({ rang_in_time: 30, ring_rate: 0.75, verdict: "drop" });

/**
 * Serves api_ring_success by the hour it is asked about: `now` for this run's
 * window, anything else for the window an hour older.
 */
function database(now: Date, current: RingSuccessRow[], hourAgo: RingSuccessRow[]) {
  const asked: string[] = [];
  stubFetch(
    async (url, request) => {
      if (url.pathname !== RPC) return undefined;
      const { p_now } = (await request.clone().json()) as { p_now: string };
      asked.push(p_now);
      return Response.json(p_now === now.toISOString() ? current : hourAgo);
    },
    (url) => (url.host === "api.resend.com" ? Response.json({ id: "email-1" }) : undefined),
  );
  return asked;
}

let logged: string[];

beforeEach(() => {
  resetSentryCaptures();
  logged = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the ring-success watch", () => {
  it("logs every row with its n, and alerts on nothing that is not a drop", async () => {
    const now = new Date("2026-10-31T14:00:00Z");
    const rows = [
      row({}),
      row({ platform: "ios", app_version: "2.0.1", attempts: 29, rang_in_time: 0, ring_rate: 0, threshold: null, verdict: "insufficient_sample" }),
      row({ platform: "web", app_version: "unknown", baseline_attempts: 0, baseline_rate: null, threshold: null, verdict: "no_baseline" }),
    ];
    const asked = database(now, rows, []);

    const report = await runRingSuccessWatch(env, now);

    expect(report.alerted).toEqual([]);
    expect(opsCaptures()).toEqual([]);
    expect(asked, "no drop, so no need to read the hour before").toEqual([now.toISOString()]);
    const lines = logged.filter((line) => line.startsWith(RING_SUCCESS_PREFIX));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0].slice(RING_SUCCESS_PREFIX.length)) as {
      rows: RingSuccessRow[];
      media_on_answered: string;
    };
    expect(parsed.rows.map((r) => [r.platform, r.attempts, r.verdict])).toEqual([
      ["android", 40, "pass"],
      ["ios", 29, "insufficient_sample"],
      ["web", 40, "no_baseline"],
    ]);
    expect(parsed.media_on_answered).toMatch(/^not_measured/);
  });

  it("alerts the hour a drop first appears, keyed by platform", async () => {
    const now = new Date("2026-10-31T14:00:00Z");
    database(now, [androidDrop, row({ platform: "ios", app_version: "2.0.1" })], [row({})]);

    const report = await runRingSuccessWatch(env, now);

    expect(report.alerted).toEqual(["android"]);
    const [alert] = opsCaptures("ring-success-android");
    expect(alert.fingerprint).toEqual(["ops", "ring-success-android"]);
    expect(alert.level).toBe("error");
    expect(String(alert.extra.detail)).toBe(
      "android 1.42.0: 30/40 rang within 15 s (75%), against 95% over the prior " +
        "7 days (n=120); the alarm is below 84.7%.",
    );
    expect(opsCaptures()).toHaveLength(1);
  });

  it("keeps a persisting drop quiet between the six-hourly reminders", async () => {
    const quiet = new Date("2026-10-31T14:00:00Z");
    database(quiet, [androidDrop], [androidDrop]);
    expect((await runRingSuccessWatch(env, quiet)).alerted).toEqual([]);
    expect(opsCaptures()).toEqual([]);

    const reminder = new Date("2026-10-31T18:00:00Z");
    database(reminder, [androidDrop], [androidDrop]);
    expect((await runRingSuccessWatch(env, reminder)).alerted).toEqual(["android"]);
  });

  it("treats a second version dropping on the same platform as new", async () => {
    const now = new Date("2026-10-31T15:00:00Z");
    const olderDrop = row({ app_version: "1.41.0", verdict: "drop", ring_rate: 0.5 });
    database(now, [androidDrop, olderDrop], [olderDrop]);

    const report = await runRingSuccessWatch(env, now);

    expect(report.alerted).toEqual(["android"]);
    const detail = String(opsCaptures("ring-success-android")[0].extra.detail);
    expect(detail.split("\n")).toHaveLength(2);
  });

  it("refuses a verdict it does not know rather than guessing", async () => {
    const now = new Date("2026-10-31T14:00:00Z");
    database(now, [{ ...row({}), verdict: "probably_fine" as never }], []);
    await expect(runRingSuccessWatch(env, now)).rejects.toThrowError(/unknown verdict/);
  });

  it("fails the run when the database refuses, so liveness sees it", async () => {
    stubFetch((url) =>
      url.pathname === RPC
        ? Response.json({ message: "function api_ring_success does not exist" }, { status: 404 })
        : undefined,
    );
    await expect(runRingSuccessWatch(env, new Date())).rejects.toThrowError(
      /ring success read failed/,
    );
  });
});
