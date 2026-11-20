/**
 * Registries for rigd's tests, in tools/rig/scenarios.json's own shape
 * (`loonext.rig-scenarios.v2`). `SAMPLE` copies real entries field for field,
 * so a test that reads it reads what a run will.
 */
import { validateRegistry } from './registry.ts';
import type { Registry } from './registry.ts';

export type RawScenario = Record<string, unknown>;

/** A scenario entry with the fields every one has, overridden by `over`. */
export function scenario(id: string, over: RawScenario = {}): RawScenario {
  return {
    id,
    name: `Scenario ${id}`,
    lane: "texts",
    far_end: "ROBOT-1",
    runs_on: "rig",
    runs: [{}],
    dials: 0,
    far_end_legs: 0,
    peak_concurrent_outbound_legs: 0,
    ...over,
  };
}

export function rawRegistry(scenarios: RawScenario[]): Record<string, unknown> {
  return { schema: "loonext.rig-scenarios.v2", notes: [], lanes: [], named_defects: [], scenarios };
}

export function registryOf(scenarios: RawScenario[]): Registry {
  return validateRegistry(rawRegistry(scenarios));
}

/** Entries as tools/rig/scenarios.json holds them. */
export const SAMPLE: RawScenario[] = [
  scenario("R00", { lane: "health" }),
  scenario("H01", { lane: "hermetic", runs_on: "ci" }),
  scenario("S01", { lane: "browser", dials: 2, peak_concurrent_outbound_legs: 1 }),
  scenario("S02", { lane: "browser", dials: 1, far_end_legs: 1, peak_concurrent_outbound_legs: 1 }),
  scenario("S04", { lane: "browser", dials: 1, far_end_legs: 1, peak_concurrent_outbound_legs: 1 }),
  scenario("S07", {
    lane: "browser",
    runs: [{ label: "blind" }, { label: "decline" }],
    dials: 3,
    far_end_legs: 1,
  }),
  scenario("S20"),
  scenario("S21"),
  scenario("S23"),
  scenario("S24", { dials: 2, peak_concurrent_outbound_legs: 1 }),
  scenario("S25", { runs: [{ label: "daytime" }, { label: "night" }] }),
  scenario("G01", { lane: "isolation", far_end_legs: 1 }),
  scenario("D02p", { lane: "device" }),
];
