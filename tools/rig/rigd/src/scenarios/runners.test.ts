/**
 * RUNNERS, NOT_RUNNABLE_YET and tools/rig/scenarios.json describe one set of
 * scenarios: what rigd can run, what it cannot yet and why, and what the
 * registry lists. `rig run` reads all three, so they must agree.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRegistry } from "../registry.ts";
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

  it("leave no scenario the registry runs on the rig without a runner or a reason it has none", () => {
    const unaccounted = registry.scenarios
      .filter((entry) => entry.runsOn === "rig")
      .filter((entry) => !runnable.includes(entry.id) && !notRunnable.includes(entry.id))
      .map((entry) => entry.id);
    expect(unaccounted).toEqual([]);
  });
});
