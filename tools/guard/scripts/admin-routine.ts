/**
 * One admin routine on the guard, through the edge. guard.yml runs it after a
 * deploy, or on its own when dispatched with `deploy` off. The admin token
 * lives only in the `guard` environment (docs/RIG.md), so this is the admin
 * class's only caller.
 *
 * Its output lands in a public Actions log, so it prints states, reason codes,
 * roles and counts: never an id, a phone number, an address or a token.
 *
 *   ROUTINE=check|setup|order-standing|key-inventory|accept-key-inventory|reattach|measurements|limit-probe|health
 *   EDGE_ORIGIN, GUARD_ADMIN_TOKEN
 *   measurements only: RESERVE_LEGS; CALLS, ABANDONED and SHORT together; WINDOW_START_HOUR;
 *     USAGE_USD, this month's actual Telnyx usage for the partition, from detail records.
 *     With none of them (the daily run), production's reserve, its window
 *     when due, its concurrent-call peak and its peak hour and day of dials
 *     are read as agent_diag from AGENT_DIAG_DATABASE_URL
 *     (production-measurements.ts) and filed. The peaks have no typed input.
 *
 *   node --experimental-strip-types tools/guard/scripts/admin-routine.ts
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EDGE_PATHS, GUARD_ROUTES, type GuardHealth } from "../../rig-protocol/src/index.ts";
import { planFiling, readProduction, windowDue, type ReadOutcome } from "./production-measurements.ts";

export const ROUTINES = [
  "check",
  "setup",
  "order-standing",
  "key-inventory",
  "accept-key-inventory",
  "reattach",
  "measurements",
  "limit-probe",
] as const;

/** Read through the edge's GET /health rather than posted, so it has no place in {@link runRoutine}. */
export const HEALTH_ROUTINE = "health";

export type Routine = (typeof ROUTINES)[number];

export interface Answer {
  status: number;
  body: unknown;
}

/** POST to `/admin<route>` on the guard. */
export type Post = (route: string, body?: unknown) => Promise<Answer>;

export interface Outcome {
  ok: boolean;
  /** Printed as they are: each is safe for a public log. */
  lines: string[];
}

type Item = Record<string, unknown>;

/** The order loop's pause: one search per call, and the guard's search interval is ten seconds. */
export const SEARCH_PAUSE_MS = 11_000;
const MAX_ORDER_CALLS = 80;

function ruleOf(answer: Answer): string | null {
  const body = answer.body as { error?: unknown; rule?: unknown } | null;
  return body && body.error === "guard_refused" && typeof body.rule === "string" ? body.rule : null;
}

function ok(answer: Answer): boolean {
  return answer.status >= 200 && answer.status <= 299;
}

function failed(title: string, answer: Answer): Outcome {
  const rule = ruleOf(answer);
  return { ok: false, lines: [`::error title=${title}::HTTP ${answer.status}${rule ? `, refused under ${rule}` : ""}`] };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function safety(value: unknown): { state: string; reasons: string[] } {
  const item = (value ?? {}) as Item;
  return { state: typeof item.state === "string" ? item.state : "unknown", reasons: strings(item.reasons) };
}

/** Counts per credential kind (`api_key:<id>` counts as one api_key); the ids stay out. */
function kinds(found: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of found) {
    const kind = entry === "no_accepted_baseline" || entry === "inventory_unreadable" ? entry : entry.split(":")[0];
    out[kind] = (out[kind] ?? 0) + 1;
  }
  return out;
}

function sizes(record: Item, fields: readonly string[]): Record<string, number | null> {
  return Object.fromEntries(fields.map((field) => [field, Array.isArray(record[field]) ? (record[field] as unknown[]).length : null]));
}

async function check(post: Post): Promise<Outcome> {
  const answer = await post("/check");
  if (ruleOf(answer) === "telnyx.key_missing") {
    return {
      ok: true,
      lines: ["::notice title=Guard has no Telnyx key yet::TELNYX_API_KEY is not set on the Worker (FA3); every Telnyx route fails closed until it is."],
    };
  }
  if (!ok(answer)) return failed("Guard check failed", answer);
  const result = safety(answer.body);
  const lines = [JSON.stringify(result)];
  if (result.state === "unsafe") {
    lines.push("::error title=Guard refuses to serve::The start-up checks found the partition unsafe; see the reasons above.");
  }
  return { ok: result.state !== "unsafe", lines };
}

