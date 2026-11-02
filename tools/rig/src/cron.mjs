/**
 * `rig cron <expr|job:name> [--time <ms>]`: fire one of the API's crons now.
 *
 * The rig's derived config has no crons, so nothing fires on wrangler's own
 * clock, and no timer fires one either. An agent fires the one it wants
 * through the route wrangler dev serves for that, at the minute it asks or at
 * any instant it picks. A cron is named by its expression, or by a job it
 * runs (`job:lead-chase`), which tools/rig/crons.json maps to its cron.
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
 * Which of a ref's crons the rig can fire. A skip is never fired; nor is a cron
 * the registry does not name, because an unclassified cron is exactly what R00
 * must not fire blind. `rig health` fails while any is unclassified.
 */
export function classifyCrons(crons, registry) {
  const classOf = registryClasses(registry);
  const fire = [];
  const unclassified = [];
  const skipped = [];
  for (const cron of crons) {
    const kind = classOf.get(cron.trim());
    if (kind === undefined) unclassified.push(cron);
    else if (/^skip/.test(kind)) skipped.push(cron);
    else fire.push(cron);
  }
  return { fire, unclassified, skipped };
}

/**
 * The cron expression `rig cron` fires for what it was given: an expression
 * as it stands, or `job:<name>` as the API config's cron that runs the job.
 * A job two crons run is refused, because which one is meant is the caller's
 * to say.
 */
export function resolveCron(arg, registry, config = API_CONFIG) {
  if (!/^job:/.test(arg)) return arg;
  const entries = Array.isArray(registry) ? registry : registry?.crons;
  if (!Array.isArray(entries)) throw new Error("rig cron: tools/rig/crons.json has no list of crons");
  const crons = entries
    .filter((entry) => (entry?.config === undefined || entry.config === config) && Array.isArray(entry.jobs) && entry.jobs.includes(arg))
    .map((entry) => entry.cron.trim());
  const unique = [...new Set(crons)];
  if (unique.length === 0) throw new Error(`rig cron: no cron in tools/rig/crons.json runs ${arg}`);
  if (unique.length > 1) throw new Error(`rig cron: ${arg} runs under ${unique.length} crons (${unique.join(" | ")}); name the expression`);
  return unique[0];
}

export function readCronRegistry(root = TOOLING_ROOT) {
  const path = join(root, "tools", "rig", "crons.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}
