import { createScheduledController, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DARK_AFTER_MS, runDeadman, STALE_AFTER_MS } from "./deadman";
import type { Env } from "./env";
import worker from "./index";
import { mailStatus } from "./mailbox";
import { SENTRY_DAILY_MAX } from "./uplink";
import { edgeEnv, fakeGuard, resetEdge, uplinkStub } from "./test/support";

const SYNTHETIC_DSN = "https://synthetickey@o1.ingest.sentry.io/101";
const PROD_DSN = "https://prodkey@o1.ingest.sentry.io/202";
const NOW = 1_790_000_000_000;
const MINUTE = 60_000;

let env: Env;
let sent: { url: string; auth: string | null; event: Record<string, unknown> }[];

beforeEach(async () => {
  await resetEdge();
  env = await edgeEnv(fakeGuard(), { SENTRY_SYNTHETIC_DSN: SYNTHETIC_DSN, SENTRY_PROD_DSN: PROD_DSN });
  sent = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const lines = (await request.text()).split("\n");
    sent.push({ url: request.url, auth: request.headers.get("x-sentry-auth"), event: JSON.parse(lines[2]) });
    return new Response("{}", { status: 200 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Heartbeats as of `ago` milliseconds before NOW; null leaves one unheard. */
async function heard(beats: Partial<Record<"rig" | "suite" | "triage", number | null>>, armedAgo: number) {
  await runInDurableObject(uplinkStub(), (_instance, state) => {
    state.storage.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('armed_at', ?)", String(NOW - armedAgo));
    for (const [component, ago] of Object.entries(beats)) {
      if (ago === null || ago === undefined) continue;
      state.storage.sql.exec(
        "INSERT OR REPLACE INTO heartbeats (component, at, reported_at) VALUES (?, ?, 'x')",
        component,
        NOW - ago,
      );
    }
  });
}

describe("the dead-man", () => {
  it("does nothing before the first heartbeat ever arrives", async () => {
    const report = await runDeadman(env, NOW);
    expect(report).toEqual({ armed: false, stale: [], dark: false, sent: [] });
    expect(sent).toEqual([]);
  });

  it("stays quiet while every heartbeat is fresh", async () => {
    await heard({ rig: MINUTE, suite: 60 * MINUTE, triage: 30 * MINUTE }, 10 * 24 * 60 * MINUTE);
    expect(await runDeadman(env, NOW)).toMatchObject({ armed: true, stale: [], dark: false });
    expect(sent).toEqual([]);
  });

  it("sends one synthetic-infra event per stale component, to the synthetic DSN", async () => {
    await heard({ rig: STALE_AFTER_MS.rig + MINUTE, suite: MINUTE, triage: MINUTE }, 24 * 60 * MINUTE);
    const report = await runDeadman(env, NOW);
    expect(report.stale).toEqual(["rig"]);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://o1.ingest.sentry.io/api/101/envelope/");
    expect(sent[0].auth).toContain("sentry_key=synthetickey");
    expect(sent[0].event).toMatchObject({ fingerprint: ["synthetic-infra", "rig"], level: "warning" });
  });

  it("counts a component never heard from since arming as stale", async () => {
    await heard({ rig: MINUTE, suite: MINUTE }, STALE_AFTER_MS.triage + MINUTE);
    expect((await runDeadman(env, NOW)).stale).toEqual(["triage"]);
  });

  it("suppresses a repeat for six hours", async () => {
    const rigAlerts = () => sent.filter((s) => JSON.stringify(s.event.fingerprint) === '["synthetic-infra","rig"]');
    await heard({ rig: STALE_AFTER_MS.rig + MINUTE, suite: MINUTE, triage: MINUTE }, 24 * 60 * MINUTE);
    await runDeadman(env, NOW);
    await runDeadman(env, NOW + 15 * MINUTE);
    expect(rigAlerts()).toHaveLength(1);
    await runDeadman(env, NOW + 6 * 60 * MINUTE);
    expect(rigAlerts()).toHaveLength(2);
  });

  it("tells production when the whole system has been dark for six hours", async () => {
    const silent = DARK_AFTER_MS + MINUTE;
    await heard({ rig: silent, suite: silent, triage: silent }, 7 * 24 * 60 * MINUTE);
    const report = await runDeadman(env, NOW);
    expect(report.dark).toBe(true);
    const prod = sent.filter((s) => s.url.includes("/api/202/"));
    expect(prod).toHaveLength(1);
    expect(prod[0].event).toMatchObject({
      fingerprint: ["ops", "synthetic-dark"],
      level: "error",
      tags: { ops_key: "synthetic-dark" },
    });
    // Six hours is past the rig's and triage's limits but inside the suite's.
    expect(sent.filter((s) => s.url.includes("/api/101/")).map((s) => s.event.fingerprint)).toEqual([
      ["synthetic-infra", "rig"],
      ["synthetic-infra", "triage"],
    ]);
  });

  it("is not dark while any one heartbeat is recent", async () => {
    const silent = DARK_AFTER_MS + MINUTE;
    await heard({ rig: silent, suite: MINUTE, triage: silent }, 7 * 24 * 60 * MINUTE);
    expect((await runDeadman(env, NOW)).dark).toBe(false);
    expect(sent.some((s) => s.url.includes("/api/202/"))).toBe(false);
  });

  it("sends no more than the daily budget", async () => {
    await heard({ rig: STALE_AFTER_MS.rig + MINUTE, suite: MINUTE, triage: MINUTE }, 24 * 60 * MINUTE);
    for (let i = 0; i < SENTRY_DAILY_MAX.synthetic + 5; i++) {
      await runInDurableObject(uplinkStub(), (_instance, state) => {
        state.storage.sql.exec("DELETE FROM meta WHERE key LIKE 'alert:%'");
      });
      await runDeadman(env, NOW + i);
    }
    expect(sent).toHaveLength(SENTRY_DAILY_MAX.synthetic);
  });

  it("names no release on what it sends, so production's release history stays its own", async () => {
    const silent = DARK_AFTER_MS + MINUTE;
    await heard({ rig: silent, suite: silent, triage: silent }, 7 * 24 * 60 * MINUTE);
    await runDeadman({ ...env, GIT_SHA: "0123abc" }, NOW);
    expect(sent.length).toBeGreaterThan(0);
    for (const { event } of sent) {
      expect(event.release).toBeUndefined();
      expect(event.tags).toMatchObject({ edge_sha: "0123abc" });
    }
  });

  /** The rig, the suite and triage all go silent at once, and the cron runs every 15 minutes for 7 hours. */
  async function goDark(e: Env): Promise<void> {
    await heard({ rig: 0, suite: 0, triage: 0 }, 7 * 24 * 60 * MINUTE);
    for (let at = NOW; at <= NOW + 7 * 60 * MINUTE; at += 15 * MINUTE) await runDeadman(e, at);
  }
  const darkAlerts = () => sent.filter((s) => s.url.includes("/api/202/"));

  it("still tells production the rig is dark when no synthetic DSN is configured", async () => {
    await goDark({ ...env, SENTRY_SYNTHETIC_DSN: undefined });
    expect(darkAlerts()).toHaveLength(1);
    expect(sent.filter((s) => s.url.includes("/api/101/"))).toEqual([]);
  });

  it("still tells production the rig is dark while the synthetic project refuses every event", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const lines = (await request.text()).split("\n");
      sent.push({ url: request.url, auth: request.headers.get("x-sentry-auth"), event: JSON.parse(lines[2]) });
      return new Response("{}", { status: request.url.includes("/api/101/") ? 500 : 200 });
    });
    await goDark(env);
    expect(darkAlerts()).toHaveLength(1);
    // Refused sends are retried hourly, not every cron: the rig's from 45
    // minutes in (7 tries), triage's from 3 h 15 (4 tries).
    expect(sent.filter((s) => s.url.includes("/api/101/"))).toHaveLength(11);
  });

  it("runs from the cron, and refreshes the mail heartbeat even with no DSN", async () => {
    const bare = await edgeEnv(fakeGuard());
    await worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: "*/15 * * * *" }), bare);
    expect((await mailStatus(bare)).heartbeat_at).toBe(new Date(NOW).toISOString());
  });
});
