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
 *     again only once the guard's is {@link WINDOW_RECHECK_MS} old;
 *   - the history lower bound on the account's concurrent limit: the most
 *     answered calls that overlapped in 28 days, from `call_sessions`;
 *   - production's peak outbound legs in one UTC hour and in one UTC day over
 *     28 days, ring legs included, which spend Telnyx's account-wide caps.
 *
 * The last two are filed only from this read, never from a typed input: a
 * value somebody typed is not evidence.
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

/**
 * Each answered call is +1 at its answer and -1 at its end; the running sum's
 * peak is the most that were up at once. An end sorts before a start at the
 * same instant, so calls that only touch are not counted as overlapping: the
 * bound may run low, never high.
 */
const PEAK_CONCURRENT_SQL = `(select coalesce(max(s.running), 0)::int
     from (select sum(e.delta) over (order by e.at, e.delta rows unbounded preceding) as running
             from (select c.answered_at as at, 1 as delta
                     from ops_diag.call_sessions c
                    where c.answered_at is not null and c.ended_at is not null and c.ended_at > c.answered_at
                      and c.answered_at >= now() - interval '${WINDOW_HISTORY_DAYS} days'
                   union all
                   select c.ended_at, -1
                     from ops_diag.call_sessions c
                    where c.answered_at is not null and c.ended_at is not null and c.ended_at > c.answered_at
                      and c.answered_at >= now() - interval '${WINDOW_HISTORY_DAYS} days') e) s)`;

/** Every outbound leg production opened: each member leg (ring, consult, transfer) and each outbound call. */
const OUTBOUND_LEGS_SQL = `(select l.created_at as at
       from ops_diag.call_legs l
      where l.created_at >= now() - interval '${WINDOW_HISTORY_DAYS} days'
     union all
     select c.started_at
       from ops_diag.call_sessions c
      where c.direction = 'outbound' and c.started_at >= now() - interval '${WINDOW_HISTORY_DAYS} days')`;

const peakLegsIn = (unit: "hour" | "day") => `(select coalesce(max(p.legs), 0)::int
     from (select count(*) as legs from ${OUTBOUND_LEGS_SQL} o
            group by date_trunc('${unit}', o.at at time zone 'UTC')) p)`;

export const PRODUCTION_SQL = `select json_build_object(
  'numbers', (select count(*)::int from ops_diag.ring_audience_sizes),
  'largest_audience', (select coalesce(max(greatest(a.ring_legs_ceiling, a.peak_legs_28d)), 0)::int
                         from ops_diag.ring_audience_sizes a),
  'hourly_calls', (select json_agg(coalesce(c.calls, 0) order by g.h)
                     from generate_series(0, 23) as g(h)
                     left join (select extract(hour from v.hour at time zone 'UTC')::int as h, sum(v.calls)::int as calls
                                  from ops_diag.hourly_call_counts v
                                 where v.hour >= now() - interval '${WINDOW_HISTORY_DAYS} days'
                                 group by 1) c on c.h = g.h),
  'peak_concurrent_calls', ${PEAK_CONCURRENT_SQL},
  'peak_hour_dials', ${peakLegsIn("hour")},
  'peak_day_dials', ${peakLegsIn("day")}
);`;

export interface ProductionRead {
  /** Active numbers the reserve was taken over. */
  numbers: number;
  largest_audience: number;
  /** Production's calls in each UTC hour of the day, 0-23, over the history. */
  hourly_calls: number[];
  /** The most answered production calls up at once over the history. */
  peak_concurrent_calls: number;
  /** The most outbound legs production opened in one UTC hour, and in one UTC day. */
  peak_hour_dials: number;
  peak_day_dials: number;
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
  if (!count(read.peak_concurrent_calls) || !count(read.peak_hour_dials) || !count(read.peak_day_dials)) return null;
  if (read.peak_hour_dials > read.peak_day_dials) return null;
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
  /** Filed as they are, straight from the read: these have no typed input. */
  measured: { route: string; body: Record<string, unknown> }[];
  /** Safe for a public log. */
  lines: string[];
}

/** What a read files: the reserve always, when there is a number to reserve for; the window when due and there are calls to place it by. */
export function planFiling(read: ProductionRead, due: boolean, now: Date = new Date()): Plan {
  const inputs: Measurements = {};
  const lines: string[] = [];
  const measuredAt = now.toISOString();
  const measured = [
    { route: "/concurrency-history", body: { peak_calls: read.peak_concurrent_calls, measured_at: measuredAt } },
    {
      route: "/account-rate",
      body: { peak_hour_dials: read.peak_hour_dials, peak_day_dials: read.peak_day_dials, measured_at: measuredAt },
    },
  ];
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
  return { inputs, measured, lines };
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
        "::notice title=Production not read::The guard environment has no AGENT_DIAG_DATABASE_URL, so the reserve, the window and production's call peaks were not filed. The guard keeps what it has; any of them older than 36 hours refuses paid dials.",
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
