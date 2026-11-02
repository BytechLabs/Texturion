import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blockedByRoom, inWindow, parseWindow, windowHours } from "./budget.ts";
import { installUnits } from "./install.ts";
import { instanceOf, loadRegistry, parseInstance, validateRegistry } from "./registry.ts";
import { rawRegistry, registryOf, SAMPLE, scenario } from "./test-registry.ts";
import { buildUnits } from "./units.ts";
import { VerdictStore, type Verdict } from "./verdicts.ts";

const REAL_REGISTRY = resolve(fileURLToPath(import.meta.url), "../../../scenarios.json");

describe("validateRegistry", () => {
  it("reads tools/rig/scenarios.json's own shape", () => {
    const registry = registryOf(SAMPLE);
    expect(registry.caps).toEqual({ daily: 18, hourly: 3, window: { startHour: 4, hours: 6 } });
    expect(registry.byId.get("S02")).toMatchObject({ dials: 1, far_end_legs: 1, room_min: 2, paid: true, runs: [{ index: 0 }] });
    expect(registry.byId.get("G01")).toMatchObject({ dials: 0, far_end_legs: 1, paid: true });
    expect(registry.byId.get("S25")!.runs.map((run) => run.label)).toEqual(["daytime", "night"]);
    expect(registry.byId.get("H01")!.runsOn).toBe("ci");
  });

  it.skipIf(!existsSync(REAL_REGISTRY))("loads the registry in the checkout", () => {
    const registry = loadRegistry(REAL_REGISTRY);
    expect(registry.scenarios.length).toBeGreaterThan(40);
    expect(registry.caps).toMatchObject({ daily: 18, hourly: 3 });
  });

  it("lists every problem at once", () => {
    let message = "";
    try {
      validateRegistry(
        rawRegistry([
          scenario("s2"),
          scenario("S03", { dials: -1 }),
          { id: "S05" },
          scenario("S06", { runs: [{ label: 3 }] }),
          scenario("S07", { runs: [] }),
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
    expect(message).toMatch(/\(S05\): lane must be/);
    expect(message).toMatch(/\(S06\) runs\[0\]: label must be a string/);
    expect(message).toMatch(/\(S07\): runs must be a list of at least one run/);
    expect(message).toMatch(/\(S11\): runs_on must be rig, ci, production, workstation/);
    expect(message).toMatch(/\(S12\): id repeats an earlier entry/);
  });

  it("refuses the old array shape, another schema and broken caps", () => {
    expect(() => validateRegistry([scenario("S20")])).toThrow(/loonext\.rig-scenarios\.v2 object/);
    expect(() => validateRegistry({ ...rawRegistry([]), schema: "loonext.rig-scenarios.v1" })).toThrow(/schema must be/);
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

  it("carries no scheduling field: a registry that still has one is read, and the field is ignored", () => {
    const registry = registryOf([scenario("S20", { cadence: "Daily (0)", scheduled: false, runs: [{ every: "1d" }] })]);
    expect(registry.byId.get("S20")!.runs).toEqual([{ index: 0 }]);
    expect(Object.keys(registry.byId.get("S20")!)).not.toContain("scheduled");
  });
});

describe("what may be dialled", () => {
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
});

describe("a run's instance", () => {
  it("is named the way the CLI reads it back", () => {
    expect(parseInstance("S20")).toEqual({ id: "S20", slot: 0 });
    expect(parseInstance("S25-2")).toEqual({ id: "S25", slot: 1 });
    expect(parseInstance("D02p")).toEqual({ id: "D02p", slot: 0 });
    expect(() => parseInstance("S25-0")).toThrow(/not a scenario/);
    const registry = registryOf(SAMPLE);
    const s25 = registry.byId.get("S25")!;
    expect(instanceOf(s25, s25.runs[1]!)).toBe("S25-2");
    expect(instanceOf(registry.byId.get("S20")!, { index: 0 })).toBe("S20");
  });
});

describe("rigd's units", () => {
  const options = { node: "/opt/node-22/bin/node", cli: "/opt/rig/tools/rig/rigd/src/cli.ts", home: "/var/lib/loonext-rig" };

  it("are the two daemons, with node on the PATH, and nothing that starts a scenario", () => {
    const units = buildUnits(options);
    expect(units.map((unit) => unit.name)).toEqual(["loonext-rig-rigd.service", "loonext-rig-robotd.service"]);
    const rigd = units[0]!.content;
    expect(rigd).toContain("ExecStart=/opt/node-22/bin/node /opt/rig/tools/rig/rigd/src/cli.ts daemon");
    expect(rigd).toContain("Environment=RIG_HOME=/var/lib/loonext-rig");
    expect(rigd).toContain("Environment=PATH=/opt/node-22/bin:/usr/local/bin:/usr/bin:/bin");
    const robotd = units[1]!.content;
    expect(robotd).toContain("/opt/rig/tools/rig/robot/src/main.ts");
    expect(robotd).toContain("WantedBy=default.target");
    for (const unit of units) {
      expect(unit.name).not.toMatch(/\.timer$/);
      expect(unit.content).not.toMatch(/\[Timer\]|OnCalendar|--scheduled/);
    }
  });
});

describe("installUnits", () => {
  const options = { node: "/usr/bin/node", cli: "/opt/rig/tools/rig/rigd/src/cli.ts", home: "/var/lib/loonext-rig" };

  it("writes the units, reloads only on a change, starts the daemons and enables no timer", () => {
    const dir = mkdtempSync(join(tmpdir(), "rig-units-"));
    try {
      const calls: string[][] = [];
      const units = buildUnits(options);
      const first = installUnits(units, { unitDir: dir, systemctl: (args) => calls.push(args) });
      expect(first).toEqual({ written: ["loonext-rig-rigd.service", "loonext-rig-robotd.service"], removed: [] });
      expect(calls).toEqual([["daemon-reload"], ["enable", "--now", "loonext-rig-rigd.service", "loonext-rig-robotd.service"]]);
      calls.length = 0;
      expect(installUnits(units, { unitDir: dir, systemctl: (args) => calls.push(args) })).toEqual({ written: [], removed: [] });
      expect(calls.map((args) => args[0])).toEqual(["enable"]);
      expect(readdirSync(dir).filter((name) => name.endsWith(".timer"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes the scenario timers and template an earlier rig installed, and leaves the rest alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "rig-units-"));
    try {
      writeFileSync(join(dir, "loonext-rig-scenario-S99.timer"), "[Timer]\n");
      writeFileSync(join(dir, "loonext-rig-scenario@.service"), "[Service]\n");
      writeFileSync(join(dir, "loonext-rig-api.service"), "[Service]\n");
      const calls: string[][] = [];
      const result = installUnits(buildUnits(options), { unitDir: dir, systemctl: (args) => calls.push(args) });
      expect(result.removed.sort()).toEqual(["loonext-rig-scenario-S99.timer", "loonext-rig-scenario@.service"]);
      expect(calls[0]).toEqual(["disable", "--now", "loonext-rig-scenario-S99.timer"]);
      expect(existsSync(join(dir, "loonext-rig-api.service"))).toBe(true);
      expect(readdirSync(dir).sort()).toEqual(["loonext-rig-api.service", "loonext-rig-rigd.service", "loonext-rig-robotd.service"]);
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

  it("counts dials spent in a span, and keeps evidence per run", () => {
    const store = new VerdictStore(mkdtempSync(join(tmpdir(), "rig-verdicts-")));
    store.record(verdict({ started_at: "2026-10-31T05:00:00.000Z" }));
    store.record(verdict({ run_id: "S02-2", outcome: "skipped", started_at: "2026-10-31T06:00:00.000Z", dials: 0 }));
    store.record(verdict({ run_id: "S02-3", outcome: "preempted", started_at: "2026-10-31T07:00:00.000Z", slot: 1 }));
    expect(store.dialsBetween(Date.parse("2026-10-31T00:00:00.000Z"))).toBe(4);
    expect(store.dialsBetween(Date.parse("2026-10-31T05:00:00.000Z"), Date.parse("2026-10-31T06:00:00.000Z"))).toBe(2);
    store.saveEvidence("S02-1", 1, { ring_ms: 1200 });
    store.saveEvidence("S02-1", 2, { ring_ms: 900 });
    expect(store.evidence("S02-1")).toEqual([
      { attempt: 1, ring_ms: 1200 },
      { attempt: 2, ring_ms: 900 },
    ]);
    expect(() => store.evidence("../etc/passwd")).toThrow(/run id/);
  });
});
