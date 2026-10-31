/**
 * One admin routine on the guard, through the edge. guard.yml runs it after a
 * deploy, or on its own when dispatched with `deploy` off. The admin token
 * lives only in the `guard` environment (docs/RIG.md), so this is the admin
 * class's only caller.
 *
 * Its output lands in a public Actions log, so it prints states, reason codes,
 * roles and counts: never an id, a phone number, an address or a token.
 *
 *   ROUTINE=check|setup|order-standing|key-inventory|accept-key-inventory|reattach|measurements
 *   EDGE_ORIGIN, GUARD_ADMIN_TOKEN
 *   measurements only: RESERVE_LEGS; CALLS, ABANDONED and SHORT together; WINDOW_START_HOUR;
 *     USAGE_USD, this month's actual Telnyx usage for the partition, from detail records
 *
 *   node --experimental-strip-types tools/guard/scripts/admin-routine.ts
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EDGE_PATHS, GUARD_ROUTES } from "../../rig-protocol/src/index.ts";

export const ROUTINES = [
  "check",
  "setup",
  "order-standing",
  "key-inventory",
  "accept-key-inventory",
  "reattach",
  "measurements",
] as const;

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
    const body = answer.body as { ordered?: unknown; searched?: unknown; remaining?: unknown; tagged?: unknown };
    const remaining = strings(body.remaining);
    if (typeof body.ordered === "string") lines.push(`ordered ${body.ordered}`);
    else if (typeof body.searched === "string") lines.push(`no number free in area code ${body.searched}`);
    if (typeof body.tagged === "number" && body.tagged > 0) lines.push(`tagged ${body.tagged} standing number(s)`);
    if (remaining.length === 0) return { ok: true, lines: [...lines, "every standing role is held"] };
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
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  };
}

async function main(): Promise<number> {
  const routine = (process.env.ROUTINE ?? "check") as Routine;
  if (!ROUTINES.includes(routine)) {
    console.log(`::error title=Unknown routine::${routine} is not one of ${ROUTINES.join(", ")}.`);
    return 1;
  }
  const origin = process.env.EDGE_ORIGIN?.trim() ?? "";
  const token = process.env.GUARD_ADMIN_TOKEN?.trim() ?? "";
  if (!origin || !token) {
    console.log(
      `::${routine === "check" ? "notice" : "error"} title=Guard not reachable yet::EDGE_ORIGIN or GUARD_ADMIN_TOKEN is not set in the guard environment, so ${routine} did not run.`,
    );
    return routine === "check" ? 0 : 1;
  }
  if (new URL(origin).protocol !== "https:") {
    console.log("::error title=EDGE_ORIGIN is not https::The admin token is sent only to an https edge.");
    return 1;
  }
  const outcome = await runRoutine(routine, edgePost(origin, token), {
    reserveLegs: process.env.RESERVE_LEGS,
    calls: process.env.CALLS,
    abandoned: process.env.ABANDONED,
    short: process.env.SHORT,
    windowStartHour: process.env.WINDOW_START_HOUR,
    usageUsd: process.env.USAGE_USD,
  });
  for (const line of outcome.lines) console.log(line);
  return outcome.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