async function setup(post: Post): Promise<Outcome> {
  const answer = await post("/setup");
  if (!ok(answer)) return failed("Guard setup failed", answer);
  const body = answer.body as { steps?: Item[]; safety?: unknown };
  const lines = (body.steps ?? []).map((step) =>
    [step.resource, step.name, step.action, step.reason].filter((part) => typeof part === "string").join(" "),
  );
  const result = safety(body.safety);
  lines.push(JSON.stringify(result));
  if (result.state === "unsafe") {
    lines.push("::error title=Guard refuses to serve::Setup left the partition unsafe; see the reasons above.");
  }
  return { ok: result.state !== "unsafe", lines };
}

/** Orders until every standing role is held; the guard orders one per call. */
async function orderStanding(post: Post, wait: (ms: number) => Promise<void>): Promise<Outcome> {
  const lines: string[] = [];
  for (let call = 1; call <= MAX_ORDER_CALLS; call++) {
    const answer = await post("/numbers/order-standing");
    if (ruleOf(answer) === "provisioning.search_rate") {
      await wait(SEARCH_PAUSE_MS);
      continue;
    }
    if (!ok(answer)) return { ok: false, lines: [...lines, ...failed("Standing order stopped", answer).lines] };
    const body = answer.body as { ordered?: unknown; searched?: unknown; remaining?: unknown; deferred?: unknown; tagged?: unknown };
    const remaining = strings(body.remaining);
    const deferred = strings(body.deferred);
    if (typeof body.ordered === "string") lines.push(`ordered ${body.ordered}`);
    else if (typeof body.searched === "string") lines.push(`no number free in area code ${body.searched}`);
    if (typeof body.tagged === "number" && body.tagged > 0) lines.push(`tagged ${body.tagged} standing number(s)`);
    if (remaining.length === 0) {
      const done = deferred.length
        ? `every role the open lanes use is held; waiting for paid dials: ${deferred.join(", ")}`
        : "every standing role is held";
      return { ok: true, lines: [...lines, done] };
    }
    lines.push(`still to order: ${remaining.join(", ")}`);
    await wait(SEARCH_PAUSE_MS);
  }
  return { ok: false, lines: [...lines, `::error title=Standing order unfinished::Stopped after ${MAX_ORDER_CALLS} calls.`] };
}

async function keyInventory(post: Post): Promise<Outcome> {
  const answer = await post("/key-inventory/run");
  if (!ok(answer)) return failed("Key inventory failed", answer);
  const body = answer.body as { unexpected?: unknown; inventory?: Item | null };
  const found = strings(body.unexpected);
  const lines = [
    JSON.stringify({
      sources: body.inventory ? sizes(body.inventory, ["api_keys", "oauth_clients", "oauth_grants", "audit_findings"]) : null,
      unexpected: kinds(found),
    }),
  ];
  if (found.length > 0) {
    lines.push(
      "::warning title=Key inventory is not clean::The guard raised ['ops','telnyx-key-inventory']. Revoke what nobody made on purpose, then dispatch accept-key-inventory.",
    );
  }
  return { ok: true, lines };
}

async function acceptKeyInventory(post: Post): Promise<Outcome> {
  const answer = await post("/key-inventory/accept");
  if (!ok(answer)) return failed("Key inventory not accepted", answer);
  return { ok: true, lines: [JSON.stringify({ accepted: sizes(answer.body as Item, ["api_keys", "oauth_clients", "oauth_grants"]) })] };
}

async function reattach(post: Post): Promise<Outcome> {
  const answer = await post("/numbers/reattach");
  if (!ok(answer)) return failed("Reattach failed", answer);
  return { ok: true, lines: [`reattached: ${strings((answer.body as Item).reattached).join(", ") || "none"}`] };
}

/** The validation check, run now: what it found, and each write's answer by code and field, never Telnyx's words. */
async function limitProbe(post: Post): Promise<Outcome> {
  const answer = await post("/limit-probe");
  if (!ok(answer)) return failed("Limit probe failed", answer);
  const body = (answer.body ?? {}) as { result?: unknown; value?: unknown; writes?: unknown; refusal_code?: unknown; trace?: unknown };
  const lines = [JSON.stringify({ result: body.result, value: body.value, writes: body.writes, refusal_code: body.refusal_code })];
  for (const entry of Array.isArray(body.trace) ? (body.trace as Item[]) : []) {
    lines.push(`wrote ${String(entry.value)}: HTTP ${String(entry.status)}, code ${String(entry.code)}, field ${String(entry.pointer)}`);
  }
  if (body.result === "inconclusive") {
    lines.push("::warning title=Limit probe inconclusive::The writes above show which answer stopped the search.");
  }
  return { ok: true, lines };
}

