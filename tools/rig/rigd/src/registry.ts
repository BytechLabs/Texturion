/**
 * tools/rig/scenarios.json, the scenario registry, read and checked before
 * anything is scheduled. A registry that does not have the expected shape stops
 * rigd with every problem listed: a scheduler that guessed would dial at the
 * wrong time.
 *
 * Each entry is `{ id, frequency, dials, lane, room_min, paid }`, plus an
 * optional `far_end_legs`: a run's dials are its dials plus its far-end
 * legs. Other keys are allowed and ignored.
 */
import { readFileSync } from "node:fs";

export interface ScenarioEntry {
  id: string;
  frequency: string;
  dials: number;
  lane: string;
  room_min: number;
  paid: boolean;
  far_end_legs?: number;
}

export type Cadence =
  /** Every `everyMinutes`, on the clock: 15 min, hourly, 4 times a day. */
  | { kind: "interval"; everyMinutes: number }
  /** Once a day or less: every `everyDays` days. Monthly is 30. */
  | { kind: "days"; everyDays: number }
  /** `times` runs a week on fixed weekdays. */
  | { kind: "per-week"; times: number }
  /** Not run by the rig's timers: on every push, or in production. */
  | { kind: "unscheduled"; reason: string };

export interface RegisteredScenario extends ScenarioEntry {
  cadence: Cadence;
}

const DAY_MINUTES = 24 * 60;

const KEYWORDS: Record<string, Cadence> = {
  hourly: { kind: "interval", everyMinutes: 60 },
  daily: { kind: "days", everyDays: 1 },
  weekly: { kind: "days", everyDays: 7 },
  fortnightly: { kind: "days", everyDays: 14 },
  biweekly: { kind: "days", everyDays: 14 },
  monthly: { kind: "days", everyDays: 30 },
  push: { kind: "unscheduled", reason: "runs on every push, in CI" },
  "every-push": { kind: "unscheduled", reason: "runs on every push, in CI" },
  production: { kind: "unscheduled", reason: "runs in production, not on the rig" },
  "hourly-production": { kind: "unscheduled", reason: "runs in production, not on the rig" },
  "daily-production": { kind: "unscheduled", reason: "runs in production, not on the rig" },
};

export const FREQUENCY_FORMS =
  "15m, 30m, 1h, 6h, 1d, 3d, 2w, 4/day, 2/week, every-3-days, hourly, daily, weekly, fortnightly, monthly, push, production";

export function parseFrequency(text: string): Cadence {
  const value = text.trim().toLowerCase();
  const keyword = KEYWORDS[value];
  if (keyword) return keyword;
  const unit = /^(?:every[\s-]+)?(\d+)[\s-]*(m|min|mins|minutes?|h|hours?|d|days?|w|weeks?)$/.exec(value);
  if (unit) {
    const n = Number(unit[1]);
    const u = unit[2]!;
    if (n < 1) throw new Error(`frequency "${text}" must be at least 1`);
    if (u.startsWith("m")) return interval(n, text);
    if (u.startsWith("h")) return n % 24 === 0 ? { kind: "days", everyDays: n / 24 } : interval(n * 60, text);
    if (u.startsWith("d")) return { kind: "days", everyDays: n };
    return { kind: "days", everyDays: 7 * n };
  }
  const perDay = /^(\d+)\s*(?:\/|x|times?\s+(?:a|per)\s+)\s*day$/.exec(value);
  if (perDay) {
    const n = Number(perDay[1]);
    if (n < 1 || DAY_MINUTES % n !== 0) throw new Error(`frequency "${text}": ${n} runs do not divide a day evenly`);
    return n === 1 ? { kind: "days", everyDays: 1 } : interval(DAY_MINUTES / n, text);
  }
  const perWeek = /^(\d+)\s*(?:\/|x|times?\s+(?:a|per)\s+)\s*week$/.exec(value);
  if (perWeek) {
    const n = Number(perWeek[1]);
    if (n < 1 || n > 7) throw new Error(`frequency "${text}": a week holds 1 to 7 runs`);
    return n === 1 ? { kind: "days", everyDays: 7 } : { kind: "per-week", times: n };
  }
  throw new Error(`frequency "${text}" is not one the scheduler reads; use one of: ${FREQUENCY_FORMS}`);
}

