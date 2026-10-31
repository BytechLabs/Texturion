import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManualClock } from "@loonext/rig-robot/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { parseWindow } from "./budget.ts";
import { LeaseBusyError, LeaseClient, type UndoHandlers } from "./lease.ts";
import { validateRegistry } from "./registry.ts";
import { runScenario, type RunnerDeps } from "./runner.ts";
import type { ScenarioResult, ScenarioRunner } from "./scenarios/context.ts";
import { FakeApp, FakeBrowser, FakeRobot, FakeTime } from "./scenarios/fakes.ts";
import { parseDsn, SentryRelay } from "./sentry-relay.ts";
import { fakeFetch, json } from "./test-support.ts";
import { VerdictStore } from "./verdicts.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const EDGE = "https://rig-edge.example.workers.dev";
const DSN = parseDsn("https://key@o1.ingest.sentry.example/101");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const REGISTRY = validateRegistry([
  { id: "S02", frequency: "every-2-days", dials: 2, lane: "browser", room_min: 2, paid: true },
  { id: "S20", frequency: "daily", dials: 0, lane: "api", room_min: 0, paid: false },
]);

function setup(results: ScenarioResult[], options: { room?: number; at?: number; handlers?: UndoHandlers; busy?: boolean } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), "rig-runner-"));
  dirs.push(stateDir);
  const clock = new ManualClock(options.at ?? Date.UTC(2026, 9, 31, 5, 0, 0));
  const { fetch, requests } = fakeFetch({
    [`POST ${EDGE}/g/lease`]: () => (options.busy ? json({}, 409) : json({ lease_id: `lease-${requests.length}`, scenario: "S02", expires_at: "x" }, 201)),
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
  const deps: RunnerDeps = {
    registry: new Map(REGISTRY.map((e) => [e.id, e])),
    runners: { S02: runner("S02"), S20: runner("S20") },
    verdicts,
    leases,
    localLease: (scenario) => leases.acquireLocal(scenario),
    lanes: () => ({ robot: new FakeRobot(time), app: new FakeApp(time), browser: new FakeBrowser() }),
    relay: new SentryRelay({ statePath: join(stateDir, "relay.json"), alertDsn: DSN, fetch, clock }),
    syntheticDsn: DSN,
    sha: () => SHA,
    room: () => options.room ?? 4,
    window: parseWindow("04-10"),
    caps: { daily: 18, hourly: 3 },
    clock,
    sleep: async (ms) => clock.advance(ms),
  };
  const reports = () => requests.filter((r) => r.url === DSN.envelopeUrl);
  return { deps, verdicts, requests, attempts, clock, reports };
}

describe("runScenario", () => {
  it("records a pass with the SHA and the dials it spent, under a lease it releases", async () => {
    const { deps, verdicts, requests } = setup([{ outcome: "pass" }]);
    const summary = await runScenario(deps, "S02", { scheduled: true });
    expect(summary.status).toBe("pass");
    expect(verdicts.all()).toMatchObject([{ scenario: "S02", sha: SHA, attempt: 1, outcome: "pass", dials: 2, scheduled: true }]);
    expect(requests.map((r) => r.method)).toEqual(["POST", "DELETE"]);
    expect(verdicts.evidence(summary.run_id!)[0]).toMatchObject({ attempt: 1, sha: SHA, lease: { reaped: false } });
  });

  it("retries a failure once, and reports only when the retry fails too", async () => {
    const flaky = setup([{ outcome: "fail", failure_class: "no_ring_within_6s", detail: "x" }, { outcome: "pass" }]);
    expect((await runScenario(flaky.deps, "S02")).status).toBe("pass");
    expect(flaky.attempts).toEqual([1, 2]);
    expect(flaky.reports()).toEqual([]);

    const broken = setup([
      { outcome: "fail", failure_class: "no_ring_within_6s", detail: "x" },
      { outcome: "fail", failure_class: "no_ring_within_6s", detail: "x" },
    ]);
    const summary = await runScenario(broken.deps, "S02");
    expect(summary.status).toBe("fail");
    expect(summary.report).toMatchObject({ sent: true });
    expect(broken.reports()).toHaveLength(1);
    expect(broken.reports()[0]!.body).toContain('"fingerprint":["synthetic","S02","no_ring_within_6s"]');
  });

  it("reports an infrastructure fault under its component", async () => {
    const { deps, reports } = setup([
      { outcome: "infra", component: "robot", detail: "robotd down" },
      { outcome: "infra", component: "robot", detail: "robotd down" },
    ]);
    await runScenario(deps, "S02");
    expect(reports()[0]!.body).toContain('"fingerprint":["synthetic-infra","robot"]');
  });

  it("counts a failure during late text deliveries as late_delivery, not a failure to report", async () => {
    const { deps, attempts, reports, verdicts } = setup([{ outcome: "fail", failure_class: "not_threaded", detail: "x" }]);
    deps.lateDeliveries = () => 2;
    const summary = await runScenario(deps, "S20");
    expect(summary.status).toBe("late_delivery");
    expect(attempts).toEqual([1]);
    expect(reports()).toEqual([]);
    expect(verdicts.all()[0]!.detail).toMatch(/2 text\(s\) reached the API after Telnyx's signature window; not_threaded not counted/);
    expect(verdicts.unresolved()).toEqual([]);
  });

  it("does not retry a preempted run, and does not report it", async () => {
    const { deps, attempts, reports } = setup([{ outcome: "preempted", detail: "a production call arrived" }]);
    expect((await runScenario(deps, "S02")).status).toBe("preempted");
    expect(attempts).toEqual([1]);
    expect(reports()).toEqual([]);
  });

  it("starts no paid run outside the window, past the caps, below the room or under a busy lease", async () => {
    const late = setup([], { at: Date.UTC(2026, 9, 31, 9, 50) });
    expect(await runScenario(late.deps, "S02")).toMatchObject({ status: "skipped", detail: "outside the dial window" });
    expect(late.requests).toEqual([]);

    const tight = setup([], { room: 1 });
    expect((await runScenario(tight.deps, "S02")).status).toBe("not_runnable");

    const busy = setup([], { busy: true });
    expect(await runScenario(busy.deps, "S02")).toMatchObject({ status: "skipped", detail: "another scenario holds the lease" });
    expect(busy.attempts).toEqual([]);

    const spent = setup([]);
    for (let hour = 0; hour < 1; hour++) {
      spent.verdicts.record({
        run_id: "S01-x",
        scenario: "S01",
        sha: SHA,
        attempt: 1,
        outcome: "pass",
        started_at: new Date(Date.UTC(2026, 9, 31, 4, 50)).toISOString(),
        finished_at: "",
        dials: 2,
        scheduled: true,
      });
    }
    expect(await runScenario(spent.deps, "S02")).toMatchObject({ status: "skipped", detail: "the hourly cap of 3 dials is spent" });
  });

  it("runs a text scenario at any hour, with a local lease and no guard", async () => {
    const { deps, requests } = setup([{ outcome: "pass" }], { at: Date.UTC(2026, 9, 31, 20, 0) });
    expect((await runScenario(deps, "S20")).status).toBe("pass");
    expect(requests).toEqual([]);
  });

  it("skips a scheduled run that is not due yet, but never a manual one", async () => {
    const { deps, clock } = setup([{ outcome: "pass" }, { outcome: "pass" }]);
    await runScenario(deps, "S02", { scheduled: true });
    clock.advance(24 * 60 * 60 * 1000 - 60 * 60 * 1000);
    expect((await runScenario(deps, "S02", { scheduled: true })).status).toBe("not_due");
    expect((await runScenario(deps, "S02")).status).toBe("pass");
  });

  it("turns a failed undo into an infrastructure verdict, and the after-release check into the result", async () => {
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

    const after = setup([]);
    after.deps.runners = {
      ...after.deps.runners,
      S02: {
        id: "S02",
        run: async () => ({ outcome: "pass" }),
        afterRelease: async () => ({ outcome: "fail", failure_class: "stop_left_in_place", detail: "still opted out" }),
      },
    };
    const summary = await runScenario(after.deps, "S02");
    expect(summary.verdicts.map((v) => v.failure_class)).toEqual(["stop_left_in_place", "stop_left_in_place"]);
  });

  it("stops an attempt that runs past the lease, before the watchdog would reap it", async () => {
    const { deps } = setup([]);
    deps.runners = { ...deps.runners, S02: { id: "S02", run: () => new Promise(() => undefined) } };
    const running = runScenario(deps, "S02");
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      (deps.clock as ManualClock).advance(60_000);
    }
    expect(await running).toMatchObject({ status: "infra" });
  });

  it("refuses a scenario it does not know or cannot run", async () => {
    const { deps } = setup([]);
    await expect(runScenario(deps, "S99")).rejects.toThrow(/not in the scenario registry/);
    deps.runners = {};
    await expect(runScenario(deps, "S02")).rejects.toThrow(/no runner/);
  });

  it("treats a busy lease as a skip, not a failure", () => {
    expect(new LeaseBusyError().message).toMatch(/held by another scenario/);
  });
});
