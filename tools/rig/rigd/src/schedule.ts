/**
 * systemd timers for the scenario registry, all in UTC.
 *
 * A paid run fires daily at its registry hour, moved with the window when the
 * guard has measured a different one, and the run itself checks that the day
 * is one of its period's (registry.ts). Runs that share an hour on some day
 * get minutes 20 apart, and the lease makes a later one wait for an earlier
 * one. A text or push check fires at any hour: a cadence of a day or longer
 * daily, the run checking it is due, so a run lost to an outage happens the
 * next day rather than next week. A `night` run and a `daytime` run sit at
 * hours that are night and day on every North American mainland clock.
 *
 * Room is not decided here: the run reads it when it starts, so a timer exists
 * for every scenario the rig can run and a room that grows needs no new units.
 *
 * They are user units beside the `rig` CLI's own (tools/rig/box/systemd/user):
 * `loonext-rig-*`, with RIG_HOME in the environment and the tooling checkout's
 * node and paths.
 */
import { dirname } from "node:path";
import { dialBudget, slotHour, type DialWindow } from "./budget.ts";
import { dialsPerRun, notOnRigBecause, type RegisteredScenario, type Registry, type RunSlot } from "./registry.ts";

export interface ScheduleOptions {
  /** The window paid runs fire in: the guard's measured one, else the registry's. */
  window: DialWindow;
  /** Scenarios rigd has a runner for; the rest are listed, not timed. */
  runnable: ReadonlySet<string>;
  /** Why a written runner is not runnable yet, by scenario. */
  notRunnable?: Readonly<Record<string, string>>;
  /** e.g. /usr/local/bin/node */
  node: string;
  /** Absolute path of tools/rig/rigd/src/cli.ts on the rig. */
  cli: string;
  /** RIG_HOME, e.g. /var/lib/loonext-rig. */
  home: string;
}

export interface Unit {
  name: string;
  content: string;
}

export interface Schedule {
  units: Unit[];
  timed: { id: string; instance: string; onCalendar: string[] }[];
  notTimed: { id: string; reason: string }[];
}

/** Minutes a paid hour's runs start at, in the order they are handed out. */
const PAID_MINUTES = [2, 22, 42, 12, 32, 52, 7, 27, 47, 17, 37, 57];
const NIGHT_HOUR = 5;
const DAYTIME_HOUR = 17;
const DAY_MINUTES = 24 * 60;

/** The systemd instance of a scenario's run: `S20`, or `S25-2` for its second run. */
export function instanceOf(entry: Pick<RegisteredScenario, "id" | "runs">, slot: Pick<RunSlot, "index">): string {
  return entry.runs.length > 1 ? `${entry.id}-${slot.index + 1}` : entry.id;
}

/** `S20` or `S25-2` back to the scenario and its run, from 0. */
export function parseInstance(text: string): { id: string; slot: number } {
  const match = /^([A-Z]{1,3}\d{2,3}[a-z]?)(?:-([1-9]\d?))?$/.exec(text);
  if (!match) throw new Error(`"${text}" is not a scenario like S20 or S25-2`);
  return { id: match[1]!, slot: match[2] ? Number(match[2]) - 1 : 0 };
}

export function buildSchedule(registry: Registry, options: ScheduleOptions): Schedule {
  const budget = dialBudget(registry);
  if (!budget.fits) {
    throw new Error(
      `the registry's dials do not fit the budget: ${budget.total} a month with reserves, over the cap of ${budget.monthlyCap}`,
    );
  }
  const notTimed: Schedule["notTimed"] = [];
  const timedEntries: RegisteredScenario[] = [];
  for (const entry of registry.scenarios) {
    const off = notOnRigBecause(entry);
    if (off) notTimed.push({ id: entry.id, reason: off });
    else if (!options.runnable.has(entry.id)) {
      notTimed.push({ id: entry.id, reason: options.notRunnable?.[entry.id] ?? "no runner in rigd yet" });
    } else timedEntries.push(entry);
  }

  const paidMinute = assignPaidMinutes(timedEntries.filter((entry) => dialsPerRun(entry) > 0));
  const timed: Schedule["timed"] = [];
  const units: Unit[] = [serviceTemplate(options), ...daemonUnits(options)];
  let freeIndex = 0;
  for (const entry of timedEntries) {
    for (const slot of entry.runs) {
      if (slot.everyMinutes === 0) continue;
      const instance = instanceOf(entry, slot);
      const onCalendar =
        dialsPerRun(entry) > 0
          ? [`*-*-* ${pad(slotHour(slot, registry.budget.window, options.window))}:${pad(paidMinute.get(instance)!)}:00 UTC`]
          : freeCalendar(slot, freeIndex++);
      timed.push({ id: entry.id, instance, onCalendar });
      units.push({ name: `loonext-rig-scenario-${instance}.timer`, content: timerUnit(entry, slot, instance, onCalendar) });
    }
  }
  return { units, timed, notTimed };
}

/**
 * Paid runs that can fall on the same day and hour get different minutes. Two
 * runs every `a` and `b` days at offsets `x` and `y` meet on some day exactly
 * when x and y agree modulo gcd(a, b).
 */
