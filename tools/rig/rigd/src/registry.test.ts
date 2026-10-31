import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blockedByRoom, dialBudget, inWindow, parseWindow, windowHours } from "./budget.ts";
import { loadRegistry, parseFrequency, runsPerMonth, validateRegistry } from "./registry.ts";
import { buildSchedule } from "./schedule.ts";
import { VerdictStore, type Verdict } from "./verdicts.ts";

const entry = (over: Record<string, unknown> = {}) => ({
  id: "S02",
  frequency: "every-2-days",
  dials: 2,
  lane: "browser",
  room_min: 2,
  paid: true,
  ...over,
});

describe("parseFrequency", () => {
  it.each([
    ["15m", { kind: "interval", everyMinutes: 15 }],
    ["hourly", { kind: "interval", everyMinutes: 60 }],
    ["4/day", { kind: "interval", everyMinutes: 360 }],
    ["6h", { kind: "interval", everyMinutes: 360 }],
    ["daily", { kind: "days", everyDays: 1 }],
    ["24h", { kind: "days", everyDays: 1 }],
    ["every 3 days", { kind: "days", everyDays: 3 }],
    ["2d", { kind: "days", everyDays: 2 }],
    ["weekly", { kind: "days", everyDays: 7 }],
    ["2w", { kind: "days", everyDays: 14 }],
    ["Fortnightly", { kind: "days", everyDays: 14 }],
    ["monthly", { kind: "days", everyDays: 30 }],
    ["2/week", { kind: "per-week", times: 2 }],
    ["push", { kind: "unscheduled", reason: "runs on every push, in CI" }],
    ["production", { kind: "unscheduled", reason: "runs in production, not on the rig" }],
  ])("reads %s", (text, cadence) => {
    expect(parseFrequency(text)).toEqual(cadence);
  });

  it.each(["7m", "5h", "sometimes", "0d", "9/week", "5/day"])("refuses %s", (text) => {
    expect(() => parseFrequency(text)).toThrow();
  });

  it("counts runs a month", () => {
    expect(runsPerMonth(parseFrequency("15m"))).toBe(2880);
    expect(runsPerMonth(parseFrequency("every-3-days"))).toBe(10);
    expect(runsPerMonth(parseFrequency("push"))).toBe(0);
  });
});

