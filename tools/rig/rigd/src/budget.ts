/**
 * The dial budget, room and window, all from the registry's `budget`.
 *
 * Rule: scheduled dials times their runs a month, plus the
 * retry reserve, plus the monthly repro reserve, must fit the daily cap times
 * the month's days. The guard enforces the caps too; rigd checks first so a
 * run it would refuse is never started.
 *
 * Hours and days are counted the way the guard counts them: a clock hour and
 * a UTC day, not a sliding 60 minutes, so the registry's hour-by-hour layout
 * means the same thing to the scheduler, the runner and the guard.
 */
import { dialsPerRun, runsPerMonth, timedOnRig, type RegisteredScenario, type Registry, type RunSlot } from "./registry.ts";

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

export function dialBudget(registry: Registry, caps: DialCaps = registry.budget): BudgetReport {
  const { budget } = registry;
  const byScenario = registry.scenarios
    .filter((entry) => entry.scheduled && dialsPerRun(entry) > 0)
    .map((entry) => {
      const runs = entry.runs.reduce((sum, slot) => sum + runsPerMonth(slot, budget.daysPerMonth), 0);
      return { id: entry.id, runs: round2(runs), dials: round2(runs * dialsPerRun(entry)) };
    });
  const scheduledDials = round2(byScenario.reduce((sum, s) => sum + s.dials, 0));
  const retryReserve = round2(scheduledDials * budget.retryReserve);
  const total = round2(scheduledDials + retryReserve + budget.reproReserveDials);
  const monthlyCap = caps.daily * budget.daysPerMonth;
  return {
    scheduledDials,
    retryReserve,
    reproReserve: budget.reproReserveDials,
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

/** The quietest UTC hours, measured monthly by the guard; the registry's until there is data. */
export interface DialWindow {
  startHour: number;
  hours: number;
}

/** `HH-HH` in UTC, e.g. 04-10. */
export function parseWindow(text: string): DialWindow {
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

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function clockHourStart(at: number): number {
  return Math.floor(at / HOUR_MS) * HOUR_MS;
}

export function utcDayStart(at: number): number {
  return Math.floor(at / DAY_MS) * DAY_MS;
}

/**
 * The day a paid run belongs to: the one whose window opening is the latest at
 * or before `at`. With a window from 04:00 this is the UTC day; with one that
 * crosses midnight, its small hours stay on the evening's day.
 */
export function windowDay(at: number, window: DialWindow): number {
  return Math.floor((at - window.startHour * HOUR_MS) / DAY_MS);
}

/**
 * The UTC hour a paid slot fires at: its place in the registry's window,
 * moved with the window when the guard has measured a different one.
 */
export function slotHour(slot: RunSlot, registryWindow: DialWindow, window: DialWindow): number {
  return ((slot.hourUtc ?? registryWindow.startHour) - registryWindow.startHour + window.startHour + 24) % 24;
}

/** Whether a paid slot is laid out on this window day. */
export function slotDueOn(slot: RunSlot, day: number): boolean {
  const every = slot.everyMinutes / (24 * 60);
  return Number.isInteger(every) && every >= 1 && ((day % every) + every) % every === (slot.offsetDays ?? 0);
}

export interface PlannedRun {
  scenario: string;
  slot: number;
  hour: number;
  dials: number;
}

/** The paid runs the registry lays out on one window day, hour by hour. */
export function plannedRuns(registry: Registry, day: number, window: DialWindow, runnable?: ReadonlySet<string>): PlannedRun[] {
  const planned: PlannedRun[] = [];
  for (const entry of registry.scenarios) {
    if (!timedOnRig(entry) || dialsPerRun(entry) === 0) continue;
    if (runnable && !runnable.has(entry.id)) continue;
    for (const slot of entry.runs) {
      if (!slotDueOn(slot, day)) continue;
      planned.push({ scenario: entry.id, slot: slot.index, hour: slotHour(slot, registry.budget.window, window), dials: dialsPerRun(entry) });
    }
  }
  return planned;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
