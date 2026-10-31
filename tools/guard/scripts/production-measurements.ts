/**
 * Production's side of admission, read for guard.yml's
 * daily `measurements` run from the `ops_diag` views as `agent_diag`
 * (supabase/migrations/20261030120200_agent_diag_reads_only_non_personal_views.sql):
 *
 *   - the reserve, production's largest ring audience plus one: per active
 *     number in `ring_audience_sizes`, the larger of the ring path's own
 *     ceiling and the most ring legs one call opened in 28 days;
 *   - the window, the six consecutive UTC hours with the fewest production
 *     calls over the last 28 days, from `hourly_call_counts`. It is measured
 *     again only once the guard's is {@link WINDOW_RECHECK_MS} old.
 *
 * One statement returns counts only, and the session runs call-trace.mjs's
 * self-check first, so a login that could reach anything beyond `ops_diag`,
 * or write, is refused before the read. Nothing here prints a row, a host or
 * psql's own words: the log is public, and psql names the login, which
 * carries the project ref.
 *
 * Without AGENT_DIAG_DATABASE_URL nothing is filed. A stale reserve refuses
 * paid dials; an invented one would admit them.
 */
import { agentDiagConnection, runPsql, sessionSql } from "../../../scripts/ops/call-trace.mjs";
import { WINDOW_DEFAULT_START_HOUR, WINDOW_HISTORY_DAYS, WINDOW_HOURS, WINDOW_RECHECK_MS } from "../src/limits.ts";
import type { Measurements } from "./admin-routine.ts";

export const PRODUCTION_SQL = `select json_build_object(
  'numbers', (select count(*)::int from ops_diag.ring_audience_sizes),
  'largest_audience', (select coalesce(max(greatest(a.ring_legs_ceiling, a.peak_legs_28d)), 0)::int
                         from ops_diag.ring_audience_sizes a),
  'hourly_calls', (select json_agg(coalesce(c.calls, 0) order by g.h)
                     from generate_series(0, 23) as g(h)
                     left join (select extract(hour from v.hour at time zone 'UTC')::int as h, sum(v.calls)::int as calls
                                  from ops_diag.hourly_call_counts v
                                 where v.hour >= now() - interval '${WINDOW_HISTORY_DAYS} days'
                                 group by 1) c on c.h = g.h)
);`;

export interface ProductionRead {
  /** Active numbers the reserve was taken over. */
  numbers: number;
  largest_audience: number;
  /** Production's calls in each UTC hour of the day, 0-23, over the history. */
  hourly_calls: number[];
}

const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** The statement's one JSON line, or null when psql printed anything else. */
export function parseRead(stdout: string): ProductionRead | null {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? "");
  } catch {
    return null;
  }
  const read = value as Partial<ProductionRead> | null;
  if (!read || !count(read.numbers) || !count(read.largest_audience)) return null;
  if (!Array.isArray(read.hourly_calls) || read.hourly_calls.length !== 24 || !read.hourly_calls.every(count)) return null;
  return read as ProductionRead;
}

/** The first hour of the quietest {@link WINDOW_HOURS}; a tie goes to the first from 04:00 on, so no data keeps the default. */
export function quietestWindow(hourly: readonly number[]): number {
  let best = WINDOW_DEFAULT_START_HOUR;
  let bestCalls = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < 24; offset++) {
    const start = (WINDOW_DEFAULT_START_HOUR + offset) % 24;
    let calls = 0;
    for (let hour = 0; hour < WINDOW_HOURS; hour++) calls += hourly[(start + hour) % 24] ?? 0;
    if (calls < bestCalls) {
      best = start;
      bestCalls = calls;
    }
  }
  return best;
}

/** Whether the guard's window is due: never measured, or measured {@link WINDOW_RECHECK_MS} ago or more. */
export function windowDue(measuredAt: string | null | undefined, now: Date): boolean {
  if (!measuredAt) return true;
  const at = Date.parse(measuredAt);
  return !Number.isFinite(at) || now.getTime() - at >= WINDOW_RECHECK_MS;
}

export interface Plan {
  inputs: Measurements;
  /** Safe for a public log. */
  lines: string[];
}

/** What a read files: the reserve always, when there is a number to reserve for; the window when due and there are calls to place it by. */
export function planFiling(read: ProductionRead, due: boolean): Plan {
  const inputs: Measurements = {};
  const lines: string[] = [];
  if (read.numbers === 0) {
    lines.push("::warning title=Reserve not filed::ops_diag lists no active production number, so there is no ring audience to reserve for. The guard keeps its last reserve until it goes stale.");
  } else {
    inputs.reserveLegs = String(read.largest_audience + 1);
    lines.push(`reserve read over ${read.numbers} active number(s)`);
  }
  if (!due) {
    lines.push("window: measured within the month, not due");
  } else if (read.hourly_calls.every((calls) => calls === 0)) {
    lines.push(`::notice title=Window not filed::Production has no calls in the last ${WINDOW_HISTORY_DAYS} days, so the default window stays.`);
  } else {
    inputs.windowStartHour = String(quietestWindow(read.hourly_calls));
  }
  return { inputs, lines };
}

export type ReadOutcome = { ok: true; read: ProductionRead } | { ok: false; lines: string[] } | { ok: "absent"; lines: string[] };

interface PsqlResult {
  error?: Error & { code?: string };
  status: number | null;
  stdout?: string;
  stderr?: string;
}

export type PsqlRunner = (sql: string, env: Record<string, string>) => PsqlResult;

// call-trace.mjs is untyped JavaScript; this is the one way it is called here.
const psqlOf = runPsql as unknown as (sql: string, env: Record<string, string>, options: { args: string[] }) => PsqlResult;
const realPsql: PsqlRunner = (sql, env) => psqlOf(sql, env, { args: ["-q", "-A", "-t"] });

/** Reads production as agent_diag. Errors name the step, never psql's output. */
export function readProduction(url: string | undefined, psql: PsqlRunner = realPsql): ReadOutcome {
  if (!url?.trim()) {
    return {
      ok: "absent",
      lines: [
        "::notice title=Production not read::The guard environment has no AGENT_DIAG_DATABASE_URL yet (FA13), so the reserve and window were not filed. The guard keeps what it has; a reserve older than 36 hours refuses paid dials.",
      ],
    };
  }
  const connection = agentDiagConnection(url.trim()) as { env?: Record<string, string>; error?: string };
  if (!connection.env) return { ok: false, lines: [`::error title=AGENT_DIAG_DATABASE_URL refused::${connection.error ?? "unusable"}`] };
  const result = psql(sessionSql(PRODUCTION_SQL, connection as { env: Record<string, string> }), connection.env);
  if (result.error) {
    return { ok: false, lines: [`::error title=psql did not run::${result.error.code ?? "no psql client on this runner"}`] };
  }
  if (result.status !== 0) {
    const why = /REFUSED/.test(result.stderr ?? "")
      ? "the agent_diag self-check refused this login; see scripts/ops/call-trace.mjs --self-check"
      : `psql exited ${result.status}`;
    return { ok: false, lines: [`::error title=Production not read::${why}`] };
  }
  const read = parseRead(result.stdout ?? "");
  if (!read) return { ok: false, lines: ["::error title=Production not read::psql answered something that is not the measurement document"] };
  return { ok: true, read };
}
