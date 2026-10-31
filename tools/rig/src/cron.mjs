/**
 * `rig cron <expr> [--time <ms>]`, and the timers that call it.
 *
 * The rig's derived config has no crons, so nothing fires on wrangler's own
 * clock; the rig fires each one through the route wrangler dev serves for
 * that, at the minute it was due or at any instant an agent picks.
 * /cdn-cgi/handler/scheduled is what the pinned wrangler answers, and it
 * takes `time` in milliseconds. /__scheduled (served with --test-scheduled)
 * is the fallback for one that does not, and it ignores `time`: the job runs
 * at the wall clock. Both checked against wrangler 4.106.0 on 2026-10-31.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { TOOLING_ROOT } from "./layout.mjs";

export const SCHEDULED_ROUTES = ["/cdn-cgi/handler/scheduled", "/__scheduled"];

/** Cloudflare hands a cron its scheduled minute, not the moment it ran. */
export function scheduledMinute(now = Date.now()) {
  return Math.floor(now / 60_000) * 60_000;
}

export function scheduledUrl(origin, route, cron, time) {
  const params = new URLSearchParams({ cron, time: String(time) });
  return `${origin}${route}?${params.toString()}`;
}

/**
 * @returns {Promise<{ route: string, status: number, body: string, timeHonored: boolean }>}
 */
export async function fireCron(origin, cron, time, fetchImpl = fetch) {
  let last;
  for (const route of SCHEDULED_ROUTES) {
    const response = await fetchImpl(scheduledUrl(origin, route, cron, time));
    const body = await response.text();
    last = { route, status: response.status, body, timeHonored: route === SCHEDULED_ROUTES[0] };
    if (response.status !== 404) return last;
  }
  return last;
}

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function calendarField(text, field, pad) {
  if (text === "*") return "*";
  const out = [];
  for (const part of text.split(",")) {
    const match = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!match) throw new Error(`rig cron: "${text}" is not a ${field.name} this rig can schedule`);
    const [, start, end, step] = match;
    // systemd repeats from a start value ("00/5") and has no stepped range.
    if (end !== undefined && step !== undefined) {
      throw new Error(`rig cron: ${field.name} ${part} is a stepped range, which systemd cannot express`);
    }
    const from = start === "*" ? field.min : Number(start);
    const to = end === undefined ? from : Number(end);
    if (from < field.min || to > field.max || from > to) {
      throw new Error(`rig cron: ${field.name} ${part} is out of range`);
    }
    const p = (value) => String(value).padStart(pad, "0");
    if (step !== undefined) out.push(`${p(from)}/${Number(step)}`);
    else if (start === "*") return "*";
    else out.push(end === undefined ? p(from) : `${p(from)}..${p(to)}`);
  }
  return out.join(",");
}

/**
 * A five-field cron as systemd's OnCalendar, in UTC like Cloudflare's.
 * Only the subset the repo's crons use, and refused rather than approximated
 * outside it.
 */
export function cronToOnCalendar(cron) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`rig cron: "${cron}" does not have five fields`);
  const [minute, hour, dom, month, dow] = parts;
  // Cron ORs a restricted day of month with a restricted weekday; systemd ANDs them.
  if (dom !== "*" && dow !== "*") throw new Error(`rig cron: "${cron}" restricts both days, which systemd reads differently`);
  const time = `${calendarField(hour, FIELDS[1], 2)}:${calendarField(minute, FIELDS[0], 2)}:00`;
  const date = `*-${calendarField(month, FIELDS[3], 2)}-${calendarField(dom, FIELDS[2], 2)}`;
  let weekday = "";
  if (dow !== "*") {
    weekday = `${dow
      .split(",")
      .map((part) => {
        const range = /^(\d)(?:-(\d))?$/.exec(part);
        if (!range) throw new Error(`rig cron: day of week ${part} is not one this rig can schedule`);
        return range[2] === undefined ? WEEKDAYS[Number(range[1])] : `${WEEKDAYS[Number(range[1])]}..${WEEKDAYS[Number(range[2])]}`;
      })
      .join(",")} `;
  }
  return `${weekday}${date} ${time} UTC`;
}

export const API_CONFIG = "apps/api/wrangler.jsonc";

/**
 * The class tools/rig/crons.json gives each of one config's crons. The file is
 * `{ crons: [{ config, cron, class }] }` (a bare list is read too). A missing
 * file, or one this cannot read, is refused: either would otherwise leave
 * every cron without a timer while the deploy succeeds.
 */
export function registryClasses(registry, config = API_CONFIG) {
  if (registry === null || registry === undefined) {
    throw new Error("rig: tools/rig/crons.json is missing, so no cron would get a timer");
  }
  const entries = Array.isArray(registry) ? registry : registry.crons;
  if (!Array.isArray(entries)) throw new Error("rig: tools/rig/crons.json has no list of crons");
  const classOf = new Map();
  for (const entry of entries) {
    if (entry?.config !== undefined && entry.config !== config) continue;
    if (typeof entry?.cron !== "string" || typeof entry.class !== "string") {
      throw new Error("rig: a tools/rig/crons.json entry has no cron or no class");
    }
    classOf.set(entry.cron.trim(), entry.class);
  }
  if (classOf.size === 0) throw new Error(`rig: tools/rig/crons.json classifies none of ${config}'s crons`);
  return classOf;
}

/**
 * Which of a ref's crons get a timer. A skip gets none; nor does a cron the
 * registry does not name, because an unclassified cron is exactly what R00
 * must not run blind. `rig health` fails while any is unclassified.
 */
export function cronsToSchedule(crons, registry) {
  const classOf = registryClasses(registry);
  const schedule = [];
  const unclassified = [];
  const skipped = [];
  for (const cron of crons) {
    const kind = classOf.get(cron.trim());
    if (kind === undefined) unclassified.push(cron);
    else if (/^skip/.test(kind)) skipped.push(cron);
    else schedule.push(cron);
  }
  return { schedule, unclassified, skipped };
}

/** The timer unit each scheduled cron gets, in a stable order. */
export function cronTimers(schedule) {
  return schedule.map((cron, index) => {
    const slug = `c${String(index).padStart(2, "0")}`;
    return { cron, slug, timer: `loonext-rig-cron-${slug}.timer` };
  });
}

export function readCronRegistry(root = TOOLING_ROOT) {
  const path = join(root, "tools", "rig", "crons.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/** A user-level timer and service pair for one cron. */
export function cronUnits({ cron, slug, node, rigBin }) {
  const escaped = cron.replace(/%/g, "%%");
  return {
    service: [
      "[Unit]",
      `Description=Loonext rig cron ${escaped}`,
      "After=loonext-rig-api.service",
      "Requires=loonext-rig-api.service",
      "",
      "[Service]",
      "Type=oneshot",
      `ExecStart=${node} ${rigBin} cron "${escaped}"`,
      "",
    ].join("\n"),
    timer: [
      "[Unit]",
      `Description=Fires the Loonext rig cron ${escaped}`,
      "",
      "[Timer]",
      `OnCalendar=${cronToOnCalendar(cron)}`,
      "AccuracySec=1s",
      // Cloudflare does not replay a tick the Worker missed, so neither does the rig.
      "Persistent=false",
      `Unit=loonext-rig-cron-${slug}.service`,
      "",
      "[Install]",
      "WantedBy=timers.target",
      "",
    ].join("\n"),
  };
}
