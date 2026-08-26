/**
 * #251 — the numbers a load scenario reports, and the honesty rules about them.
 *
 * Two things this deliberately measures that a latency histogram alone does
 * not, because they are what #251's third acceptance criterion is about:
 *
 * - **hangs**: a request that never came back inside its own deadline. A hang
 *   is a different failure from an error, and the whole requirement is that a
 *   ceiling produces the second rather than the first. Counted separately and
 *   never folded into "slow".
 * - **the status histogram**: a burst that returns 500s is a system saying so;
 *   a burst that returns 200s while dropping rows is a system lying. Both are
 *   visible here only if the counts are kept apart from the timings.
 */

export interface Outcome {
  status: number | "hang" | "throw";
  ms: number;
  /** Present when `status` is "throw" — the message, never the payload. */
  detail?: string;
}

export interface Report {
  label: string;
  count: number;
  /** Wall-clock for the whole burst, which is the throughput number. */
  totalMs: number;
  p50: number;
  p95: number;
  max: number;
  statuses: Record<string, number>;
  hangs: number;
  throws: number;
}

/**
 * Stable prefix for machine-readable capacity evidence in test output.
 *
 * CI and a human terminal can keep all the ordinary Vitest prose around it;
 * `rg '^CAPACITY_RESULT '` extracts only records that can be archived or
 * compared with a later run. The payload must contain aggregate measurements
 * only — never request bodies, tokens, phone numbers, or customer data.
 */
export const CAPACITY_RESULT_PREFIX = "CAPACITY_RESULT ";

export interface CapacityEvidence {
  scenario: string;
  environment: "local-postgres" | "local-realtime" | "workerd";
  tested_bound: Record<string, number | string>;
  ceiling_reached: boolean;
  measurements: Record<string, unknown>;
  notes?: string[];
}

/**
 * Run `count` copies of `task` at once and describe what came back.
 *
 * True concurrency, not a pool: the point of a burst scenario is the moment
 * every event arrives together, and a pool with a width would be measuring the
 * pool.
 */
export async function burst(
  label: string,
  count: number,
  task: (index: number) => Promise<{ status: number }>,
  deadlineMs = 30_000,
): Promise<Report> {
  const started = Date.now();
  const outcomes = await Promise.all(
    Array.from({ length: count }, (_, index) => runOne(task, index, deadlineMs)),
  );
  const totalMs = Date.now() - started;

  const timings = outcomes
    .filter((outcome) => typeof outcome.status === "number")
    .map((outcome) => outcome.ms)
    .sort((a, b) => a - b);

  const statuses: Record<string, number> = {};
  for (const outcome of outcomes) {
    const key = String(outcome.status);
    statuses[key] = (statuses[key] ?? 0) + 1;
  }

  return {
    label,
    count,
    totalMs,
    p50: percentile(timings, 0.5),
    p95: percentile(timings, 0.95),
    max: timings.length > 0 ? timings[timings.length - 1] : 0,
    statuses,
    hangs: outcomes.filter((outcome) => outcome.status === "hang").length,
    throws: outcomes.filter((outcome) => outcome.status === "throw").length,
  };
}

async function runOne(
  task: (index: number) => Promise<{ status: number }>,
  index: number,
  deadlineMs: number,
): Promise<Outcome> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The deadline is the definition of a hang for this harness: a request the
    // caller would have given up on. Racing it is the only way to distinguish
    // "slow" from "never", and "never" is the failure #251 cares about.
    const hang = new Promise<"hang">((resolve) => {
      timer = setTimeout(() => resolve("hang"), deadlineMs);
    });
    const result = await Promise.race([task(index), hang]);
    if (result === "hang") return { status: "hang", ms: Date.now() - started };
    return { status: result.status, ms: Date.now() - started };
  } catch (cause) {
    return {
      status: "throw",
      ms: Date.now() - started,
      // The message, never the value: a decode failure's `cause.message` has
      // carried customer content before (#585's neighbour).
      detail: cause instanceof Error ? cause.name : "unknown",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * fraction),
  );
  return sorted[index];
}

/** One line per scenario, in a shape that can be pasted into CAPACITY.md. */
export function line(report: Report): string {
  const statuses = Object.entries(report.statuses)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, n]) => `${status}×${n}`)
    .join(" ");
  return (
    `${report.label}: n=${report.count} wall=${report.totalMs}ms ` +
    `p50=${report.p50}ms p95=${report.p95}ms max=${report.max}ms ` +
    `[${statuses}] hangs=${report.hangs}`
  );
}

/** One JSON-lines record per scenario, safe to scrape from a noisy test run. */
export function capacityResult(evidence: CapacityEvidence): string {
  return (
    CAPACITY_RESULT_PREFIX +
    JSON.stringify({
      schema: "loonext.capacity.v1",
      ...evidence,
    })
  );
}

/**
 * Vitest captures `console.log` on a green node run. Write the one durable
 * result record directly so it remains visible without also exposing every
 * expected warning produced by a load fixture.
 */
export function emitCapacityResult(result: string): void {
  process.stdout.write(`${result}\n`);
}

/** The HTTP-burst report in the common capacity evidence envelope. */
export function burstCapacityResult(
  scenario: string,
  report: Report,
  testedBound: Record<string, number | string>,
  measurements: Record<string, unknown> = {},
): string {
  const refusalStatuses = Object.keys(report.statuses).some((raw) => {
    const status = Number(raw);
    return status === 429 || status >= 500;
  });
  return capacityResult({
    scenario,
    environment: "local-postgres",
    tested_bound: testedBound,
    // A hang/throw or an overload/server refusal is evidence that this bound
    // crossed a limit. Callers still decide whether that is an acceptable,
    // truthful degradation, but the evidence must not label it "not reached".
    ceiling_reached: report.hangs > 0 || report.throws > 0 || refusalStatuses,
    measurements: {
      wall_ms: report.totalMs,
      p50_ms: report.p50,
      p95_ms: report.p95,
      max_ms: report.max,
      statuses: report.statuses,
      hangs: report.hangs,
      throws: report.throws,
      ...measurements,
    },
    notes: [
      "Local timings are not production latency; counts, statuses, drops, and hangs are the transferable evidence.",
    ],
  });
}
