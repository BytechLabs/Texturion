/**
 * tools/rig/scenarios.json, the scenario registry (`loonext.rig-scenarios.v1`,
 * checked against the design doc by scripts/check-rig-scenarios.mjs), read
 * and checked again before anything is scheduled. A registry that does not
 * have the expected shape stops rigd with every problem listed: a scheduler
 * that guessed would dial at the wrong time.
 *
 * What rigd reads from it:
 *   budget        the caps, reserves and dial window
 *   scenarios[]   id, lane, runs_on, scheduled, dials, far_end_legs, min_room
 *                 and runs: [{ every, offset_days?, hour_utc?, label? }]
 *
 * A run with dials sits on a day of its period and an hour of the window: it
 * is due on the days where (day % every) == offset_days, counting days from
 * the Unix epoch, which is the same layout the check proves fits 3 dials an
 * hour. Other keys are allowed and ignored.
 */
import { readFileSync } from "node:fs";
import type { DialCaps, DialWindow } from "./budget.ts";

export const REGISTRY_SCHEMA = "loonext.rig-scenarios.v1";
export const RUNS_ON = ["rig", "ci", "production", "workstation"] as const;
export type RunsOn = (typeof RUNS_ON)[number];

export interface RunSlot {
  /** The run's place in the entry's `runs`, from 0. */
  index: number;
  label?: string;
  every: string;
  /** Minutes between runs; 0 for `push`. */
  everyMinutes: number;
  offsetDays?: number;
  hourUtc?: number;
}

export interface RegisteredScenario {
  id: string;
  lane: string;
  runsOn: RunsOn;
  /** False when the doc's cadence is not in force under the current cap. */
  scheduled: boolean;
  unscheduledBecause?: string;
  /** Legs Loonext creates. */
  dials: number;
  /** Legs the far end creates; on the rig, the robot's. */
  far_end_legs: number;
  room_min: number;
  /** Any leg at all: every dial is paid and runs only inside the window. */
  paid: boolean;
  runs: RunSlot[];
}

export interface RegistryBudget extends DialCaps {
  daysPerMonth: number;
  retryReserve: number;
  reproReserveDials: number;
  window: DialWindow;
}

export interface Registry {
  budget: RegistryBudget;
  scenarios: RegisteredScenario[];
  byId: ReadonlyMap<string, RegisteredScenario>;
}

const DAY_MINUTES = 24 * 60;
const UNIT_MINUTES: Record<string, number> = { m: 1, h: 60, d: DAY_MINUTES };

/** Minutes between runs for `15m`, `6h`, `3d`; 0 for `push`; undefined for anything else. */
export function periodMinutes(every: unknown): number | undefined {
  if (every === "push") return 0;
  const match = /^([1-9]\d*)([mhd])$/.exec(typeof every === "string" ? every : "");
  return match ? Number(match[1]) * UNIT_MINUTES[match[2]!]! : undefined;
}

/** Runs a month of one slot, over the registry's month. */
export function runsPerMonth(slot: RunSlot, daysPerMonth: number): number {
  return slot.everyMinutes === 0 ? 0 : (daysPerMonth * DAY_MINUTES) / slot.everyMinutes;
}

/** Whether the rig's timers start this scenario. */
export function timedOnRig(entry: RegisteredScenario): boolean {
  return entry.runsOn === "rig" && entry.scheduled && entry.runs.some((run) => run.everyMinutes > 0);
}

/** Why the rig's timers leave a scenario alone, or undefined when they start it. */
export function notOnRigBecause(entry: RegisteredScenario): string | undefined {
  if (entry.runsOn !== "rig") return `runs on ${entry.runsOn}, not on the rig`;
  if (!entry.scheduled) return `unscheduled: ${entry.unscheduledBecause ?? "the registry says so"}`;
  if (!entry.runs.some((run) => run.everyMinutes > 0)) return "runs on every push, in CI";
  return undefined;
}

const ID = /^[A-Z]{1,3}\d{2,3}[a-z]?$/;