/** The guard's /health, cut to what a public log may carry: states, counts, rule names and hours. */
export function healthLines(body: unknown): string[] {
  const health = (body ?? {}) as Partial<GuardHealth>;
  const dials = health.paid_dials;
  const concurrency = health.concurrency;
  return [
    JSON.stringify({ ok: health.ok, balance_above_floor: health.balance_above_floor, room: health.room ?? null }),
    JSON.stringify({
      paid_dials: dials
        ? {
            enabled: dials.enabled,
            blockers: dials.blockers,
            room: dials.room,
            window_start_hour_utc: dials.window_start_hour_utc,
            in_window: dials.in_window,
          }
        : null,
    }),
    JSON.stringify({
      concurrency: concurrency
        ? {
            limit_in_force: concurrency.limit_in_force,
            source: concurrency.source,
            validation: concurrency.validation,
            history_lower_bound: concurrency.history_lower_bound,
            ceiling: concurrency.ceiling,
            conflict: concurrency.conflict,
          }
        : null,
    }),
    JSON.stringify({ account_rate: health.account_rate ?? null }),
  ];
}

export interface Measurements {
  reserveLegs?: string;
  calls?: string;
  abandoned?: string;
  short?: string;
  windowStartHour?: string;
  usageUsd?: string;
}

function count(name: string, value: string): number {
  if (!/^\d{1,7}$/.test(value.trim())) throw new Error(`${name} must be a whole number`);
  return Number(value.trim());
}

/** What the inputs ask to file, in the guard's own shapes; empty inputs file nothing. */
export function measurementPosts(inputs: Measurements, now: Date = new Date()): { route: string; body: Item }[] {
  const given = (value: string | undefined): value is string => typeof value === "string" && value.trim() !== "";
  const posts: { route: string; body: Item }[] = [];
  if (given(inputs.reserveLegs)) posts.push({ route: "/reserve", body: { legs: count("reserve_legs", inputs.reserveLegs) } });
  const ratio = [inputs.calls, inputs.abandoned, inputs.short];
  if (ratio.some(given)) {
    if (!ratio.every(given)) throw new Error("calls, abandoned and short are filed together");
    posts.push({
      route: "/ratios",
      body: {
        calls: count("calls", inputs.calls as string),
        abandoned: count("abandoned", inputs.abandoned as string),
        short: count("short", inputs.short as string),
      },
    });
  }
  if (given(inputs.windowStartHour)) {
    posts.push({ route: "/window", body: { start_hour: count("window_start_hour", inputs.windowStartHour) } });
  }
  if (given(inputs.usageUsd)) {
    if (!/^\d{1,5}(?:\.\d{1,6})?$/.test(inputs.usageUsd.trim())) throw new Error("usage_usd must be dollars, like 4.25");
    posts.push({ route: "/ledger", body: { month: now.toISOString().slice(0, 7), usage_usd: Number(inputs.usageUsd.trim()) } });
  }
  return posts;
}

async function measurements(post: Post, inputs: Measurements): Promise<Outcome> {
  let posts: { route: string; body: Item }[];
  try {
    posts = measurementPosts(inputs);
  } catch (cause) {
    return { ok: false, lines: [`::error title=Measurements refused::${(cause as Error).message}`] };
  }
  if (posts.length === 0) {
    return { ok: false, lines: ["::error title=No measurements::Give reserve_legs, the three ratio counts, window_start_hour or usage_usd."] };
  }
  const lines: string[] = [];
  for (const { route, body } of posts) {
    const answer = await post(route, body);
    if (!ok(answer)) return { ok: false, lines: [...lines, ...failed(`Filing ${route.slice(1)} failed`, answer).lines] };
    lines.push(`filed ${route.slice(1)}: ${JSON.stringify(body)}`);
  }
  return { ok: true, lines };
}

