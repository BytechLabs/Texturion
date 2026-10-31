import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HEADER } from "@loonext/rig-protocol";
import { ManualClock } from "@loonext/rig-robot/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { parseWindow } from "./budget.ts";
import { textHash } from "./late.ts";
import { LeaseClient, type UndoHandlers } from "./lease.ts";
import { runScenario, type RunnerDeps } from "./runner.ts";
import type { ScenarioResult, ScenarioRunner } from "./scenarios/context.ts";
import { FakeApp, FakeBrowser, FakeRobot, FakeTime } from "./scenarios/fakes.ts";
import { parseDsn, SentryRelay } from "./sentry-relay.ts";
import { fakeFetch, json } from "./test-support.ts";
import { registryOf, scenario } from "./test-registry.ts";
import { VerdictStore } from "./verdicts.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const EDGE = "https://rig-edge.example.workers.dev";
const DSN = parseDsn("https://key@o1.ingest.sentry.example/101");
/** 1 November 2026, an even day from the epoch: S02's day (every 2 days, offset 0). */
const S02_DAY = Date.UTC(2026, 10, 1, 5, 0, 0);
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const REGISTRY = registryOf([
  scenario("S02", {
    lane: "browser",
    runs: [{ every: "2d", offset_days: 0, hour_utc: 5 }],
    dials: 1,
    far_end_legs: 1,
    min_room: 2,
  }),
  scenario("S20", { runs: [{ every: "1d" }] }),
  scenario("S04", {
    lane: "browser",
    runs: [{ every: "1d", offset_days: 0, hour_utc: 6 }],
    dials: 1,
    far_end_legs: 1,
    min_room: 2,
  }),
]);

interface SetupOptions {
  room?: number;
  at?: number;
  handlers?: UndoHandlers;
  acquire?: () => Response;
}

function setup(results: ScenarioResult[], options: SetupOptions = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), "rig-runner-"));
  dirs.push(stateDir);
  const clock = new ManualClock(options.at ?? S02_DAY);
  const { fetch, requests } = fakeFetch({
    [`POST ${EDGE}/g/lease`]: () => options.acquire?.() ?? json({ lease_id: `lease-${requests.length}`, scenario: "S02", expires_at: "x" }, 201),
    [`DELETE ${EDGE}/g/lease/`]: () => new Response(null, { status: 204 }),
    [`POST ${DSN.envelopeUrl}`]: () => new Response("{}"),
  });
  const leases = new LeaseClient({ edgeOrigin: EDGE, token: "t", stateDir, fetch, clock, handlers: options.handlers ?? {} });
  const verdicts = new VerdictStore(join(stateDir, "verdicts"));
  const attempts: number[] = [];
  const runner = (id: string): ScenarioRunner => ({
    id,
    async run(ctx) {
      attempts.push(ctx.attempt);
      ctx.evidence.seen = ctx.nonce;
      return results.shift() ?? { outcome: "pass" };
    },
  });
  const time = new FakeTime();
  const beats: number[] = [];
  const deps: RunnerDeps = {
    registry: REGISTRY,
    runners: { S02: runner("S02"), S20: runner("S20") },
    verdicts,
    leases,
    localLease: (scenario) => leases.acquireLocal(scenario),
    lanes: () => ({ robot: new FakeRobot(time), app: new FakeApp(time), browser: new FakeBrowser() }),
    relay: new SentryRelay({ statePath: join(stateDir, "relay.json"), alertDsn: DSN, fetch, clock }),
    syntheticDsn: DSN,
    sha: () => SHA,
    room: () => options.room ?? 4,
    dialWindow: async () => parseWindow("04-10"),
    caps: { daily: 18, hourly: 3 },
    clock,
    sleep: async (ms) => clock.advance(ms),
    ran: (at) => beats.push(at),
  };
  const reports = () => requests.filter((r) => r.url === DSN.envelopeUrl);
  const event = (index = 0) => JSON.parse(reports()[index]!.body!.split("\n")[2]!) as { fingerprint: string[]; message: { formatted: string }; level: string };
  return { deps, verdicts, requests, attempts, clock, reports, event, beats };
}

