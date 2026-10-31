import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blockedByRoom, dialBudget, inWindow, parseWindow, plannedRuns, slotDueOn, windowDay, windowHours } from "./budget.ts";
import { installSchedule } from "./install.ts";
import { loadRegistry, notOnRigBecause, periodMinutes, validateRegistry } from "./registry.ts";
import { buildSchedule, parseInstance } from "./schedule.ts";
import { rawRegistry, registryOf, SAMPLE, scenario } from "./test-registry.ts";
import { VerdictStore, type Verdict } from "./verdicts.ts";

const REAL_REGISTRY = resolve(fileURLToPath(import.meta.url), "../../../scenarios.json");

describe("validateRegistry", () => {
  it("reads tools/rig/scenarios.json's own shape", () => {
    const registry = registryOf(SAMPLE);
    expect(registry.budget).toEqual({
      daily: 18,
      hourly: 3,
      daysPerMonth: 30,
      retryReserve: 0.2,
      reproReserveDials: 60,
      window: { startHour: 4, hours: 6 },
    });
    expect(registry.byId.get("S02")).toMatchObject({
      dials: 1,
      far_end_legs: 1,
      room_min: 2,
      paid: true,
      runs: [{ index: 0, every: "2d", everyMinutes: 2880, offsetDays: 0, hourUtc: 5 }],
    });
    expect(registry.byId.get("G01")).toMatchObject({ dials: 0, far_end_legs: 1, paid: true });
    expect(registry.byId.get("S25")!.runs.map((run) => run.label)).toEqual(["daytime", "night"]);
    expect(notOnRigBecause(registry.byId.get("H01")!)).toBe("runs on ci, not on the rig");
    expect(notOnRigBecause(registry.byId.get("S07")!)).toBe("unscheduled: hourly-cap");
    expect(notOnRigBecause(registry.byId.get("S20")!)).toBeUndefined();
  });

  it.skipIf(!existsSync(REAL_REGISTRY))("loads the registry in the checkout", () => {
    const registry = loadRegistry(REAL_REGISTRY);
    expect(registry.scenarios.length).toBeGreaterThan(40);
    expect(dialBudget(registry).fits).toBe(true);
  });

  it("lists every problem at once", () => {
    let message = "";
    try {
      validateRegistry(
        rawRegistry([
          scenario("s2"),
          scenario("S03", { dials: -1 }),
          scenario("S04", { scheduled: "yes" }),
          { id: "S05" },
          scenario("S06", { runs: [{ every: "now and then" }] }),
          scenario("S08", { dials: 1, runs: [{ every: "6h" }] }),
          scenario("S09", { dials: 1, runs: [{ every: "1d", offset_days: 0, hour_utc: 12 }] }),
          scenario("S10", { dials: 1, runs: [{ every: "3d", offset_days: 3, hour_utc: 5 }] }),
          scenario("S11", { runs_on: "laptop" }),
          scenario("S12"),
          scenario("S12"),
        ]),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/\(s2\): id must be a scenario id/);
    expect(message).toMatch(/\(S03\): dials must be a whole number/);
    expect(message).toMatch(/\(S04\): scheduled must be true or false/);
    expect(message).toMatch(/\(S05\): lane must be/);
    expect(message).toMatch(/\(S06\) runs\[0\]: every "now and then" is not a period/);
    expect(message).toMatch(/\(S08\) runs\[0\]: a run with dials must recur in whole days, not 6h/);
    expect(message).toMatch(/\(S09\) runs\[0\]: hour_utc must be an hour inside the dial window/);
    expect(message).toMatch(/\(S10\) runs\[0\]: offset_days must be 0 to 2/);
    expect(message).toMatch(/\(S11\): runs_on must be rig, ci, production, workstation/);
    expect(message).toMatch(/\(S12\): id repeats an earlier entry/);
  });

  it("refuses the old array shape, another schema and a broken budget", () => {
    expect(() => validateRegistry([scenario("S20")])).toThrow(/loonext\.rig-scenarios\.v1 object/);
    expect(() => validateRegistry({ ...rawRegistry([]), schema: "v0" })).toThrow(/schema must be/);
    expect(() => validateRegistry(rawRegistry([], { window_utc: [10, 10] }))).toThrow(/window_utc/);
    expect(() => validateRegistry(rawRegistry([], { daily_cap: 0 }))).toThrow(/daily_cap/);
    const dir = mkdtempSync(join(tmpdir(), "rig-registry-"));
    try {
      writeFileSync(join(dir, "scenarios.json"), "[ not json");
      expect(() => loadRegistry(join(dir, "scenarios.json"))).toThrow(/scenarios\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads periods as the registry check does", () => {
    expect([periodMinutes("15m"), periodMinutes("6h"), periodMinutes("3d"), periodMinutes("push")]).toEqual([15, 360, 4320, 0]);
    expect(periodMinutes("weekly")).toBeUndefined();
    expect(periodMinutes("0d")).toBeUndefined();
  });
});

describe("the dial budget", () => {
  it("adds the registry's reserves to every scheduled run's dials, and compares with its cap", () => {
    const report = dialBudget(registryOf(SAMPLE));
    // S01 10 runs x2, S02 15 x2, S04 10 x2, S24 30/7 x2, G01 30 x1; S07 is unscheduled.
    expect(report.scheduledDials).toBeCloseTo(20 + 30 + 20 + 8.57 + 30, 2);
    expect(report.retryReserve).toBeCloseTo(21.71, 2);
    expect(report.total).toBeCloseTo(108.57 + 21.71 + 60, 2);
    expect(report.monthlyCap).toBe(540);
    expect(report.fits).toBe(true);
    expect(dialBudget(registryOf(SAMPLE, { daily_cap: 6 })).fits).toBe(false);
  });

  it("keeps paid calls off below a room of 2, and under a scenario's own minimum", () => {
    const registry = registryOf(SAMPLE);
    const g01 = registry.byId.get("G01")!;
    expect(blockedByRoom(g01, 1)).toBe(true);
    expect(blockedByRoom(g01, 2)).toBe(true);
    expect(blockedByRoom(g01, 3)).toBe(false);
    expect(blockedByRoom(registry.byId.get("S20")!, 0)).toBe(false);
  });

  it("reads the window in UTC, wrapping midnight", () => {
    expect(windowHours(parseWindow("04-10"))).toEqual([4, 5, 6, 7, 8, 9]);
    expect(windowHours(parseWindow("22-02"))).toEqual([22, 23, 0, 1]);
    expect(inWindow(parseWindow("04-10"), Date.UTC(2026, 9, 31, 9, 59))).toBe(true);
    expect(inWindow(parseWindow("04-10"), Date.UTC(2026, 9, 31, 10, 0))).toBe(false);
    expect(() => parseWindow("4am")).toThrow(/HH-HH/);
  });

  it("lays paid runs out on the registry's days, as the registry check does", () => {
    const registry = registryOf(SAMPLE);
    const window = registry.budget.window;
    const day = windowDay(Date.UTC(2026, 9, 31, 5), window);
    const s02 = registry.byId.get("S02")!.runs[0]!;
    expect(slotDueOn(s02, day)).toBe(day % 2 === 0);
    expect(slotDueOn(s02, day + 1)).toBe(day % 2 === 1);
    // Every day of a 6-day cycle stays within 3 dials an hour.
    for (let d = day; d < day + 6; d++) {
      const byHour = new Map<number, number>();
      for (const run of plannedRuns(registry, d, window)) byHour.set(run.hour, (byHour.get(run.hour) ?? 0) + run.dials);
      for (const dials of byHour.values()) expect(dials).toBeLessThanOrEqual(3);
    }
    // A window that starts at 22:00 keeps its small hours on the evening's day.
    expect(windowDay(Date.UTC(2026, 10, 1, 1), parseWindow("22-04"))).toBe(windowDay(Date.UTC(2026, 9, 31, 23), parseWindow("22-04")));
  });
});

describe("buildSchedule", () => {
  const options = {
    window: parseWindow("04-10"),
    runnable: new Set(["S01", "S02", "S04", "S20", "S21", "S24", "S25", "G01", "D02p", "R00", "H01", "S07"]),
    node: "/opt/node-22/bin/node",
    cli: "/opt/rig/tools/rig/rigd/src/cli.ts",
    home: "/var/lib/loonext-rig",
  };
  const registry = registryOf(SAMPLE);
  const at = (schedule: ReturnType<typeof buildSchedule>) => Object.fromEntries(schedule.timed.map((t) => [t.instance, t.onCalendar]));

  it("fires paid runs daily at their registry hour, minutes apart when they can share it", () => {
    const timed = at(buildSchedule(registry, options));
    expect(timed.S02).toEqual(["*-*-* 05:02:00 UTC"]);
    expect(timed.G01).toEqual(["*-*-* 05:22:00 UTC"]);
    // S01 and S04 are both at 06:00 every 3 days, on different days, so they may share a minute.
    expect(timed.S01).toEqual(["*-*-* 06:02:00 UTC"]);
    expect(timed.S04).toEqual(["*-*-* 06:02:00 UTC"]);
    expect(timed.S24).toEqual(["*-*-* 07:02:00 UTC"]);
  });

  it("keeps every paid timer inside the window, and moves them with the guard's window", () => {
    for (const window of [parseWindow("04-10"), parseWindow("13-19"), parseWindow("22-04")]) {
      const schedule = buildSchedule(registry, { ...options, window });
      for (const t of schedule.timed.filter((t) => registry.byId.get(t.id)!.paid)) {
        const hour = Number(/ (\d{2}):/.exec(t.onCalendar[0]!)![1]);
        expect(windowHours(window), `${t.instance} in ${window.startHour}`).toContain(hour);
      }
    }
    expect(at(buildSchedule(registry, { ...options, window: parseWindow("13-19") })).S02).toEqual(["*-*-* 14:02:00 UTC"]);
  });

  it("fires text checks at any hour, a night run at night and a daytime run by day", () => {
    const timed = at(buildSchedule(registry, options));
    expect(timed.S20![0]).toMatch(/^\*-\*-\* \d{2}:\d{2}:00 UTC$/);
    expect(timed["S25-1"]![0]).toMatch(/^\*-\*-\* 17:\d{2}:00 UTC$/);
    expect(timed["S25-2"]![0]).toMatch(/^\*-\*-\* 05:\d{2}:00 UTC$/);
    expect(timed.R00![0]).toMatch(/^\*-\*-\* \*:\d{2}\/15:00 UTC$/);
    expect(timed.D02p![0]).toMatch(/^\*-\*-\* \d{2},\d{2},\d{2},\d{2}:\d{2}:00 UTC$/);
  });

  it("names what it does not time, and why, and does not hold back for room", () => {
    const { notTimed, timed } = buildSchedule(registry, { ...options, runnable: new Set(["S01", "S20"]), notRunnable: { S25: "not yet" } });
    expect(notTimed).toEqual(
      expect.arrayContaining([
        { id: "H01", reason: "runs on ci, not on the rig" },
        { id: "P01", reason: "runs on production, not on the rig" },
        { id: "S07", reason: "unscheduled: hourly-cap" },
        { id: "S25", reason: "not yet" },
        { id: "S02", reason: "no runner in rigd yet" },
      ]),
    );
    expect(timed.map((t) => t.instance)).toEqual(["S01", "S20"]);
  });

  it("writes a timer per run, one service template and the two daemons, with node on the PATH", () => {
    const { units } = buildSchedule(registry, options);
    const names = units.map((u) => u.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "loonext-rig-scenario@.service",
        "loonext-rig-rigd.service",
        "loonext-rig-robotd.service",
        "loonext-rig-scenario-S01.timer",
        "loonext-rig-scenario-S25-1.timer",
        "loonext-rig-scenario-S25-2.timer",
      ]),
    );
    const timer = units.find((u) => u.name === "loonext-rig-scenario-S25-2.timer")!.content;
    expect(timer).toContain("Unit=loonext-rig-scenario@S25-2.service");
    const service = units.find((u) => u.name === "loonext-rig-scenario@.service")!.content;
    expect(service).toContain("ExecStart=/opt/node-22/bin/node /opt/rig/tools/rig/rigd/src/cli.ts run %i --scheduled");
    expect(service).toContain("Environment=RIG_HOME=/var/lib/loonext-rig");
    expect(service).toContain("Environment=PATH=/opt/node-22/bin:/usr/local/bin:/usr/bin:/bin");
    const robotd = units.find((u) => u.name === "loonext-rig-robotd.service")!.content;
    expect(robotd).toContain("/opt/rig/tools/rig/robot/src/main.ts");
    expect(robotd).toContain("Environment=PATH=/opt/node-22/bin:");
    expect(robotd).toContain("WantedBy=default.target");
  });

  it("names a run's instance the way the CLI reads it back", () => {
    expect(parseInstance("S20")).toEqual({ id: "S20", slot: 0 });
    expect(parseInstance("S25-2")).toEqual({ id: "S25", slot: 1 });
    expect(parseInstance("D02p")).toEqual({ id: "D02p", slot: 0 });
    expect(() => parseInstance("S25-0")).toThrow(/not a scenario/);
  });

  it("refuses a registry that does not fit the budget", () => {
    expect(() => buildSchedule(registryOf(SAMPLE, { daily_cap: 6 }), options)).toThrow(/do not fit the budget/);
  });
});

describe("installSchedule", () => {
  it("writes the units, removes stale ones of its own, reloads only on a change and starts everything", () => {
    const dir = mkdtempSync(join(tmpdir(), "rig-units-"));
    try {
      writeFileSync(join(dir, "loonext-rig-scenario-S99.timer"), "[Timer]\n");
      writeFileSync(join(dir, "loonext-rig-cron-hourly.timer"), "[Timer]\n");
      const calls: string[][] = [];
      const schedule = buildSchedule(registryOf(SAMPLE), {
        window: parseWindow("04-10"),
        runnable: new Set(["S20"]),
        node: "/usr/bin/node",
        cli: "/opt/rig/tools/rig/rigd/src/cli.ts",
        home: "/var/lib/loonext-rig",
      });
      const first = installSchedule(schedule, { unitDir: dir, systemctl: (args) => calls.push(args) });
      expect(first.removed).toEqual(["loonext-rig-scenario-S99.timer"]);
      expect(first.written).toContain("loonext-rig-scenario-S20.timer");
      expect(existsSync(join(dir, "loonext-rig-cron-hourly.timer"))).toBe(true);
      expect(calls).toEqual([
        ["disable", "--now", "loonext-rig-scenario-S99.timer"],
        ["daemon-reload"],
        ["enable", "--now", "loonext-rig-rigd.service", "loonext-rig-robotd.service", "loonext-rig-scenario-S20.timer"],
      ]);
      calls.length = 0;
      expect(installSchedule(schedule, { unitDir: dir, systemctl: (args) => calls.push(args) })).toEqual({ written: [], removed: [] });
      expect(calls.map((args) => args[0])).toEqual(["enable"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the verdict store", () => {
  const verdict = (over: Partial<Verdict>): Verdict => ({
    run_id: "S02-1",
    scenario: "S02",
    sha: "0123456789abcdef0123456789abcdef01234567",
    attempt: 1,
    outcome: "pass",
    started_at: "2026-10-31T05:00:00.000Z",
    finished_at: "2026-10-31T05:02:00.000Z",
    dials: 2,
    scheduled: true,
    ...over,
  });

  it("refuses a verdict without the SHA it judged", () => {
    const store = new VerdictStore(mkdtempSync(join(tmpdir(), "rig-verdicts-")));
    expect(() => store.record(verdict({ sha: "" }))).toThrow(/not a git SHA/);
    expect(() => store.record(verdict({ sha: "main" }))).toThrow(/not a git SHA/);
    expect(() => store.record(verdict({ outcome: "fail" }))).toThrow(/failure_class/);
    expect(() => store.record(verdict({ outcome: "infra" }))).toThrow(/component/);
  });

  it("reports a failure as unresolved until a pass, counting the streak", () => {
    const store = new VerdictStore(mkdtempSync(join(tmpdir(), "rig-verdicts-")));
    store.record(verdict({}));
    store.record(verdict({ run_id: "S02-2", outcome: "fail", failure_class: "no_ring_within_6s", started_at: "2026-11-02T05:00:00.000Z" }));
    store.record(verdict({ run_id: "S02-2", attempt: 2, outcome: "fail", failure_class: "no_ring_within_6s", started_at: "2026-11-02T05:03:00.000Z" }));
    store.record(verdict({ run_id: "S02-3", outcome: "skipped", detail: "outside the dial window", dials: 0 }));
    store.record(verdict({ scenario: "S20", run_id: "S20-1", outcome: "infra", component: "robotd", dials: 0 }));
    const unresolved = store.unresolved();
    expect(unresolved.map((u) => [u.scenario, u.fingerprint, u.failing_attempts, u.since])).toEqual([
      ["S20", ["synthetic-infra", "robotd"], 1, "2026-10-31T05:00:00.000Z"],
      ["S02", ["synthetic", "S02", "no_ring_within_6s"], 2, "2026-11-02T05:00:00.000Z"],
    ]);
    store.record(verdict({ run_id: "S02-4", started_at: "2026-11-04T05:00:00.000Z" }));
    expect(store.unresolved().map((u) => u.scenario)).toEqual(["S20"]);
  });

  it("counts dials spent in a span, and which runs ran there, and keeps evidence per run", () => {
    const store = new VerdictStore(mkdtempSync(join(tmpdir(), "rig-verdicts-")));
    store.record(verdict({ started_at: "2026-10-31T05:00:00.000Z" }));
    store.record(verdict({ run_id: "S02-2", outcome: "skipped", started_at: "2026-10-31T06:00:00.000Z", dials: 0 }));
    store.record(verdict({ run_id: "S02-3", outcome: "preempted", started_at: "2026-10-31T07:00:00.000Z", slot: 1 }));
    expect(store.dialsBetween(Date.parse("2026-10-31T00:00:00.000Z"))).toBe(4);
    expect(store.dialsBetween(Date.parse("2026-10-31T05:00:00.000Z"), Date.parse("2026-10-31T06:00:00.000Z"))).toBe(2);
    expect([...store.ranBetween(Date.parse("2026-10-31T00:00:00.000Z"), Date.parse("2026-11-01T00:00:00.000Z"))]).toEqual(["S02#0", "S02#1"]);
    expect(store.lastRanAt("S02", 1)).toBe(Date.parse("2026-10-31T07:00:00.000Z"));
    store.saveEvidence("S02-1", 1, { ring_ms: 1200 });
    store.saveEvidence("S02-1", 2, { ring_ms: 900 });
    expect(store.evidence("S02-1")).toEqual([
      { attempt: 1, ring_ms: 1200 },
      { attempt: 2, ring_ms: 900 },
    ]);
    expect(() => store.evidence("../etc/passwd")).toThrow(/run id/);
  });
});
