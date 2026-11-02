/**
 * tools/rig/scenarios.json, the scenario registry (`loonext.rig-scenarios.v2`,
 * checked against the design doc by scripts/check-rig-scenarios.mjs), read
 * and checked again before a run starts. It is the catalogue of what can be
 * run on demand: nothing in it says when. A registry that does not have the
 * expected shape stops rigd with every problem listed.
 *
 * What rigd reads from it:
 *   caps          the guard's hourly and daily dial caps and its quiet window
 *   scenarios[]   id, lane, runs_on, dials, far_end_legs, min_room and
 *                 runs: [{ label? }], the named variants of one scenario
 *
 * Other keys are allowed and ignored.
 */
import { readFileSync } from "node:fs";
import type { DialCaps, DialWindow } from "./budget.ts";

export const REGISTRY_SCHEMA = "loonext.rig-scenarios.v2";
export const RUNS_ON = ["rig", "ci", "production", "workstation"] as const;
export type RunsOn = (typeof RUNS_ON)[number];

export interface RunSlot {
  /** The run's place in the entry's `runs`, from 0. */
  index: number;
  label?: string;
}

export interface RegisteredScenario {
  id: string;
  lane: string;
  runsOn: RunsOn;
  /** Legs Loonext creates. */
  dials: number;
  /** Legs the far end creates; on the rig, the robot's. */
  far_end_legs: number;
  room_min: number;
  /** Any leg at all: every dial is paid and runs only inside the guard's window. */
  paid: boolean;
  /** The ways to run it: one, or one per named variant. */
  runs: RunSlot[];
}

export interface RegistryCaps extends DialCaps {
  window: DialWindow;
}

export interface Registry {
  caps: RegistryCaps;
  scenarios: RegisteredScenario[];
  byId: ReadonlyMap<string, RegisteredScenario>;
}

/** The instance a run is asked for by: `S20`, or `S25-2` for the second variant of S25. */
export function instanceOf(entry: Pick<RegisteredScenario, "id" | "runs">, slot: Pick<RunSlot, "index">): string {
  return entry.runs.length > 1 ? `${entry.id}-${slot.index + 1}` : entry.id;
}

/** `S20` or `S25-2` back to the scenario and its run, from 0. */
export function parseInstance(text: string): { id: string; slot: number } {
  const match = /^([A-Z]{1,3}\d{2,3}[a-z]?)(?:-([1-9]\d?))?$/.exec(text);
  if (!match) throw new Error(`"${text}" is not a scenario like S20 or S25-2`);
  return { id: match[1]!, slot: match[2] ? Number(match[2]) - 1 : 0 };
}

const ID = /^[A-Z]{1,3}\d{2,3}[a-z]?$/;

/** Every problem at once, so one fix-up round is enough. */
export function validateRegistry(value: unknown, source = "scenarios.json"): Registry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source}: the registry must be a ${REGISTRY_SCHEMA} object with caps and scenarios`);
  }
  const root = value as Record<string, unknown>;
  const problems: string[] = [];
  if (root.schema !== REGISTRY_SCHEMA) problems.push(`schema must be "${REGISTRY_SCHEMA}", not ${JSON.stringify(root.schema)}`);
  const caps = readCaps(root.caps, problems);
  if (!Array.isArray(root.scenarios)) problems.push("scenarios must be an array");

  const seen = new Set<string>();
  const scenarios: RegisteredScenario[] = [];
  (Array.isArray(root.scenarios) ? root.scenarios : []).forEach((raw, index) => {
    const entry = readScenario(raw, `scenarios[${index}]`, problems);
    if (!entry) return;
    if (seen.has(entry.id)) problems.push(`scenarios[${index}] (${entry.id}): id repeats an earlier entry`);
    seen.add(entry.id);
    scenarios.push(entry);
  });
  if (problems.length || !caps) {
    throw new Error(`${source} does not have the shape rigd runs from:\n  - ${problems.join("\n  - ")}`);
  }
  return { caps, scenarios, byId: new Map(scenarios.map((entry) => [entry.id, entry])) };
}

function readCaps(raw: unknown, problems: string[]): RegistryCaps | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    problems.push("caps must be an object");
    return undefined;
  }
  const b = raw as Record<string, unknown>;
  const before = problems.length;
  for (const key of ["daily_cap", "hourly_cap"]) {
    if (!isCount(b[key]) || b[key] === 0) problems.push(`caps.${key} must be a whole number above 0`);
  }
  const window = b.window_utc;
  const validWindow =
    Array.isArray(window) &&
    window.length === 2 &&
    window.every((hour) => isCount(hour) && hour <= 24) &&
    window[0] < 24 &&
    window[0] !== window[1] % 24;
  if (!validWindow) problems.push("caps.window_utc must be [start, end] in whole UTC hours");
  if (problems.length > before) return undefined;
  const [start, end] = window as [number, number];
  return {
    daily: b.daily_cap as number,
    hourly: b.hourly_cap as number,
    window: { startHour: start, hours: (end - start + 24) % 24 },
  };
}

function readScenario(raw: unknown, where: string, problems: string[]): RegisteredScenario | undefined {
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
  for (const key of ["dials", "far_end_legs", "min_room"]) {
    if (!isCount(entry[key])) bad(key, "a whole number, 0 or more");
  }
  if (!Array.isArray(entry.runs) || entry.runs.length === 0) bad("runs", "a list of at least one run");
  if (problems.length > before) return undefined;

  const runs: RunSlot[] = [];
  (entry.runs as unknown[]).forEach((rawRun, index) => {
    const run = (rawRun ?? {}) as Record<string, unknown>;
    if (run.label !== undefined && typeof run.label !== "string") problems.push(`${label} runs[${index}]: label must be a string`);
    runs.push({ index, ...(typeof run.label === "string" ? { label: run.label } : {}) });
  });
  if (problems.length > before) return undefined;
  return {
    id: entry.id as string,
    lane: entry.lane as string,
    runsOn: entry.runs_on as RunsOn,
    dials: entry.dials as number,
    far_end_legs: entry.far_end_legs as number,
    room_min: entry.min_room as number,
    paid: (entry.dials as number) + (entry.far_end_legs as number) > 0,
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

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