const failing = (failure_class: string): ScenarioResult => ({ outcome: "fail", failure_class, detail: "x" });

describe("runScenario", () => {
  it("records a pass with the SHA and the dials it spent, under a lease it releases", async () => {
    const { deps, verdicts, requests, beats } = setup([{ outcome: "pass" }]);
    const summary = await runScenario(deps, "S02", { scheduled: true });
    expect(summary.status).toBe("pass");
    expect(verdicts.all()).toMatchObject([{ scenario: "S02", sha: SHA, attempt: 1, outcome: "pass", dials: 2, scheduled: true }]);
    expect(requests.map((r) => r.method)).toEqual(["POST", "DELETE"]);
    expect(verdicts.evidence(summary.run_id!)[0]).toMatchObject({ attempt: 1, sha: SHA, lease: { reaped: false } });
    expect(beats).toHaveLength(1);
  });

  it("uses the run id it is given, so triage can name the run before it ends", async () => {
    const { deps } = setup([{ outcome: "pass" }]);
    expect((await runScenario(deps, "S20", { runId: "S20-20261101050000-abc123" })).run_id).toBe("S20-20261101050000-abc123");
    await expect(runScenario(deps, "S20", { runId: "../x" })).rejects.toThrow(/run id/);
  });

  it("retries a failure once, in the next clock hour with room, and reports only when the retry fails too", async () => {
    const flaky = setup([failing("no_ring_within_6s"), { outcome: "pass" }]);
    expect((await runScenario(flaky.deps, "S02")).status).toBe("pass");
    expect(flaky.attempts).toEqual([1, 2]);
    // Two dials at 05:00 leave one in that hour; the retry's two go at 06:01.
    expect(flaky.verdicts.all().map((v) => v.started_at)).toEqual(["2026-11-01T05:00:00.000Z", "2026-11-01T06:01:00.000Z"]);
    expect(flaky.reports()).toEqual([]);

    const broken = setup([failing("no_ring_within_6s"), failing("no_ring_within_6s")]);
    const summary = await runScenario(broken.deps, "S02");
    expect(summary.status).toBe("fail");
    expect(summary.report).toMatchObject({ sent: true });
    expect(broken.reports()).toHaveLength(1);
    expect(broken.event().fingerprint).toEqual(["synthetic", "S02", "no_ring_within_6s"]);
  });

  it("does not retry into an hour the registry has planned full, but into the next one with room", async () => {
    const { deps, verdicts, attempts } = setup([failing("no_ring_within_6s"), { outcome: "pass" }]);
    deps.runners = { ...deps.runners, S04: { id: "S04", run: async () => ({ outcome: "pass" }) } };
    expect((await runScenario(deps, "S02")).status).toBe("pass");
    expect(attempts).toEqual([1, 2]);
    // 06:00 holds S04's two dials, so S02's retry waits for 07:00.
    expect(verdicts.all().map((v) => v.started_at)).toEqual(["2026-11-01T05:00:00.000Z", "2026-11-01T07:01:00.000Z"]);
  });

  it("reports an infrastructure fault under its component", async () => {
    const { deps, event } = setup([
      { outcome: "infra", component: "robot", detail: "robotd down" },
      { outcome: "infra", component: "robot", detail: "robotd down" },
    ]);
    await runScenario(deps, "S02");
    expect(event().fingerprint).toEqual(["synthetic-infra", "robot"]);
  });

  it("reports the attempt that failed, not the retry the window stopped", async () => {
    // The previous run failed; this one fails at 09:40, and no hour of the
    // window is left for a retry with two dials in it.
    const { deps, verdicts, event } = setup([failing("no_ring_within_6s")], { at: Date.UTC(2026, 10, 1, 9, 40) });
    verdicts.record({
      run_id: "S02-earlier",
      scenario: "S02",
      sha: SHA,
      attempt: 2,
      outcome: "fail",
      failure_class: "no_ring_within_6s",
      started_at: "2026-10-30T05:10:00.000Z",
      finished_at: "",
      dials: 2,
      scheduled: true,
    });
    const summary = await runScenario(deps, "S02");
    expect(summary.verdicts.map((v) => v.outcome)).toEqual(["fail", "skipped"]);
    expect(event().fingerprint).toEqual(["synthetic", "S02", "no_ring_within_6s"]);
    expect(event().message.formatted).toBe("S02 failed: no_ring_within_6s");
    expect(verdicts.unresolved()[0]!.fingerprint).toEqual(event().fingerprint);
  });

  describe("late texts", () => {
    const texting = (body: string, result: ScenarioResult): ScenarioRunner => ({
      id: "S20",
      async run(ctx) {
        await ctx.app.sendText({ member: "qa-w-owner", fromRole: "DEV-W1", toRole: "ROBOT-1", body });
        return result;
      },
    });

    it("counts a failure as late_delivery only when this attempt's own text came back too late, and retries it", async () => {
      const { deps, reports, verdicts } = setup([]);
      deps.runners = { ...deps.runners, S20: texting("Rig S20 hello", failing("not_delivered")) };
      const late = new Set([textHash("Rig S20 hello")]);
      deps.lateDeliveries = ({ texts }) => [...texts].filter((hash) => late.has(hash)).length;
      const summary = await runScenario(deps, "S20");
      expect(summary.verdicts.map((v) => v.outcome)).toEqual(["late_delivery", "late_delivery"]);
      expect(summary.verdicts[0]!.detail).toMatch(/1 of this attempt's text\(s\) reached the API after Telnyx's signature window; not_delivered not counted/);
      expect(reports()).toEqual([]);
      expect(verdicts.unresolved()).toEqual([]);
    });

    it("never lets another text's lateness excuse a failure", async () => {
      const { deps, reports } = setup([]);
      deps.runners = { ...deps.runners, S20: texting("Rig S20 hello", failing("not_delivered")) };
      deps.lateDeliveries = ({ texts }) => (texts.has(textHash("someone else's text")) ? 1 : 0);
      expect((await runScenario(deps, "S20")).status).toBe("fail");
      expect(reports()).toHaveLength(1);
    });

    it("never excuses a call scenario that sent no text, whatever else arrived late", async () => {
      const { deps, reports } = setup([failing("member_did_not_hear_robot"), failing("member_did_not_hear_robot")]);
      deps.lateDeliveries = () => 5;
      expect((await runScenario(deps, "S02")).status).toBe("fail");
      expect(reports()).toHaveLength(1);
    });
  });

  it("does not retry a preempted run, and does not report it", async () => {
    const { deps, attempts, reports } = setup([{ outcome: "preempted", detail: "a production call arrived" }]);
    expect((await runScenario(deps, "S02")).status).toBe("preempted");
    expect(attempts).toEqual([1]);
    expect(reports()).toEqual([]);
  });

  it("starts no paid run outside the window, past the caps or below the room, and beats no heartbeat for it", async () => {
    const late = setup([], { at: Date.UTC(2026, 10, 1, 9, 50) });
    expect(await runScenario(late.deps, "S02")).toMatchObject({ status: "skipped", detail: "outside the dial window (04:00 UTC for 6 h)" });
    expect(late.requests).toEqual([]);
    expect(late.beats).toEqual([]);

    const tight = setup([], { room: 1 });
    expect((await runScenario(tight.deps, "S02")).status).toBe("not_runnable");

    // The guard counts clock hours: two dials at 05:10 fill the hour for a two-dial run at 05:50...
    const spent = setup([], { at: Date.UTC(2026, 10, 1, 5, 50) });
    spent.verdicts.record({
      run_id: "S01-x",
      scenario: "S01",
      sha: SHA,
      attempt: 1,
      outcome: "pass",
      started_at: new Date(Date.UTC(2026, 10, 1, 5, 10)).toISOString(),
      finished_at: "",
      dials: 2,
      scheduled: true,
    });
    expect(await runScenario(spent.deps, "S02")).toMatchObject({ status: "skipped", detail: "the hourly cap of 3 dials is spent" });
    // ...but not for one at 06:05.
    const next = setup([], { at: Date.UTC(2026, 10, 1, 6, 5) });
    next.verdicts.record({ ...spent.verdicts.all()[0]! });
    expect((await runScenario(next.deps, "S02")).status).toBe("pass");
  });

  it("waits for a busy lease, then skips the run", async () => {
    const busy = setup([], { acquire: () => json({ error: "guard_refused", rule: "lease.busy" }, 403, { [HEADER.refusedBy]: "lease.busy" }) });
    expect(await runScenario(busy.deps, "S02")).toMatchObject({ status: "skipped", detail: "another scenario held the lease for 20 min" });
    expect(busy.attempts).toEqual([]);
    expect(busy.requests.filter((r) => r.method === "POST").length).toBeGreaterThan(30);

    let calls = 0;
    const freed = setup([{ outcome: "pass" }], {
      acquire: () =>
        ++calls < 3
          ? json({ error: "guard_refused", rule: "lease.busy" }, 403, { [HEADER.refusedBy]: "lease.busy" })
          : json({ lease_id: "lease-late", scenario: "S02", expires_at: "x" }, 201),
    });
    expect((await runScenario(freed.deps, "S02")).status).toBe("pass");
  });

  it("reports a lease route that is down or turns the token away, instead of skipping forever", async () => {
    for (const status of [502, 401, 404]) {
      const { deps, reports, event } = setup([], { acquire: () => json({ error: "x" }, status) });
      const summary = await runScenario(deps, "S02");
      expect(summary.verdicts.map((v) => [v.outcome, v.component])).toEqual([
        ["infra", "lease"],
        ["infra", "lease"],
      ]);
      expect(reports()).toHaveLength(1);
      expect(event().fingerprint).toEqual(["synthetic-infra", "lease"]);
    }
    const refused = setup([], {
      acquire: () => json({ error: "guard_refused", rule: "class.not_allowed" }, 403, { [HEADER.refusedBy]: "class.not_allowed" }),
    });
    expect((await runScenario(refused.deps, "S02")).verdicts[0]).toMatchObject({ outcome: "infra", component: "guard" });
  });

  it("runs a text scenario at any hour, with a local lease and no guard", async () => {
    const { deps, requests } = setup([{ outcome: "pass" }], { at: Date.UTC(2026, 9, 31, 20, 0) });
    expect((await runScenario(deps, "S20")).status).toBe("pass");
    expect(requests).toEqual([]);
  });

  it("runs a scheduled paid run only on its registry day and once that day; a manual run always", async () => {
    const odd = setup([], { at: S02_DAY + 86_400_000 });
    expect((await runScenario(odd.deps, "S02", { scheduled: true })).status).toBe("not_due");
    expect((await runScenario(odd.deps, "S02")).status).toBe("pass");

    const { deps, clock } = setup([{ outcome: "pass" }, { outcome: "pass" }]);
    expect((await runScenario(deps, "S02", { scheduled: true })).status).toBe("pass");
    clock.advance(30 * 60_000);
    expect((await runScenario(deps, "S02", { scheduled: true })).status).toBe("not_due");
    clock.advance(2 * 86_400_000);
    expect((await runScenario(deps, "S02", { scheduled: true })).status).toBe("pass");
  });

  it("runs a daily text check once its day is nearly up", async () => {
    const { deps, clock } = setup([{ outcome: "pass" }, { outcome: "pass" }]);
    await runScenario(deps, "S20", { scheduled: true });
    clock.advance(21 * 60 * 60 * 1000);
    expect((await runScenario(deps, "S20", { scheduled: true })).status).toBe("not_due");
    clock.advance(60 * 60 * 1000);
    expect((await runScenario(deps, "S20", { scheduled: true })).status).toBe("pass");
  });

  it("turns a failed undo into an infrastructure verdict", async () => {
    const undoFails = setup([], {
      handlers: {
        "robot.sms": async () => {
          throw new Error("robotd is down");
        },
      },
    });
    undoFails.deps.runners = {
      ...undoFails.deps.runners,
      S02: {
        id: "S02",
        async run(ctx) {
          ctx.lease.registerUndo({ kind: "robot.sms", params: {} });
          return { outcome: "pass" };
        },
      },
    };
    expect(await runScenario(undoFails.deps, "S02")).toMatchObject({ status: "infra" });
    expect(undoFails.verdicts.all()[0]).toMatchObject({ component: "lease-undo" });
  });

  it("checks what the undos left even when the run failed, and reports a critical failure at once", async () => {
    const undone: string[] = [];
    const { deps, attempts, reports, event, verdicts } = setup([], {
      handlers: {
        "robot.sms": async (params) => {
          undone.push(String(params.text));
        },
      },
    });
    let checked = 0;
    deps.runners = {
      ...deps.runners,
      S02: {
        id: "S02",
        async run(ctx) {
          attempts.push(ctx.attempt);
          ctx.lease.registerUndo({ kind: "robot.sms", params: { text: "START" } });
          return failing("sent_after_stop");
        },
        async afterRelease() {
          checked++;
          return { outcome: "fail", failure_class: "stop_left_in_place", detail: "still opted out", critical: true };
        },
      },
    };
    const summary = await runScenario(deps, "S02");
    expect(undone).toEqual(["START"]);
    expect(checked).toBe(1);
    expect(attempts).toEqual([1]);
    expect(summary.verdicts).toMatchObject([{ outcome: "fail", failure_class: "stop_left_in_place", critical: true }]);
    expect(reports()).toHaveLength(1);
    expect(event()).toMatchObject({ fingerprint: ["synthetic", "S02", "stop_left_in_place"], level: "fatal" });
    expect(verdicts.unresolved()[0]!.fingerprint).toEqual(["synthetic", "S02", "stop_left_in_place"]);
  });

  it("keeps the run's own failure when the after-release check finds nothing left", async () => {
    const { deps } = setup([failing("sent_after_stop"), failing("sent_after_stop")]);
    let checked = 0;
    deps.runners = {
      ...deps.runners,
      S02: { ...deps.runners.S02!, afterRelease: async () => void checked++ },
    };
    const summary = await runScenario(deps, "S02");
    expect(checked).toBe(2);
    expect(summary.verdicts.map((v) => v.failure_class)).toEqual(["sent_after_stop", "sent_after_stop"]);
  });

  it("stops an attempt that runs past the lease, before the watchdog would reap it", async () => {
    const { deps } = setup([]);
    deps.runners = { ...deps.runners, S02: { id: "S02", run: () => new Promise(() => undefined) } };
    const running = runScenario(deps, "S02");
    for (let i = 0; i < 400; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      (deps.clock as ManualClock).advance(60_000);
    }
    expect(await running).toMatchObject({ status: "infra" });
  });

  it("refuses a scenario it does not know or cannot run", async () => {
    const { deps } = setup([]);
    await expect(runScenario(deps, "S99")).rejects.toThrow(/not in the scenario registry/);
    await expect(runScenario(deps, "S20", { slot: 3 })).rejects.toThrow(/no run 3/);
    deps.runners = {};
    await expect(runScenario(deps, "S02")).rejects.toThrow(/no runner/);
  });
});
