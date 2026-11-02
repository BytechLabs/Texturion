/**
 * What may be dialled now: the guard's caps, the room and the quiet window.
 *
 * The guard enforces all three. rigd checks first so a run it would refuse is
 * never started. Nothing here says when a run happens: runs are asked for.
 *
 * Hours and days are counted the way the guard counts them: a clock hour and
 * a UTC day, not a sliding 60 minutes.
 */
import { dialsPerRun, type RegisteredScenario } from "./registry.ts";

/** The guard's lease-log endpoints that place a leg: a dial and a transfer. */
const DIAL_ENDPOINTS: ReadonlySet<string> = new Set(["POST /v2/calls", "POST /v2/calls/:id/actions/transfer"]);

export interface DialCaps {
  daily: number;
  hourly: number;
}

/**
 * Room decides which call scenarios may run at all: the account's concurrent
 * limit minus production's reserve. At 1 or less no paid call runs.
 */
export function blockedByRoom(entry: RegisteredScenario, room: number): boolean {
  if (dialsPerRun(entry) === 0) return false;
  return room <= 1 || entry.room_min > room;
}

/**
 * Dials a lease's log shows reached Telnyx. The log counts requests as
 * `<caller> <METHOD> <path> <outcome>`, the outcome being Telnyx's status or
 * the guard's rule. A guard rule refused the dial and a 4xx is Telnyx
 * refusing it, so neither placed anything; the guard gives those back too. A
 * 2xx, a 5xx and an error that left the answer unknown count.
 */
export function dialsInLog(activity: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const [key, count] of Object.entries(activity)) {
    const [, method = "", path = "", outcome = ""] = key.split(" ");
    if (!DIAL_ENDPOINTS.has(`${method} ${path}`)) continue;
    if (/^4\d\d$/.test(outcome) || !(/^\d+$/.test(outcome) || outcome === "error")) continue;
    total += count;
  }
  return total;
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