/** A sub-daily cadence must land on the clock the same way every day. */
function interval(minutes: number, text: string): Cadence {
  if (minutes >= DAY_MINUTES) {
    if (minutes % DAY_MINUTES) throw new Error(`frequency "${text}" is not a whole number of days`);
    return { kind: "days", everyDays: minutes / DAY_MINUTES };
  }
  if (DAY_MINUTES % minutes !== 0 || (minutes < 60 && 60 % minutes !== 0) || (minutes > 60 && minutes % 60 !== 0)) {
    throw new Error(`frequency "${text}" does not divide the day evenly; use one of: ${FREQUENCY_FORMS}`);
  }
  return { kind: "interval", everyMinutes: minutes };
}

export function runsPerMonth(cadence: Cadence): number {
  switch (cadence.kind) {
    case "interval":
      return (30 * DAY_MINUTES) / cadence.everyMinutes;
    case "days":
      return 30 / cadence.everyDays;
    case "per-week":
      return (cadence.times * 30) / 7;
    case "unscheduled":
      return 0;
  }
}

const ID = /^[A-Z]{1,3}\d{2,3}[a-z]?$/;
const REQUIRED = ["id", "frequency", "dials", "lane", "room_min", "paid"] as const;

/** Every problem at once, so one fix-up round is enough. */
export function validateRegistry(value: unknown, source = "scenarios.json"): RegisteredScenario[] {
  if (!Array.isArray(value)) throw new Error(`${source}: the registry must be a JSON array of scenarios`);
  const problems: string[] = [];
  const seen = new Set<string>();
  const out: RegisteredScenario[] = [];
  value.forEach((raw, index) => {
    const where = `${source}[${index}]`;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`${where}: not an object`);
      return;
    }
    const entry = raw as Record<string, unknown>;
    const missing = REQUIRED.filter((key) => !(key in entry));
    if (missing.length) {
      problems.push(`${where}: missing ${missing.join(", ")}`);
      return;
    }
    const id = entry.id;
    const label = typeof id === "string" ? `${where} (${id})` : where;
    const bad = (key: string, wanted: string) => problems.push(`${label}: ${key} must be ${wanted}`);
    if (typeof id !== "string" || !ID.test(id)) bad("id", "a scenario id like S02 or D02p");
    else if (seen.has(id)) problems.push(`${label}: id repeats an earlier entry`);
    else seen.add(id);
    if (typeof entry.frequency !== "string") bad("frequency", "a string");
    if (!isCount(entry.dials)) bad("dials", "a whole number of dials, 0 or more");
    if (typeof entry.lane !== "string" || entry.lane.trim() === "") bad("lane", "a non-empty string");
    if (!isCount(entry.room_min)) bad("room_min", "a whole number, 0 or more");
    if (typeof entry.paid !== "boolean") bad("paid", "true or false");
    if (entry.far_end_legs !== undefined && !isCount(entry.far_end_legs)) bad("far_end_legs", "a whole number, 0 or more");
    // A dial outside the window is the failure the window exists to prevent.
    if (isCount(entry.dials) && entry.dials > 0 && entry.paid === false) {
      problems.push(`${label}: dials ${entry.dials} but paid is false; every dial is paid and runs only in the window`);
    }
    let cadence: Cadence | undefined;
    if (typeof entry.frequency === "string") {
      try {
        cadence = parseFrequency(entry.frequency);
      } catch (error) {
        problems.push(`${label}: ${(error as Error).message}`);
      }
    }
    if (cadence && problems.length === 0) {
      out.push({
        id: id as string,
        frequency: entry.frequency as string,
        dials: entry.dials as number,
        lane: entry.lane as string,
        room_min: entry.room_min as number,
        paid: entry.paid as boolean,
        ...(entry.far_end_legs === undefined ? {} : { far_end_legs: entry.far_end_legs as number }),
        cadence,
      });
    }
  });
  if (problems.length) {
    throw new Error(`${source} does not have the shape rigd schedules from:\n  - ${problems.join("\n  - ")}`);
  }
  return out;
}

export function loadRegistry(path: string): RegisteredScenario[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`);
  }
  return validateRegistry(parsed, path);
}

/** Dials one run spends at Telnyx. */
export function dialsPerRun(entry: ScenarioEntry): number {
  return entry.dials + (entry.far_end_legs ?? 0);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