/** Every problem at once, so one fix-up round is enough. */
export function validateRegistry(value: unknown, source = "scenarios.json"): Registry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source}: the registry must be a ${REGISTRY_SCHEMA} object with budget and scenarios`);
  }
  const root = value as Record<string, unknown>;
  const problems: string[] = [];
  if (root.schema !== REGISTRY_SCHEMA) problems.push(`schema must be "${REGISTRY_SCHEMA}", not ${JSON.stringify(root.schema)}`);
  const budget = readBudget(root.budget, problems);
  if (!Array.isArray(root.scenarios)) problems.push("scenarios must be an array");

  const seen = new Set<string>();
  const scenarios: RegisteredScenario[] = [];
  (Array.isArray(root.scenarios) ? root.scenarios : []).forEach((raw, index) => {
    const entry = readScenario(raw, `scenarios[${index}]`, budget, problems);
    if (!entry) return;
    if (seen.has(entry.id)) problems.push(`scenarios[${index}] (${entry.id}): id repeats an earlier entry`);
    seen.add(entry.id);
    scenarios.push(entry);
  });
  if (problems.length || !budget) {
    throw new Error(`${source} does not have the shape rigd schedules from:\n  - ${problems.join("\n  - ")}`);
  }
  return { budget, scenarios, byId: new Map(scenarios.map((entry) => [entry.id, entry])) };
}

function readBudget(raw: unknown, problems: string[]): RegistryBudget | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    problems.push("budget must be an object");
    return undefined;
  }
  const b = raw as Record<string, unknown>;
  const before = problems.length;
  for (const key of ["daily_cap", "hourly_cap", "days_per_month", "repro_reserve_dials"]) {
    if (!isCount(b[key]) || b[key] === 0) problems.push(`budget.${key} must be a whole number above 0`);
  }
  if (typeof b.retry_reserve !== "number" || b.retry_reserve < 0 || b.retry_reserve >= 1) {
    problems.push("budget.retry_reserve must be a share from 0 to under 1");
  }
  const window = b.window_utc;
  const validWindow =
    Array.isArray(window) &&
    window.length === 2 &&
    window.every((hour) => isCount(hour) && hour <= 24) &&
    window[0] < 24 &&
    window[0] !== window[1] % 24;
  if (!validWindow) problems.push("budget.window_utc must be [start, end] in whole UTC hours");
  if (problems.length > before) return undefined;
  const [start, end] = window as [number, number];
  return {
    daily: b.daily_cap as number,
    hourly: b.hourly_cap as number,
    daysPerMonth: b.days_per_month as number,
    retryReserve: b.retry_reserve as number,
    reproReserveDials: b.repro_reserve_dials as number,
    window: { startHour: start, hours: (end - start + 24) % 24 },
  };
}

function readScenario(raw: unknown, where: string, budget: RegistryBudget | undefined, problems: string[]): RegisteredScenario | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    problems.push(`${where}: not an object`);
    return undefined;
  }
  const entry = raw as Record<string, unknown>;
  const label = typeof entry.id === "string" ? `${where} (${entry.id})` : where;
  const before = problems.length;
  const bad = (key: string, wanted: string) => problems.push(`${label}: ${key} must be ${wanted}`);
  if (typeof entry.id !== "string" || !ID.test(entry.id)) bad("id", "a scenario id like S02 or D02p");
  if (typeof entry.lane !== "string" || entry.lane.trim() === "") bad("lane", "a non-empty string");
  if (!(RUNS_ON as readonly unknown[]).includes(entry.runs_on)) bad("runs_on", RUNS_ON.join(", "));
  if (typeof entry.scheduled !== "boolean") bad("scheduled", "true or false");
  for (const key of ["dials", "far_end_legs", "min_room"]) {
    if (!isCount(entry[key])) bad(key, "a whole number, 0 or more");
  }
  if (!Array.isArray(entry.runs) || entry.runs.length === 0) bad("runs", "a list of at least one run");
  if (problems.length > before) return undefined;

  const paid = (entry.dials as number) + (entry.far_end_legs as number) > 0;
  const placed = paid && entry.scheduled === true && entry.runs_on === "rig";
  const runs: RunSlot[] = [];
  (entry.runs as unknown[]).forEach((rawRun, index) => {
    const at = `${label} runs[${index}]`;
    const run = (rawRun ?? {}) as Record<string, unknown>;
    const everyMinutes = periodMinutes(run.every);
    if (everyMinutes === undefined) {
      problems.push(`${at}: every ${JSON.stringify(run.every)} is not a period like 15m, 6h, 3d or push`);
      return;
    }
    if (run.label !== undefined && typeof run.label !== "string") problems.push(`${at}: label must be a string`);
    if (run.offset_days !== undefined && !isCount(run.offset_days)) problems.push(`${at}: offset_days must be a whole number`);
    if (run.hour_utc !== undefined && (!isCount(run.hour_utc) || run.hour_utc > 23)) problems.push(`${at}: hour_utc must be 0 to 23`);
    if (placed) {
      // A dial outside the window is the failure the window exists to prevent,
      // so a paid run must say which day of its period and which hour it takes.
      if (everyMinutes === 0 || everyMinutes % DAY_MINUTES !== 0) {
        problems.push(`${at}: a run with dials must recur in whole days, not ${String(run.every)}`);
      } else {
        const every = everyMinutes / DAY_MINUTES;
        if (!isCount(run.offset_days) || run.offset_days >= every) problems.push(`${at}: offset_days must be 0 to ${every - 1}`);
        if (!isCount(run.hour_utc) || (budget && !windowHasHour(budget.window, run.hour_utc))) {
          problems.push(`${at}: hour_utc must be an hour inside the dial window`);
        }
      }
    }
    runs.push({
      index,
      every: run.every as string,
      everyMinutes,
      ...(typeof run.label === "string" ? { label: run.label } : {}),
      ...(isCount(run.offset_days) ? { offsetDays: run.offset_days } : {}),
      ...(isCount(run.hour_utc) ? { hourUtc: run.hour_utc } : {}),
    });
  });
  if (problems.length > before) return undefined;
  return {
    id: entry.id as string,
    lane: entry.lane as string,
    runsOn: entry.runs_on as RunsOn,
    scheduled: entry.scheduled as boolean,
    ...(typeof entry.unscheduled_because === "string" ? { unscheduledBecause: entry.unscheduled_because } : {}),
    dials: entry.dials as number,
    far_end_legs: entry.far_end_legs as number,
    room_min: entry.min_room as number,
    paid,
    runs,
  };
}

export function loadRegistry(path: string): Registry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`);
  }
  return validateRegistry(parsed, path);
}

/** Dials one run spends at Telnyx: Loonext's legs and the far end's. */
export function dialsPerRun(entry: Pick<RegisteredScenario, "dials" | "far_end_legs">): number {
  return entry.dials + entry.far_end_legs;
}

function windowHasHour(window: DialWindow, hour: number): boolean {
  return (hour - window.startHour + 24) % 24 < window.hours;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
