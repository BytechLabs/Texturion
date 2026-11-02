import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HEADER } from "@loonext/rig-protocol";
import { ManualClock } from "@loonext/rig-robot/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { dialsInLog, parseWindow } from "./budget.ts";
import { textHash } from "./late.ts";
import { LeaseClient, type UndoHandlers } from "./lease.ts";
import { chargedDials, runScenario, type RunnerDeps } from "./runner.ts";
import type { ScenarioResult, ScenarioRunner } from "./scenarios/context.ts";
import { fakeLanes, FakeTime } from "./scenarios/fakes.ts";
import { parseDsn, SentryRelay } from "./sentry-relay.ts";
import { LaneHoldFile } from "./state-files.ts";
import { fakeFetch, json } from "./test-support.ts";
import { registryOf, scenario } from "./test-registry.ts";
import { VerdictStore } from "./verdicts.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const EDGE = "https://rig-edge.example.workers.dev";
const DSN = parseDsn("https://key@o1.ingest.sentry.example/101");
/** 1 November 2026, 05:00 UTC: inside the dial window. */
const S02_DAY = Date.UTC(2026, 10, 1, 5, 0, 0);
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const REGISTRY = registryOf([
  scenario("S02", {
    lane: "browser",
    dials: 1,
    far_end_legs: 1,
    min_room: 2,
  }),
  scenario("S20"),
  scenario("S29"),
  scenario("D02p", { lane: "device" }),
  scenario("E01", { lane: "emulator" }),
  scenario("S04", {
    lane: "browser",
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
  const deps: RunnerDeps = {
    registry: REGISTRY,
    runners: { S02: runner("S02"), S20: runner("S20"), S29: runner("S29") },
    verdicts,
    leases,
    localLease: (scenario) => leases.acquireLocal(scenario),
    lanes: () => fakeLanes(time),
    relay: new SentryRelay({ statePath: join(stateDir, "relay.json"), alertDsn: DSN, fetch, clock }),
    syntheticDsn: DSN,
    sha: () => SHA,
    room: () => options.room ?? 4,
    dialWindow: async () => parseWindow("04-10"),
    caps: { daily: 18, hourly: 3 },
    clock,
    sleep: async (ms) => clock.advance(ms),
  };
  const reports = () => requests.filter((r) => r.url === DSN.envelopeUrl);
  const event = (index = 0) => JSON.parse(reports()[index]!.body!.split("\n")[2]!) as { fingerprint: string[]; message: { formatted: string }; level: string };
  return { deps, verdicts, requests, attempts, clock, reports, event };
}

const failing = (failure_class: string): ScenarioResult => ({ outcome: "fail", failure_class, detail: "x" });

describe("runScenario", () => {
  it("records a pass with the SHA and the dials it spent, under a lease it releases", async () => {
    const { deps, verdicts, requests } = setup([{ outcome: "pass" }]);
    const summary = await runScenario(deps, "S02");
    expect(summary.status).toBe("pass");
    expect(verdicts.all()).toMatchObject([{ scenario: "S02", sha: SHA, attempt: 1, outcome: "pass", dials: 2 }]);
    expect(requests.map((r) => r.method)).toEqual(["POST", "DELETE"]);
    expect(verdicts.evidence(summary.run_id!)[0]).toMatchObject({ attempt: 1, sha: SHA, lease: { reaped: false } });
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

  it("starts no paid run outside the window, past the caps or below the room", async () => {
    const late = setup([], { at: Date.UTC(2026, 10, 1, 9, 50) });
    expect(await runScenario(late.deps, "S02")).toMatchObject({ status: "skipped", detail: "outside the dial window (04:00 UTC for 6 h)" });
    expect(late.requests).toEqual([]);

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

  it("holds the guard's lease for a scenario that dials nothing when its runner asks, at any hour, spending no dials", async () => {
    const { deps, requests } = setup([], { at: Date.UTC(2026, 9, 31, 20, 0) });
    const leases: string[] = [];
    deps.runners = { ...deps.runners, S20: { id: "S20", guardLease: true, run: async (ctx) => (leases.push(ctx.lease.id), { outcome: "pass" }) } };
    const summary = await runScenario(deps, "S20");
    expect(summary.status).toBe("pass");
    expect(summary.verdicts[0]).toMatchObject({ dials: 0 });
    const asked = requests.filter((r) => r.method === "POST" && r.url === `${EDGE}/g/lease`);
    expect(asked.map((r) => JSON.parse(r.body!))).toEqual([{ scenario: "S20", dials: false }]);
    expect(leases[0]).toMatch(/^lease-/);

    let calls = 0;
    const waited = setup([], {
      at: Date.UTC(2026, 9, 31, 20, 0),
      acquire: () =>
        ++calls < 3
          ? json({ error: "guard_refused", rule: "lease.busy" }, 403, { [HEADER.refusedBy]: "lease.busy" })
          : json({ lease_id: "lease-late", scenario: "S20", expires_at: "x" }, 201),
    });
    waited.deps.runners = { ...waited.deps.runners, S20: { id: "S20", guardLease: true, run: async () => ({ outcome: "pass" }) } };
    expect((await runScenario(waited.deps, "S20")).status).toBe("pass");
  });

  it("hands a runner its own earlier attempts, newest first, with the evidence each saved", async () => {
    const { deps, clock } = setup([]);
    const seen: unknown[] = [];
    let run = 0;
    deps.runners = {
      ...deps.runners,
      S20: {
        id: "S20",
        async run(ctx) {
          seen.push(await ctx.history.attempts({ since: clock.now() - 7 * 86_400_000 }));
          ctx.evidence.audio = { heard: ++run === 1 };
          return run === 1 ? { outcome: "pass" } : { outcome: "fail", failure_class: "deaf", detail: "x" };
        },
      },
    };
    await runScenario(deps, "S20");
    clock.advance(3_600_000);
    await runScenario(deps, "S20");
    await runScenario(deps, "S02");
    clock.advance(3_600_000);
    await runScenario(deps, "S20");
    expect(seen[0]).toEqual([]);
    expect(seen[1]).toEqual([expect.objectContaining({ attempt: 1, outcome: "pass", evidence: expect.objectContaining({ attempt: 1, audio: { heard: true } }) })]);
    const third = seen[3] as { outcome: string; attempt: number; evidence: { audio?: unknown } }[];
    expect(third.map((a) => [a.outcome, a.attempt])).toEqual([
      ["fail", 2],
      ["fail", 1],
      ["pass", 1],
    ]);
    expect(third[0]!.evidence.audio).toEqual({ heard: false });
  });

  it("runs when asked, on any day and as often as asked: no cadence decides whether it is due", async () => {
    const { deps, verdicts } = setup([{ outcome: "pass" }, { outcome: "pass" }, { outcome: "pass" }], { at: S02_DAY + 86_400_000 });
    expect((await runScenario(deps, "S02")).status).toBe("pass");
    expect((await runScenario(deps, "S20")).status).toBe("pass");
    expect((await runScenario(deps, "S20")).status).toBe("pass");
    expect(verdicts.all().map((v) => v.scenario)).toEqual(["S02", "S20", "S20"]);
  });

  it("prepares before the lease, and ends the attempt there when preparing says so", async () => {
    const { deps, requests, verdicts } = setup([]);
    const seen: { slot: unknown; lease: string }[] = [];
    deps.runners = {
      ...deps.runners,
      S02: {
        id: "S02",
        async prepare(ctx) {
          seen.push({ slot: ctx.slot, lease: ctx.lease.id });
          expect(() => ctx.lease.registerUndo({ kind: "robot.sms", params: {} })).toThrow(/before the lease/);
          return { outcome: "infra", component: "device", detail: "never reached deep idle" };
        },
        async run() {
          throw new Error("run must not start");
        },
      },
    };
    const summary = await runScenario(deps, "S02");
    expect(summary.verdicts.map((v) => [v.outcome, v.component, v.dials])).toEqual([
      ["infra", "device", 0],
      ["infra", "device", 0],
    ]);
    expect(seen[0]).toEqual({ slot: { index: 0 }, lease: "" });
    expect(requests.filter((r) => r.url.includes("/g/lease"))).toEqual([]);
    expect(verdicts.all()).toHaveLength(2);

    const ready = setup([{ outcome: "pass" }]);
    let leased = "";
    ready.deps.runners = {
      ...ready.deps.runners,
      S02: { id: "S02", prepare: async () => undefined, run: async (ctx) => ((leased = ctx.lease.id), { outcome: "pass" }) },
    };
    expect((await runScenario(ready.deps, "S02")).status).toBe("pass");
    expect(leased).toMatch(/^lease-/);
  });

  it("holds a preparing run's lane, so no other run uses that device under it, and frees it when the attempt ends", async () => {
    const { deps, clock } = setup([]);
    const dir = mkdtempSync(join(tmpdir(), "rig-holds-"));
    dirs.push(dir);
    deps.holds = new LaneHoldFile(dir);
    deps.caps = { daily: 100, hourly: 100 };
    const during: { s04: unknown; ownView: string | undefined }[] = [];
    let ran = 0;
    deps.runners = {
      ...deps.runners,
      S04: { id: "S04", run: async () => (ran++, { outcome: "pass" }) },
      S02: {
        id: "S02",
        async prepare(ctx) {
          const s04 = await runScenario(deps, "S04");
          during.push({ s04: { status: s04.status, detail: s04.detail }, ownView: ctx.laneHeldBy("browser") });
          clock.advance(60 * 60_000);
          return undefined;
        },
        run: async () => ({ outcome: "pass" }),
      },
    };
    expect((await runScenario(deps, "S02")).status).toBe("pass");
    // The holder sees no hold on its own lane.
    expect(during[0]).toEqual({ s04: { status: "skipped", detail: "S02 held the browser lane for 20 min while it prepared" }, ownView: undefined });
    expect(ran).toBe(0);
    expect(deps.holds.holder("browser", clock.now())).toBeUndefined();
    expect((await runScenario(deps, "S04")).status).toBe("pass");
    expect(ran).toBe(1);

    // A run that is waiting starts once the hold is gone, and a hold a dead run left lapses by itself.
    deps.holds.claim("browser", { scenario: "S02", run_id: "S02-dead" }, clock.now() + 5 * 60_000);
    const started = clock.now();
    expect((await runScenario(deps, "S04")).status).toBe("pass");
    expect(clock.now() - started).toBeGreaterThanOrEqual(5 * 60_000);
    expect(ran).toBe(2);
  });

  it("puts back what a finished prepare changed when its run never starts, and only then", async () => {
    const abandoned: string[] = [];
    const preparing = (prepared: ScenarioResult | undefined): ScenarioRunner => ({
      id: "S02",
      prepare: async () => prepared,
      abandon: async (ctx) => void abandoned.push(ctx.runId),
      run: async () => ({ outcome: "pass" }),
    });

    const busy = setup([], { acquire: () => json({ error: "guard_refused", rule: "lease.busy" }, 403, { [HEADER.refusedBy]: "lease.busy" }) });
    busy.deps.runners = { ...busy.deps.runners, S02: preparing(undefined) };
    expect((await runScenario(busy.deps, "S02")).status).toBe("skipped");
    expect(abandoned).toHaveLength(1);

    const refused = setup([], { acquire: () => json({ error: "guard_refused", rule: "class.not_allowed" }, 403, { [HEADER.refusedBy]: "class.not_allowed" }) });
    refused.deps.runners = { ...refused.deps.runners, S02: preparing(undefined) };
    expect((await runScenario(refused.deps, "S02")).verdicts.map((v) => v.outcome)).toEqual(["infra", "infra"]);
    expect(abandoned).toHaveLength(3);

    const closing = setup([], { at: Date.UTC(2026, 10, 1, 9, 0) });
    closing.deps.runners = {
      ...closing.deps.runners,
      S02: { ...preparing(undefined), prepare: async () => void closing.clock.advance(50 * 60_000) },
    };
    expect(await runScenario(closing.deps, "S02")).toMatchObject({ status: "skipped", detail: "the dial window closed while the run prepared" });
    expect(abandoned).toHaveLength(4);

    // A prepare that failed put its own change back; a run that started has its lease's undos.
    const failed = setup([]);
    failed.deps.runners = { ...failed.deps.runners, S02: preparing({ outcome: "infra", component: "pixel", detail: "never reached deep idle" }) };
    await runScenario(failed.deps, "S02");
    const started = setup([]);
    started.deps.runners = { ...started.deps.runners, S02: preparing(undefined) };
    expect((await runScenario(started.deps, "S02")).status).toBe("pass");
    expect(abandoned).toHaveLength(4);
  });

  it("puts back what a prepare changed when it threw, or ran past its limit, once it has stopped", async () => {
    const abandoned: string[] = [];
    const threw = setup([]);
    threw.deps.runners = {
      ...threw.deps.runners,
      S02: {
        id: "S02",
        prepare: async () => {
          throw new Error("adb dropped");
        },
        abandon: async () => void abandoned.push("threw"),
        run: async () => ({ outcome: "pass" }),
      },
    };
    expect((await runScenario(threw.deps, "S02")).verdicts[0]).toMatchObject({ outcome: "infra", detail: "adb dropped" });
    expect(abandoned).toEqual(["threw", "threw"]);

    const slow = setup([]);
    const events: string[] = [];
    let finishPrepare: () => void = () => undefined;
    slow.deps.runners = {
      ...slow.deps.runners,
      S02: {
        id: "S02",
        prepare: () =>
          events.length > 0
            ? Promise.resolve(undefined)
            : new Promise<undefined>((resolve) => {
                finishPrepare = () => (events.push("prepare done"), resolve(undefined));
              }),
        abandon: async () => void events.push("abandon"),
        run: async () => ({ outcome: "pass" }),
      },
    };
    slow.deps.holds = {
      holder: () => undefined,
      claim: () => undefined,
      release: () => void events.push("hold released"),
    };
    const running = runScenario(slow.deps, "S02");
    await new Promise((resolve) => setImmediate(resolve));
    slow.clock.advance(2 * 60 * 60_000);
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual([]);
    finishPrepare();
    const summary = await running;
    expect(summary.verdicts[0]).toMatchObject({ outcome: "infra", detail: "the attempt ran past 120 minutes" });
    expect(events).toEqual(["prepare done", "abandon", "hold released", "hold released"]);
  });

  it("starts nothing while a deploy holds the rig for a schema change", async () => {
    const { deps, attempts } = setup([]);
    deps.deployHold = () => "a deploy holds the rig for a schema change";
    const summary = await runScenario(deps, "S02");
    expect(summary.verdicts.map((v) => [v.outcome, v.detail])).toEqual([["skipped", "a deploy holds the rig for a schema change"]]);
    expect(attempts).toEqual([]);
  });

  it("tells a runner which rig scenarios a room would block, as its own admission blocks them", async () => {
    const { deps } = setup([]);
    const blocked: Record<number, string[]> = {};
    deps.runners = {
      ...deps.runners,
      S20: { id: "S20", run: async (ctx) => (Object.assign(blocked, { 1: ctx.blockedAt(1), 4: ctx.blockedAt(4) }), { outcome: "pass" }) },
    };
    await runScenario(deps, "S20");
    expect(blocked).toEqual({ 1: ["S02", "S04"], 4: [] });
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

describe("the dials an attempt is charged", () => {
  const infra: ScenarioResult = { outcome: "infra", component: "android-dialer", detail: "the dialer's keypad is not on screen" };

  /** S02 runs `body` on each attempt, against lanes whose guard log is `log`. */
  function withLog(log: Record<string, number> | Error, body: (ctx: Parameters<ScenarioRunner["run"]>[0]) => Promise<ScenarioResult>) {
    const made = setup([]);
    const time = new FakeTime();
    made.deps.lanes = () => {
      const lanes = fakeLanes(time);
      if (log instanceof Error) {
        lanes.guard.activity = async () => {
          throw log;
        };
      } else lanes.guard.log = { ...log };
      return lanes;
    };
    made.deps.runners = { ...made.deps.runners, S02: { id: "S02", run: body } };
    return made;
  }

  it("charges nothing for an attempt that ended as a rig fault before any dial, so it does not use the hour's cap", async () => {
    const { deps, verdicts } = withLog({}, async () => infra);
    const summary = await runScenario(deps, "S02");
    expect(summary.verdicts.map((v) => [v.outcome, v.dials])).toEqual([
      ["infra", 0],
      ["infra", 0],
    ]);
    // Four attempts used to fill the hour's 3; none now has.
    expect(verdicts.dialsBetween(S02_DAY, S02_DAY + 3_600_000)).toBe(0);
    expect((await runScenario(deps, "S02")).verdicts.every((v) => v.detail !== "the hourly cap of 3 dials is spent")).toBe(true);
  });

  it("charges the dials the guard's log shows reached Telnyx, and only those", async () => {
    const { deps } = withLog({ "robot POST /v2/calls 200": 1, "rig-api GET /v2/calls/:id 200": 4 }, async () => infra);
    expect((await runScenario(deps, "S02")).verdicts.map((v) => v.dials)).toEqual([1, 1]);
  });

  it("does not count a dial the guard or Telnyx refused", async () => {
    const { deps } = withLog(
      { "robot POST /v2/calls dial.to_not_owned": 1, "robot POST /v2/calls 422": 1, "robot POST /v2/calls budget.dials_hour": 1 },
      async () => infra,
    );
    expect((await runScenario(deps, "S02")).verdicts.map((v) => v.dials)).toEqual([0, 0]);
  });

  it("never charges more than the scenario's own dials", async () => {
    const { deps } = withLog({ "robot POST /v2/calls 200": 7 }, async () => infra);
    expect((await runScenario(deps, "S02")).verdicts.map((v) => v.dials)).toEqual([2, 2]);
  });

  it("charges a run that was judged its full dials, whatever the log shows", async () => {
    const passing = withLog({}, async () => ({ outcome: "pass" }));
    expect((await runScenario(passing.deps, "S02")).verdicts.map((v) => v.dials)).toEqual([2]);
    const failed = withLog({}, async () => failing("no_ring_within_6s"));
    expect((await runScenario(failed.deps, "S02")).verdicts.map((v) => [v.outcome, v.dials])).toEqual([
      ["fail", 2],
      ["fail", 2],
    ]);
  });

  it("charges in full a run in which an app pressed Call, since an app's dial does not pass the guard", async () => {
    const { deps } = withLog({}, async (ctx) => {
      await ctx.devices.pixel().dial("ROBOT-1");
      return infra;
    });
    expect((await runScenario(deps, "S02")).verdicts.map((v) => v.dials)).toEqual([2, 2]);

    const browser = withLog({}, async (ctx) => {
      await (await ctx.browser.open("qa-w-owner", "qa-w-owner", "/calls")).dial("ROBOT-1");
      return infra;
    });
    expect((await runScenario(browser.deps, "S02")).verdicts.map((v) => v.dials)).toEqual([2, 2]);
  });

  it("charges nothing for a dial that failed before it was placed", async () => {
    const { deps } = withLog({}, async (ctx) => {
      const pixel = ctx.devices.pixel();
      pixel.dial = async () => {
        throw new Error("rig: the app's calls screen offered no dialer");
      };
      await pixel.dial("ROBOT-1").catch(() => undefined);
      return infra;
    });
    expect((await runScenario(deps, "S02")).verdicts.map((v) => v.dials)).toEqual([0, 0]);
  });

  it("falls back to the attempt's own dials when the log cannot be read", async () => {
    const none = withLog(new Error("lease.not_found"), async () => infra);
    expect((await runScenario(none.deps, "S02")).verdicts.map((v) => v.dials)).toEqual([0, 0]);
    const dialed = withLog(new Error("lease.not_found"), async (ctx) => {
      await ctx.robot.dial({} as never);
      return infra;
    });
    expect((await runScenario(dialed.deps, "S02")).verdicts.map((v) => v.dials)).toEqual([2, 2]);
  });
});

describe("dialsInLog", () => {
  it("counts the dials and transfers that reached Telnyx, by status or an unknown answer", () => {
    expect(
      dialsInLog({
        "robot POST /v2/calls 200": 2,
        "rig-api POST /v2/calls 201": 1,
        "rig-api POST /v2/calls 503": 1,
        "robot POST /v2/calls error": 1,
        "rig-api POST /v2/calls/:id/actions/transfer 200": 1,
      }),
    ).toBe(6);
  });

  it("leaves out what the guard or Telnyx refused, and requests that place no leg", () => {
    expect(
      dialsInLog({
        "robot POST /v2/calls 422": 1,
        "robot POST /v2/calls 429": 1,
        "robot POST /v2/calls dial.from_not_owned": 1,
        "robot POST /v2/calls budget.dials_day": 1,
        "robot POST /v2/calls/:id/actions/answer 200": 3,
        "robot POST /v2/calls/:id/actions/bridge 200": 1,
        "rig-api GET /v2/calls 200": 2,
        "rig-api POST /v2/messages 200": 1,
      }),
    ).toBe(0);
  });
});

describe("chargedDials", () => {
  const base = { full: 2, judged: false, inLog: undefined as number | undefined, byApp: 0, byRobot: 0 };

  it("is the scenario's dials for a judged run or one with an app's dial, nothing for a scenario that dials nothing", () => {
    expect(chargedDials({ ...base, judged: true })).toBe(2);
    expect(chargedDials({ ...base, byApp: 1, inLog: 0 })).toBe(2);
    expect(chargedDials({ ...base, full: 0, judged: true })).toBe(0);
  });

  it("is the log's count, capped at the scenario's dials, otherwise", () => {
    expect(chargedDials({ ...base, inLog: 0 })).toBe(0);
    expect(chargedDials({ ...base, inLog: 1 })).toBe(1);
    expect(chargedDials({ ...base, inLog: 9 })).toBe(2);
  });

  it("without the log, is nothing before the robot's first dial and everything after", () => {
    expect(chargedDials(base)).toBe(0);
    expect(chargedDials({ ...base, byRobot: 1 })).toBe(2);
  });
});

describe("a device scenario's start", () => {
  /** A runner for `id` that notes what the devices had been told when each step began. */
  function onDevices(id: string) {
    const lanes = fakeLanes(new FakeTime());
    const order: string[] = [];
    const made = setup([]);
    made.deps.lanes = () => lanes;
    made.deps.runners = {
      ...made.deps.runners,
      [id]: {
        id,
        async prepare() {
          order.push(`prepare after [${lanes.devices.pixelDevice.actions}]`);
          return undefined;
        },
        async run() {
          order.push(`run after [${lanes.devices.pixelDevice.actions}]`);
          return { outcome: "pass" };
        },
      },
    };
    return { ...made, lanes, order };
  }

  it("resets the device lane's app before the scenario's own setup, so it does not inherit the last run's UI", async () => {
    const { deps, order } = onDevices("D02p");
    expect((await runScenario(deps, "D02p")).status).toBe("pass");
    expect(order).toEqual(["prepare after [reset ui]", "run after [reset ui]"]);
  });

  it("resets it again for the retry", async () => {
    const { deps, lanes } = onDevices("D02p");
    deps.runners = { D02p: { id: "D02p", run: async () => failing("no_ring_within_12s") } };
    await runScenario(deps, "D02p");
    expect(lanes.devices.pixelDevice.actions).toEqual(["reset ui", "reset ui"]);
  });

  it("resets each booted emulator of the emulator lane, and none that is down", async () => {
    const { deps, lanes } = onDevices("E01");
    lanes.devices.emulator(35).reachableNow = false;
    await runScenario(deps, "E01");
    expect(lanes.devices.emulator(34).actions).toEqual(["reset ui"]);
    expect(lanes.devices.emulator(35).actions).toEqual([]);
    expect(lanes.devices.emulator(36).actions).toEqual(["reset ui"]);
    expect(lanes.devices.pixelDevice.actions).toEqual([]);
  });

  it("leaves a device that is not up to the scenario, which reports it", async () => {
    const { deps, lanes, order } = onDevices("D02p");
    lanes.devices.pixelDevice.reachableNow = false;
    expect((await runScenario(deps, "D02p")).status).toBe("pass");
    expect(lanes.devices.pixelDevice.actions).toEqual([]);
    expect(order).toEqual(["prepare after []", "run after []"]);
  });

  it("touches no device for a scenario on another lane", async () => {
    const { deps, lanes } = onDevices("S20");
    await runScenario(deps, "S20");
    expect(lanes.devices.pixelDevice.actions).toEqual([]);
  });

  it("does not reset a device another run holds while it prepares", async () => {
    const { deps, lanes } = onDevices("D02p");
    deps.holds = {
      holder: () => ({ scenario: "D04", run_id: "D04-other" }),
      claim: () => undefined,
      release: () => undefined,
    };
    const summary = await runScenario(deps, "D02p");
    expect(lanes.devices.pixelDevice.actions).toEqual([]);
    expect(summary.verdicts[0]!.outcome).toBe("skipped");
  });

  it("reports a reset that fails as the device's fault, spends nothing and runs nothing", async () => {
    const { deps, lanes, order } = onDevices("D02p");
    lanes.devices.pixelDevice.resetUi = async () => {
      throw new Error("adb: device offline");
    };
    const summary = await runScenario(deps, "D02p");
    expect(summary.verdicts.map((v) => [v.outcome, v.component, v.dials])).toEqual([
      ["infra", "pixel", 0],
      ["infra", "pixel", 0],
    ]);
    expect(summary.detail).toBe("resetting the app's UI failed: adb: device offline");
    expect(order).toEqual([]);
  });
});
