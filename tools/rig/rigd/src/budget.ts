/**
 * The dial budget, room and window.
 *
 * Rule: scheduled dials times their frequency, plus a 20% retry reserve, plus
 * a 60-dial monthly repro reserve, must fit the daily cap times 30. Until
 * Telnyx states the limits in writing the cap is 18 dials a day and 3 an hour.
 * The guard enforces all of this too; rigd checks first so a run it would
 * refuse is never started.
 */
import { dialsPerRun, runsPerMonth, type RegisteredScenario } from "./registry.ts";

export const DEFAULT_DIAL_CAPS = { daily: 18, hourly: 3 } as const;
export const RETRY_RESERVE = 0.2;
export const REPRO_RESERVE_DIALS = 60;

export interface DialCaps {
  daily: number;
  hourly: number;
}

export interface BudgetReport {
  scheduledDials: number;
  retryReserve: number;
  reproReserve: number;
  total: number;
  monthlyCap: number;
  fits: boolean;
  byScenario: { id: string; runs: number; dials: number }[];
}

export function dialBudget(entries: readonly RegisteredScenario[], caps: DialCaps = DEFAULT_DIAL_CAPS): BudgetReport {
  const byScenario = entries
    .filter((entry) => entry.cadence.kind !== "unscheduled" && dialsPerRun(entry) > 0)
    .map((entry) => {
      const runs = runsPerMonth(entry.cadence);
      return { id: entry.id, runs: round2(runs), dials: round2(runs * dialsPerRun(entry)) };
    });
  const scheduledDials = round2(byScenario.reduce((sum, s) => sum + s.dials, 0));
  const retryReserve = round2(scheduledDials * RETRY_RESERVE);
  const total = round2(scheduledDials + retryReserve + REPRO_RESERVE_DIALS);
  const monthlyCap = caps.daily * 30;
  return {
    scheduledDials,
    retryReserve,
    reproReserve: REPRO_RESERVE_DIALS,
    total,
    monthlyCap,
    fits: total <= monthlyCap,
    byScenario,
  };
}

/**
 * Room decides which call scenarios may run at all: the account's concurrent
 * limit minus production's reserve. At 1 or less no paid call runs.
 */
export function blockedByRoom(entry: RegisteredScenario, room: number): boolean {
  if (dialsPerRun(entry) === 0) return false;
  return room <= 1 || entry.room_min > room;
}

/** The six quietest UTC hours, measured monthly; 04:00-10:00 until there is data. */
export interface DialWindow {
  startHour: number;
  hours: number;
}

export const DEFAULT_WINDOW: DialWindow = { startHour: 4, hours: 6 };

export function parseWindow(text: string | undefined): DialWindow {
  if (!text) return DEFAULT_WINDOW;
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!match) throw new Error(`dial window "${text}" must be HH-HH in UTC, e.g. 04-10`);
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > 23 || end > 24 || start === end % 24) throw new Error(`dial window "${text}" is not a span of hours`);
  return { startHour: start, hours: (end - start + 24) % 24 };
}

export function windowHours(window: DialWindow): number[] {
  return Array.from({ length: window.hours }, (_, i) => (window.startHour + i) % 24);
}

export function inWindow(window: DialWindow, at: number): boolean {
  return windowHours(window).includes(new Date(at).getUTCHours());
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
