/**
 * Registries for rigd's tests, in tools/rig/scenarios.json's own shape
 * (`loonext.rig-scenarios.v1`). `SAMPLE` copies real entries field for field,
 * so a test that reads it reads what the scheduler will.
 */
import { validateRegistry, type Registry } from "./registry.ts";

export const BUDGET = {
  daily_cap: 18,
  hourly_cap: 3,
  days_per_month: 30,
  retry_reserve: 0.2,
  repro_reserve_dials: 60,
  window_utc: [4, 10],
};

export type RawScenario = Record<string, unknown>;

/** A scenario entry with the fields every one has, overridden by `over`. */
export function scenario(id: string, over: RawScenario = {}): RawScenario {
  return {
    id,
    name: `Scenario ${id}`,
    lane: "texts",
    far_end: "ROBOT-1",
    cadence: "Daily (0)",
    runs_on: "rig",
    runs: [{ every: "1d" }],
    scheduled: true,
    dials: 0,
    far_end_legs: 0,
    peak_concurrent_outbound_legs: 0,
    min_room: 0,
    ...over,
  };
}

export function rawRegistry(scenarios: RawScenario[], budget: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema: "loonext.rig-scenarios.v1", notes: [], budget: { ...BUDGET, ...budget }, lanes: [], named_defects: [], scenarios };
}

export function registryOf(scenarios: RawScenario[], budget: Record<string, unknown> = {}): Registry {
  return validateRegistry(rawRegistry(scenarios, budget));
}

/** Entries as tools/rig/scenarios.json holds them (registries branch, 2026-10-31). */
export const SAMPLE: RawScenario[] = [
  scenario("R00", { lane: "health", cadence: "Every 15 min (0)", runs: [{ every: "15m" }] }),
  scenario("H01", { lane: "hermetic", cadence: "Every push (0)", runs_on: "ci", runs: [{ every: "push" }] }),
  scenario("P01", { lane: "production-watch", cadence: "Hourly, in production (0)", runs_on: "production", runs: [{ every: "1h" }] }),
  scenario("S01", {
    lane: "browser",
    cadence: "Every 3 days (2)",
    runs: [{ every: "3d", offset_days: 1, hour_utc: 6 }],
    dials: 2,
    peak_concurrent_outbound_legs: 1,
    min_room: 2,
  }),
  scenario("S02", {
    lane: "browser",
    cadence: "Every 2 days (2)",
    runs: [{ every: "2d", offset_days: 0, hour_utc: 5 }],
    dials: 1,
    far_end_legs: 1,
    peak_concurrent_outbound_legs: 1,
    min_room: 2,
  }),
  scenario("S04", {
    lane: "browser",
    cadence: "Every 3 days (2)",
    runs: [{ every: "3d", offset_days: 2, hour_utc: 6 }],
    dials: 1,
    far_end_legs: 1,
    peak_concurrent_outbound_legs: 1,
    min_room: 2,
  }),
  scenario("S07", {
    lane: "browser",
    cadence: "Weekly; variants monthly (4)",
    runs: [
      { label: "blind", every: "7d" },
      { label: "decline", every: "30d" },
    ],
    scheduled: false,
    unscheduled_because: "hourly-cap",
    dials: 3,
    far_end_legs: 1,
    min_room: 3,
  }),
  scenario("S20", { cadence: "Daily (0)", runs: [{ every: "1d" }] }),
  scenario("S21", { cadence: "Daily (0)", runs: [{ every: "1d" }] }),
  scenario("S23", { cadence: "Weekly (0)", runs: [{ every: "7d" }] }),
  scenario("S24", {
    cadence: "Weekly (2)",
    runs: [{ every: "7d", offset_days: 5, hour_utc: 7 }],
    dials: 2,
    peak_concurrent_outbound_legs: 1,
    min_room: 2,
  }),
  scenario("S25", {
    cadence: "Weekly, two runs (0)",
    runs: [
      { label: "daytime", every: "7d" },
      { label: "night", every: "7d" },
    ],
  }),
  scenario("G01", {
    lane: "isolation",
    cadence: "Daily (1)",
    runs: [{ every: "1d", offset_days: 0, hour_utc: 5 }],
    far_end_legs: 1,
    min_room: 3,
  }),
  scenario("D02p", { lane: "device", cadence: "4 times a day (0)", runs: [{ every: "6h" }] }),
];
