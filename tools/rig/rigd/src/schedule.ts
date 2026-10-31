/**
 * systemd timers for the scenario registry, all in UTC.
 *
 * A paid scenario's timer fires only inside the dial window; a text or push
 * check fires at any hour. Cadences of a day or longer fire daily at their slot
 * and the run checks it is due, so a run skipped by an outage or a busy lease
 * happens the next day rather than next month. Slots are spread so two paid
 * runs never aim at the same minute; the lease would make the second wait.
 *
 * They are user units beside the `rig` CLI's own (tools/rig/box/systemd/user):
 * `loonext-rig-*`, with RIG_HOME in the environment and the tooling checkout's
 * node and paths.
 */
import { blockedByRoom, dialBudget, windowHours, type DialCaps, type DialWindow } from "./budget.ts";
import { dialsPerRun, type RegisteredScenario } from "./registry.ts";

export interface ScheduleOptions {
  window: DialWindow;
  room: number;
  caps?: DialCaps;
  /** Scenarios rigd has a runner for; the rest are listed, not timed. */
  runnable: ReadonlySet<string>;
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
  timed: { id: string; onCalendar: string[] }[];
  notTimed: { id: string; reason: string }[];
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PAID_SPACING_MIN = 7;

export function buildSchedule(entries: readonly RegisteredScenario[], options: ScheduleOptions): Schedule {
  const budget = dialBudget(entries, options.caps);
  if (!budget.fits) {
    throw new Error(
      `the registry's dials do not fit the budget: ${budget.total} a month with reserves, over the cap of ${budget.monthlyCap}`,
    );
  }
  const notTimed: Schedule["notTimed"] = [];
  const timedEntries: RegisteredScenario[] = [];
  for (const entry of entries) {
    if (entry.cadence.kind === "unscheduled") notTimed.push({ id: entry.id, reason: entry.cadence.reason });
    else if (!options.runnable.has(entry.id)) notTimed.push({ id: entry.id, reason: "no runner in rigd yet" });
    else if (blockedByRoom(entry, options.room)) {
      notTimed.push({ id: entry.id, reason: `needs room ${Math.max(2, entry.room_min)}, the account has ${options.room}` });
    } else timedEntries.push(entry);
  }

  const windowStart = options.window.startHour * 60;
  const windowMinutes = options.window.hours * 60;
  const paid = timedEntries.filter((entry) => entry.paid);
  const paidStep = paid.length ? Math.max(PAID_SPACING_MIN, Math.floor(windowMinutes / paid.length / 5) * 5) : 0;
  // The last paid run must still start a quarter of an hour before the window shuts.
  if (paid.length && 5 + (paid.length - 1) * paidStep > windowMinutes - 15) {
    throw new Error(`${paid.length} paid scenarios cannot be spread ${PAID_SPACING_MIN} minutes apart in a ${options.window.hours} h window`);
  }
  let paidIndex = 0;
  let freeIndex = 0;
  const allowedHours = windowHours(options.window);

  const timed: Schedule["timed"] = [];
  const units: Unit[] = [serviceTemplate(options), ...daemonUnits(options)];
  for (const entry of timedEntries) {
    const slot = entry.paid
      ? windowStart + 5 + paidStep * paidIndex++
      : (13 * 60 + 11 * freeIndex++) % (24 * 60);
    const onCalendar = calendar(entry, slot, entry.paid ? allowedHours : undefined);
    timed.push({ id: entry.id, onCalendar });
    units.push({ name: `loonext-rig-scenario-${entry.id}.timer`, content: timerUnit(entry, onCalendar) });
  }
  return { units, timed, notTimed };
}

function calendar(entry: RegisteredScenario, slotMinute: number, allowedHours: number[] | undefined): string[] {
  const hh = (minute: number) => String(Math.floor(minute / 60) % 24).padStart(2, "0");
  const mm = (minute: number) => String(minute % 60).padStart(2, "0");
  const { cadence } = entry;
  switch (cadence.kind) {
    case "interval": {
      if (cadence.everyMinutes < 60) {
        if (allowedHours) return [`*-*-* ${allowedHours.map((h) => String(h).padStart(2, "0")).join(",")}:${slotMinute % cadence.everyMinutes}/${cadence.everyMinutes}:00 UTC`];
        return [`*-*-* *:${String(slotMinute % cadence.everyMinutes).padStart(2, "0")}/${cadence.everyMinutes}:00 UTC`];
      }
      const stepHours = cadence.everyMinutes / 60;
      const firstHour = Math.floor(slotMinute / 60) % stepHours;
      let hours = Array.from({ length: 24 / stepHours }, (_, i) => firstHour + i * stepHours);
      if (allowedHours) hours = hours.filter((h) => allowedHours.includes(h));
      if (hours.length === 0) throw new Error(`${entry.id}: no run of "${entry.frequency}" lands in the dial window`);
      return [`*-*-* ${hours.map((h) => String(h).padStart(2, "0")).join(",")}:${mm(slotMinute)}:00 UTC`];
    }
    case "days":
      return [`*-*-* ${hh(slotMinute)}:${mm(slotMinute)}:00 UTC`];
    case "per-week": {
      // Spread over the week, alternating twelve hours apart for a text check,
      // so a twice-weekly run sees both a day and a night on the destination clock.
      const step = 7 / cadence.times;
      return Array.from({ length: cadence.times }, (_, i) => {
        const day = WEEKDAYS[Math.floor(i * step) % 7]!;
        const minute = allowedHours ? slotMinute : (slotMinute + (i % 2) * 12 * 60) % (24 * 60);
        return `${day} *-*-* ${hh(minute)}:${mm(minute)}:00 UTC`;
      });
    }
    case "unscheduled":
      return [];
  }
}

function timerUnit(entry: RegisteredScenario, onCalendar: string[]): string {
  const dials = dialsPerRun(entry);
  return [
    "[Unit]",
    `Description=Loonext rig: scenario ${entry.id} (${entry.frequency}, ${dials} dial${dials === 1 ? "" : "s"}, lane ${entry.lane})`,
    "",
    "[Timer]",
    ...onCalendar.map((spec) => `OnCalendar=${spec}`),
    // A missed run catches up after a reboot; a paid one that lands outside
    // the window is refused by the run itself and tried at the next slot.
    "Persistent=true",
    "AccuracySec=1min",
    `Unit=loonext-rig-scenario@${entry.id}.service`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

function environment(options: ScheduleOptions): string[] {
  return [`Environment=RIG_HOME=${options.home}`, "Environment=PATH=/usr/local/bin:/usr/bin:/bin"];
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
      // Two attempts, each bounded below the lease's 15 minutes, and a retry
      // that may wait up to 65 minutes for the hourly dial cap.
      "TimeoutStartSec=100min",
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