function assignPaidMinutes(entries: RegisteredScenario[]): Map<string, number> {
  const runs = entries.flatMap((entry) => entry.runs.map((slot) => ({ entry, slot, instance: instanceOf(entry, slot) })));
  const assigned = new Map<string, number>();
  for (const run of runs) {
    const taken = new Set(
      runs
        .filter((other) => assigned.has(other.instance) && other.slot.hourUtc === run.slot.hourUtc && meet(run.slot, other.slot))
        .map((other) => assigned.get(other.instance)!),
    );
    const minute = PAID_MINUTES.find((m) => !taken.has(m));
    if (minute === undefined) throw new Error(`${run.instance}: more paid runs share ${pad(run.slot.hourUtc ?? 0)}:00 than an hour can start apart`);
    assigned.set(run.instance, minute);
  }
  return assigned;
}

function meet(a: RunSlot, b: RunSlot): boolean {
  const days = (slot: RunSlot) => slot.everyMinutes / DAY_MINUTES;
  const g = gcd(days(a), days(b));
  return ((((a.offsetDays ?? 0) - (b.offsetDays ?? 0)) % g) + g) % g === 0;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function freeCalendar(slot: RunSlot, index: number): string[] {
  const every = slot.everyMinutes;
  if (every < 60) {
    if (60 % every !== 0) throw new Error(`a run every ${slot.every} does not divide the hour`);
    return [`*-*-* *:${pad((11 + index) % every)}/${every}:00 UTC`];
  }
  if (every < DAY_MINUTES) {
    if (every % 60 !== 0 || DAY_MINUTES % every !== 0) throw new Error(`a run every ${slot.every} does not divide the day`);
    const step = every / 60;
    const minute = (13 * 60 + 11 + 11 * index) % DAY_MINUTES;
    const first = Math.floor(minute / 60) % step;
    const hours = Array.from({ length: 24 / step }, (_, i) => pad(first + i * step));
    return [`*-*-* ${hours.join(",")}:${pad(minute % 60)}:00 UTC`];
  }
  const minute = (13 * 60 + 11 + 11 * index) % DAY_MINUTES;
  const hour = slot.label === "night" ? NIGHT_HOUR : slot.label === "daytime" ? DAYTIME_HOUR : Math.floor(minute / 60);
  return [`*-*-* ${pad(hour)}:${pad(minute % 60)}:00 UTC`];
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function timerUnit(entry: RegisteredScenario, slot: RunSlot, instance: string, onCalendar: string[]): string {
  const dials = dialsPerRun(entry);
  return [
    "[Unit]",
    `Description=Loonext rig: scenario ${instance} (every ${slot.every}${slot.label ? `, ${slot.label}` : ""}, ${dials} dial${dials === 1 ? "" : "s"}, lane ${entry.lane})`,
    "",
    "[Timer]",
    ...onCalendar.map((spec) => `OnCalendar=${spec}`),
    // A missed run catches up after a reboot; a paid one that lands outside
    // the window, or on a day not its own, is refused by the run itself.
    "Persistent=true",
    "AccuracySec=1min",
    `Unit=loonext-rig-scenario@${instance}.service`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

/** The node the units run comes first, so `pnpm` and other `#!/usr/bin/env node` tools find it too. */
function environment(options: ScheduleOptions): string[] {
  const path = [...new Set([dirname(options.node), "/usr/local/bin", "/usr/bin", "/bin"])].join(":");
  return [`Environment=RIG_HOME=${options.home}`, `Environment=PATH=${path}`];
}

function serviceTemplate(options: ScheduleOptions): Unit {
  return {
    name: "loonext-rig-scenario@.service",
    content: [
      "[Unit]",
      "Description=Loonext rig: scenario %i",
      "After=loonext-rig-rigd.service loonext-rig-robotd.service loonext-rig-api.service",
      "",
      "[Service]",
      "Type=oneshot",
      ...environment(options),
      `ExecStart=${options.node} ${options.cli} run %i --scheduled`,
      // Up to 20 minutes for the lease, two attempts each bounded below the
      // lease's 15 minutes, and a retry that may wait for a later hour of the
      // window with room in it.
      "TimeoutStartSec=8h",
      "Nice=5",
      "",
    ].join("\n"),
  };
}

function daemonUnits(options: ScheduleOptions): Unit[] {
  const service = (name: string, description: string, exec: string, after: string): Unit => ({
    name,
    content: [
      "[Unit]",
      `Description=${description}`,
      `After=${after}`,
      "",
      "[Service]",
      ...environment(options),
      `ExecStart=${exec}`,
      "Restart=always",
      "RestartSec=5s",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n"),
  });
  const robotMain = options.cli.replace(/rigd[\\/]src[\\/]cli\.ts$/, "robot/src/main.ts");
  return [
    service(
      "loonext-rig-rigd.service",
      "Loonext rig: rigd (uplink, lease watchdog, Sentry relay, secret delivery)",
      `${options.node} ${options.cli} daemon`,
      "loonext-rig-stack.service",
    ),
    service(
      "loonext-rig-robotd.service",
      "Loonext rig: robotd (ROBOT-1, ROBOT-2 and STRANGER-1)",
      `${options.node} ${robotMain}`,
      "loonext-rig-rigd.service",
    ),
  ];
}
