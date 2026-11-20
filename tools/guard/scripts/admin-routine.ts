/**
 * One admin routine on the guard, through the edge. guard.yml runs it after a
 * deploy, or on its own when dispatched with `deploy` off. The admin token
 * lives only in the `guard` environment (docs/RIG.md), so this is the admin
 * class's only caller.
 *
 * Its output lands in a public Actions log, so it prints states, reason codes,
 * roles and counts: never an id, a phone number, an address or a token.
 *
 *   ROUTINE=check|setup|order-standing|resume-ordering|reattach|health
 *   resume-ordering only: RESUME_BY, the dispatching GitHub login; RESUME_REASON, why a person lifts the stop.
 *   EDGE_ORIGIN, GUARD_ADMIN_TOKEN
 *   node --experimental-strip-types tools/guard/scripts/admin-routine.ts
 */
import { resolve as resolvePath } from "node:path";

import { EDGE_PATHS, GUARD_ROUTES } from '../../rig-protocol/src/index.ts';
import type { GuardHealth } from '../../rig-protocol/src/index.ts';

export const ROUTINES = [
  "check",
  "setup",
  "order-standing",
  "resume-ordering",
  "reattach",
] as const;

/** Read through the edge's GET /health rather than posted, so it has no place in {@link runRoutine}. */
export const HEALTH_ROUTINE = "health";

export type Routine = (typeof ROUTINES)[number];

export interface Answer {
  status: number;
  body: unknown;
}

/** Who lifts a stopped ordering, and why: both are recorded by the guard. */
export interface Resume {
  by?: string;
  reason?: string;
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
const MAX_ORDER_CALLS = 80;

function ruleOf(answer: Answer): string | null {
  const body = answer.body as { error?: unknown; rule?: unknown } | null;
  return body?.error === "guard_refused" && typeof body.rule === "string" ? body.rule : null;
}

function ok(answer: Answer): boolean {
  return answer.status >= 200 && answer.status <= 299;
}

function failed(title: string, answer: Answer): Outcome {
  const rule = ruleOf(answer);
  const vendor = answer.body as { error?: unknown; status?: unknown } | null;
  const detail = vendor?.error === "telnyx_request_failed" && typeof vendor.status === "number"
    ? `Telnyx returned HTTP ${vendor.status}`
    : `HTTP ${answer.status}${rule ? `, refused under ${rule}` : ""}`;
  return { ok: false, lines: [`::error title=${title}::${detail}`] };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function safety(value: unknown): { state: string; reasons: string[] } {
  const item = (value ?? {}) as Item;
  return { state: typeof item.state === "string" ? item.state : "unknown", reasons: strings(item.reasons) };
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
async function orderStanding(post: Post): Promise<Outcome> {
  const lines: string[] = [];
  for (let call = 1; call <= MAX_ORDER_CALLS; call++) {
    const answer = await post("/numbers/order-standing");
    const unconfirmed = answer.body as { error?: unknown; role?: unknown; status?: unknown } | null;
    if (unconfirmed?.error === "order_unconfirmed") {
      const role = typeof unconfirmed.role === "string" ? unconfirmed.role : "unknown";
      const status = typeof unconfirmed.status === "number" ? unconfirmed.status : "no answer";
      lines.push(
        `::error title=Order unconfirmed::Telnyx answered ${status} to ${role}'s order, which may have bought a number. ` +
          "The role stays held and is not ordered again; check the partition's numbers before dispatching again.",
      );
      return { ok: false, lines };
    }
    if (!ok(answer)) return { ok: false, lines: [...lines, ...failed("Standing order stopped", answer).lines] };
    const body = answer.body as {
      ordered?: unknown;
      searched?: unknown;
      remaining?: unknown;
      unlisted?: unknown;
      tagged?: unknown;
    };
    const remaining = strings(body.remaining);
    const unlisted = strings(body.unlisted);
    if (typeof body.ordered === "string") lines.push(`ordered ${body.ordered}`);
    else if (typeof body.searched === "string") lines.push(`no number free in area code ${body.searched}`);
    if (typeof body.tagged === "number" && body.tagged > 0) lines.push(`tagged ${body.tagged} standing number(s)`);
    if (remaining.length === 0) {
      if (unlisted.length > 0) {
        lines.push(`::warning title=Standing numbers not listed::Held but not yet in the partition's group listing: ${unlisted.join(", ")}`);
      }
      return { ok: true, lines: [...lines, "every standing role is held"] };
    }
    lines.push(`still to order: ${remaining.join(", ")}`);
  }
  return { ok: false, lines: [...lines, `::error title=Standing order unfinished::Stopped after ${MAX_ORDER_CALLS} calls.`] };
}

async function resumeOrdering(post: Post, resume: Resume): Promise<Outcome> {
  const by = resume.by?.trim() ?? "";
  const reason = resume.reason?.trim() ?? "";
  if (!by || !reason) {
    return { ok: false, lines: ["::error title=Resume refused::Give resume_reason; the dispatching login is recorded with it."] };
  }
  const answer = await post("/numbers/resume-ordering", { by, reason });
  if (!ok(answer)) return failed("Ordering not resumed", answer);
  const body = answer.body as { cleared?: unknown; state?: unknown };
  const state = typeof body.state === "string" ? body.state : "unknown";
  const lines = [`cleared stop ${typeof body.cleared === "string" ? body.cleared : "unknown"} for ${by}; the read-back answered ${state}`];
  if (state === "failed") {
    lines.push("::error title=Ordering stopped again::The read-back still could not confirm the first order; see health's ordering.stopped_reason.");
  }
  return { ok: state !== "failed", lines };
}

async function reattach(post: Post): Promise<Outcome> {
  const answer = await post("/numbers/reattach");
  if (!ok(answer)) return failed("Reattach failed", answer);
  return { ok: true, lines: [`reattached: ${strings((answer.body as Item).reattached).join(", ") || "none"}`] };
}

/** The guard's partition status, without vendor account data. */
export function healthLines(body: unknown): string[] {
  const health = (body ?? {}) as Partial<GuardHealth>;
  return [JSON.stringify({ ok: health.ok, safety: safety(health.telnyx?.safety), ordering: health.ordering })];
}

export async function runRoutine(
  routine: Routine,
  post: Post,
  resume: Resume = {},
): Promise<Outcome> {
  switch (routine) {
    case "check": {
      return check(post);
    }
    case "setup": {
      return setup(post);
    }
    case "order-standing": {
      return orderStanding(post);
    }
    case "resume-ordering": {
      return resumeOrdering(post, resume);
    }
    case "reattach": {
      return reattach(post);
    }
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

async function main(): Promise<number> {
  const routine = (process.env.ROUTINE ?? "check") as Routine | typeof HEALTH_ROUTINE;
  if (routine !== HEALTH_ROUTINE && !ROUTINES.includes(routine)) {
    console.log(`::error title=Unknown routine::${routine} is not one of ${[...ROUTINES, HEALTH_ROUTINE].join(", ")}.`);
    return 1;
  }
  const origin = process.env.EDGE_ORIGIN?.trim() ?? "";
  const token = process.env.GUARD_ADMIN_TOKEN?.trim() ?? "";
  if (!origin || !token) {
    const quiet = routine === "check";
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
  const outcome = await runRoutine(routine, edgePost(origin, token), {
    by: process.env.RESUME_BY,
    reason: process.env.RESUME_REASON,
  });
  for (const line of outcome.lines) console.log(line);
  return outcome.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.filename === resolvePath(process.argv[1])) {
  process.exitCode = await main();
}