export async function runRoutine(
  routine: Routine,
  post: Post,
  inputs: Measurements = {},
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<Outcome> {
  switch (routine) {
    case "check":
      return check(post);
    case "setup":
      return setup(post);
    case "order-standing":
      return orderStanding(post, wait);
    case "key-inventory":
      return keyInventory(post);
    case "accept-key-inventory":
      return acceptKeyInventory(post);
    case "reattach":
      return reattach(post);
    case "measurements":
      return measurements(post, inputs);
    case "limit-probe":
      return limitProbe(post);
  }
}

/** POSTs through the edge's guard prefix, with the admin token as the bearer. */
export function edgePost(edgeOrigin: string, token: string, fetcher: typeof fetch = fetch): Post {
  const base = `${new URL(edgeOrigin).origin}${EDGE_PATHS.guardPrefix}${GUARD_ROUTES.admin}`;
  return async (route, body) => {
    const response = await fetcher(`${base}${route}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await jsonOf(response) };
  };
}

/** The guard's /health through the edge, with the admin token. */
export function edgeHealth(edgeOrigin: string, token: string, fetcher: typeof fetch = fetch): () => Promise<Answer> {
  const url = `${new URL(edgeOrigin).origin}${EDGE_PATHS.guardPrefix}${GUARD_ROUTES.health}`;
  return async () => {
    const response = await fetcher(url, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await jsonOf(response) };
  };
}

async function jsonOf(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

function given(inputs: Measurements): boolean {
  return Object.values(inputs).some((value) => typeof value === "string" && value.trim() !== "");
}

/**
 * `measurements` with nothing typed in: production's reserve, and the window
 * once the guard's is due, read as agent_diag and filed. Without the login,
 * a notice and nothing filed.
 */
export async function measureProduction(
  post: Post,
  health: () => Promise<Answer>,
  read: () => ReadOutcome,
  now: Date = new Date(),
): Promise<Outcome> {
  const outcome = read();
  if (outcome.ok === "absent") return { ok: true, lines: outcome.lines };
  if (outcome.ok === false) return { ok: false, lines: outcome.lines };
  const answer = await health().catch(() => null);
  const guard = answer && ok(answer) ? (answer.body as Partial<GuardHealth> | null) : null;
  const lines: string[] = [];
  if (!guard?.paid_dials) lines.push("::warning title=Window not checked::The guard's /health did not answer, so only the reserve is filed.");
  const plan = planFiling(outcome.read, guard?.paid_dials ? windowDue(guard.paid_dials.window_measured_at, now) : false, now);
  lines.push(...plan.lines, RATIOS_NOT_READ);
  for (const { route, body } of plan.measured) {
    const answer = await post(route, body);
    if (!ok(answer)) return { ok: false, lines: [...lines, ...failed(`Filing ${route.slice(1)} failed`, answer).lines] };
    lines.push(`filed ${route.slice(1)}: ${JSON.stringify(body)}`);
  }
  if (!given(plan.inputs)) return { ok: true, lines };
  const filed = await runRoutine("measurements", post, plan.inputs);
  return { ok: filed.ok, lines: [...lines, ...filed.lines] };
}

/**
 * The ratios stay with whoever dispatches them: the guard has no reading of
 * the account's detail records that says which calls Telnyx counts as
 * abandoned or short. Until one is filed, admission refuses paid dials
 * (`admission.ratios_unknown`).
 */
const RATIOS_NOT_READ =
  "::notice title=Ratios not filed::Nothing here reads the account's abandoned and short calls; dispatch measurements with calls, abandoned and short to file them.";

async function main(): Promise<number> {
  const routine = (process.env.ROUTINE ?? "check") as Routine | typeof HEALTH_ROUTINE;
  if (routine !== HEALTH_ROUTINE && !ROUTINES.includes(routine)) {
    console.log(`::error title=Unknown routine::${routine} is not one of ${[...ROUTINES, HEALTH_ROUTINE].join(", ")}.`);
    return 1;
  }
  const inputs: Measurements = {
    reserveLegs: process.env.RESERVE_LEGS,
    calls: process.env.CALLS,
    abandoned: process.env.ABANDONED,
    short: process.env.SHORT,
    windowStartHour: process.env.WINDOW_START_HOUR,
    usageUsd: process.env.USAGE_USD,
  };
  // The daily run: a routine that is not set up yet says so and stays green.
  const fromProduction = routine === "measurements" && !given(inputs);
  const origin = process.env.EDGE_ORIGIN?.trim() ?? "";
  const token = process.env.GUARD_ADMIN_TOKEN?.trim() ?? "";
  if (!origin || !token) {
    const quiet = routine === "check" || fromProduction;
    console.log(
      `::${quiet ? "notice" : "error"} title=Guard not reachable yet::EDGE_ORIGIN or GUARD_ADMIN_TOKEN is not set in the guard environment, so ${routine} did not run.`,
    );
    return quiet ? 0 : 1;
  }
  if (new URL(origin).protocol !== "https:") {
    console.log("::error title=EDGE_ORIGIN is not https::The admin token is sent only to an https edge.");
    return 1;
  }
  if (routine === HEALTH_ROUTINE) {
    const answer = await edgeHealth(origin, token)();
    if (!ok(answer)) {
      console.log(`::error title=Guard health failed::HTTP ${answer.status}`);
      return 1;
    }
    for (const line of healthLines(answer.body)) console.log(line);
    return 0;
  }
  const outcome = fromProduction
    ? await measureProduction(edgePost(origin, token), edgeHealth(origin, token), () =>
        readProduction(process.env.AGENT_DIAG_DATABASE_URL),
      )
    : await runRoutine(routine, edgePost(origin, token), inputs);
  for (const line of outcome.lines) console.log(line);
  return outcome.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