describe("validateRegistry", () => {
  it("accepts the expected shape, with extra keys ignored", () => {
    const [s02] = validateRegistry([entry({ notes: "anything" })]);
    expect(s02).toMatchObject({ id: "S02", cadence: { kind: "days", everyDays: 2 } });
  });

  it("lists every problem at once", () => {
    let message = "";
    try {
      validateRegistry([
        entry({ id: "s2" }),
        entry({ dials: -1 }),
        entry({ id: "S04", paid: "yes" }),
        { id: "S05" },
        entry({ id: "S06", frequency: "now and then" }),
        entry({ id: "S07", dials: 2, paid: false }),
        entry({ id: "S02" }),
        entry({ id: "S02" }),
      ]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/id must be a scenario id/);
    expect(message).toMatch(/dials must be a whole number/);
    expect(message).toMatch(/paid must be true or false/);
    expect(message).toMatch(/missing frequency, dials, lane, room_min, paid/);
    expect(message).toMatch(/now and then/);
    expect(message).toMatch(/dials 2 but paid is false/);
    expect(message).toMatch(/id repeats an earlier entry/);
  });

  it("refuses a registry that is not an array, and a file that is not JSON", () => {
    expect(() => validateRegistry({ scenarios: [] })).toThrow(/JSON array/);
    const dir = mkdtempSync(join(tmpdir(), "rig-registry-"));
    try {
      writeFileSync(join(dir, "scenarios.json"), "[ not json");
      expect(() => loadRegistry(join(dir, "scenarios.json"))).toThrow(/scenarios\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the dial budget", () => {
  it("adds the retry and repro reserves and compares with the daily cap times 30", () => {
    const registry = validateRegistry([
      entry({ id: "S01", frequency: "every-3-days", dials: 2 }),
      entry({ id: "S02", frequency: "every-2-days", dials: 2 }),
      entry({ id: "D02", frequency: "daily", dials: 3, far_end_legs: 0 }),
      entry({ id: "S20", frequency: "daily", dials: 0, paid: false }),
    ]);
    const report = dialBudget(registry);
    expect(report.scheduledDials).toBe(20 + 30 + 90);
    expect(report.retryReserve).toBe(28);
    expect(report.total).toBe(140 + 28 + 60);
    expect(report.monthlyCap).toBe(540);
    expect(report.fits).toBe(true);
    expect(dialBudget(validateRegistry([entry({ frequency: "hourly", dials: 1 })])).fits).toBe(false);
  });

  it("keeps paid calls off below a room of 2, and under a scenario's own minimum", () => {
    const [paid] = validateRegistry([entry({ room_min: 3 })]);
    const [text] = validateRegistry([entry({ id: "S20", dials: 0, paid: false, room_min: 0 })]);
    expect(blockedByRoom(paid!, 1)).toBe(true);
    expect(blockedByRoom(paid!, 2)).toBe(true);
    expect(blockedByRoom(paid!, 3)).toBe(false);
    expect(blockedByRoom(text!, 0)).toBe(false);
  });

  it("reads the window in UTC, wrapping midnight", () => {
    expect(windowHours(parseWindow(undefined))).toEqual([4, 5, 6, 7, 8, 9]);
    expect(windowHours(parseWindow("22-02"))).toEqual([22, 23, 0, 1]);
    expect(inWindow(parseWindow("04-10"), Date.UTC(2026, 9, 31, 9, 59))).toBe(true);
    expect(inWindow(parseWindow("04-10"), Date.UTC(2026, 9, 31, 10, 0))).toBe(false);
    expect(() => parseWindow("4am")).toThrow(/HH-HH/);
  });
});

describe("buildSchedule", () => {
  const options = {
    window: parseWindow("04-10"),
    room: 4,
    runnable: new Set(["S01", "S02", "S20", "S21", "S25", "R00"]),
    node: "/usr/bin/node",
    cli: "/opt/rig/tools/rig/rigd/src/cli.ts",
    home: "/var/lib/loonext-rig",
  };
  const registry = validateRegistry([
    entry({ id: "S01", frequency: "every-3-days" }),
    entry({ id: "S02", frequency: "every-2-days" }),
    entry({ id: "S20", frequency: "daily", dials: 0, paid: false, room_min: 0 }),
    entry({ id: "S21", frequency: "15m", dials: 0, paid: false, room_min: 0 }),
    entry({ id: "S25", frequency: "2/week", dials: 0, paid: false, room_min: 0 }),
    entry({ id: "S03", frequency: "weekly", dials: 3, room_min: 3 }),
    entry({ id: "H01", frequency: "push", dials: 0, paid: false, room_min: 0 }),
  ]);

  it("times paid scenarios inside the window and the rest at any hour", () => {
    const schedule = buildSchedule(registry, options);
    const at = Object.fromEntries(schedule.timed.map((t) => [t.id, t.onCalendar]));
    expect(at.S01).toEqual(["*-*-* 04:05:00 UTC"]);
    expect(at.S02![0]).toMatch(/^\*-\*-\* 0[4-9]:\d{2}:00 UTC$/);
    expect(at.S02).not.toEqual(at.S01);
    expect(at.S20![0]).toMatch(/^\*-\*-\* 13:\d{2}:00 UTC$/);
    expect(at.S21).toEqual(["*-*-* *:11/15:00 UTC"]);
    expect(at.S25).toHaveLength(2);
    const [first, second] = at.S25!.map((spec) => Number(/ (\d{2}):/.exec(spec)![1]));
    expect(Math.abs(first! - second!)).toBe(12);
  });

  it("names what it does not time, and why", () => {
    const { notTimed } = buildSchedule(registry, options);
    expect(notTimed).toEqual([
      { id: "S03", reason: "no runner in rigd yet" },
      { id: "H01", reason: "runs on every push, in CI" },
    ]);
    const lowRoom = buildSchedule(registry, { ...options, room: 1 });
    expect(lowRoom.notTimed).toContainEqual({ id: "S01", reason: "needs room 2, the account has 1" });
  });

  it("writes a timer per scenario, one service template and the two daemons", () => {
    const { units } = buildSchedule(registry, options);
    const names = units.map((u) => u.name);
    expect(names).toEqual(expect.arrayContaining(["loonext-rig-scenario@.service", "loonext-rig-rigd.service", "loonext-rig-robotd.service", "loonext-rig-scenario-S01.timer"]));
    const timer = units.find((u) => u.name === "loonext-rig-scenario-S01.timer")!.content;
    expect(timer).toContain("OnCalendar=*-*-* 04:05:00 UTC");
    expect(timer).toContain("Unit=loonext-rig-scenario@S01.service");
    const service = units.find((u) => u.name === "loonext-rig-scenario@.service")!.content;
    expect(service).toContain("ExecStart=/usr/bin/node /opt/rig/tools/rig/rigd/src/cli.ts run %i --scheduled");
    expect(service).toContain("Environment=RIG_HOME=/var/lib/loonext-rig");
    const robotd = units.find((u) => u.name === "loonext-rig-robotd.service")!.content;
    expect(robotd).toContain("/opt/rig/tools/rig/robot/src/main.ts");
    expect(robotd).toContain("WantedBy=default.target");
  });

  it("refuses a registry that does not fit the budget", () => {
    expect(() => buildSchedule(validateRegistry([entry({ frequency: "hourly" })]), options)).toThrow(/do not fit the budget/);
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

  it("counts dials spent, and keeps evidence per run", () => {
    const store = new VerdictStore(mkdtempSync(join(tmpdir(), "rig-verdicts-")));
    store.record(verdict({ started_at: "2026-10-31T05:00:00.000Z" }));
    store.record(verdict({ run_id: "S02-2", outcome: "skipped", started_at: "2026-10-31T06:00:00.000Z", dials: 0 }));
    store.record(verdict({ run_id: "S02-3", outcome: "preempted", started_at: "2026-10-31T07:00:00.000Z" }));
    expect(store.dialsSince(Date.parse("2026-10-31T00:00:00.000Z"))).toBe(4);
    expect(store.dialsSince(Date.parse("2026-10-31T06:30:00.000Z"))).toBe(2);
    store.saveEvidence("S02-1", 1, { ring_ms: 1200 });
    store.saveEvidence("S02-1", 2, { ring_ms: 900 });
    expect(store.evidence("S02-1")).toEqual([
      { attempt: 1, ring_ms: 1200 },
      { attempt: 2, ring_ms: 900 },
    ]);
    expect(() => store.evidence("../etc/passwd")).toThrow(/run id/);
  });
});
