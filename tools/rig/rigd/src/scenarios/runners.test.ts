/**
 * RUNNERS, NOT_RUNNABLE_YET and tools/rig/scenarios.json describe one set of
 * scenarios: what rigd can run, what it cannot yet and why, and what the
 * registry schedules. The scheduler reads all three, so they must agree.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dialBudget, parseWindow } from "../budget.ts";
import { loadRegistry } from "../registry.ts";
import { buildSchedule } from "../schedule.ts";
import { NOT_RUNNABLE_YET, RUNNERS } from "./index.ts";

const registry = loadRegistry(resolve(fileURLToPath(import.meta.url), "../../../../scenarios.json"));
const runnable = Object.keys(RUNNERS);
const notRunnable = Object.keys(NOT_RUNNABLE_YET);

describe("the runners and the registry", () => {
  it("name only scenarios the registry runs on the rig", () => {
    for (const id of [...runnable, ...notRunnable]) {
      expect(registry.byId.get(id)?.runsOn, id).toBe("rig");
    }
  });

  it("keep each runner under its own id, and never call one both runnable and not", () => {
    for (const [id, runner] of Object.entries(RUNNERS)) expect(runner.id, id).toBe(id);
    expect(runnable.filter((id) => notRunnable.includes(id))).toEqual([]);
    for (const [id, reason] of Object.entries(NOT_RUNNABLE_YET)) expect(reason.trim(), id).not.toBe("");
  });

  it("lay out a schedule the budget holds: every runner timed, and every scenario that cannot run yet listed with its reason", () => {
    expect(dialBudget(registry).fits).toBe(true);
    const schedule = buildSchedule(registry, {
      window: parseWindow("04-10"),
      runnable: new Set(runnable),
      notRunnable: NOT_RUNNABLE_YET,
      node: "/usr/local/bin/node",
      cli: "/opt/rig/tools/rig/rigd/src/cli.ts",
      home: "/var/lib/loonext-rig",
    });
    const timed = new Set(schedule.timed.map((t) => t.id));
    for (const id of runnable) {
      const entry = registry.byId.get(id)!;
      if (entry.scheduled) expect(timed.has(id), `${id} is runnable and scheduled but has no timer`).toBe(true);
    }
    for (const [id, reason] of Object.entries(NOT_RUNNABLE_YET)) {
      if (registry.byId.get(id)!.scheduled) expect(schedule.notTimed).toContainEqual({ id, reason });
    }
  });
});
