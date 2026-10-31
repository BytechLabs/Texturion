/**
 * Every scenario attempt's verdict, with the SHA it ran against. An
 * append-only JSON lines file is enough for one box: a few hundred lines a day, read whole.
 * Evidence (ids, RTP statistics, per-frame numbers on a failure) sits beside
 * it, one file per run.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `late_delivery`: the attempt failed while one of its own texts reached the
 * API only after its genuine Telnyx signature had aged out in the edge's
 * queue (late.ts). It is retried, not reported: it measures the delay, not
 * the product.
 */
export const OUTCOMES = ["pass", "fail", "infra", "preempted", "skipped", "not_runnable", "late_delivery"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Outcomes that say something about the product or the rig; the rest are bookkeeping. */
const DECISIVE: ReadonlySet<Outcome> = new Set(["pass", "fail", "infra"]);
/** Outcomes that spent dials. */
const SPENT: ReadonlySet<Outcome> = new Set(["pass", "fail", "infra", "preempted", "late_delivery"]);

const SHA = /^[0-9a-f]{7,40}$/;

export interface Verdict {
  run_id: string;
  scenario: string;
  sha: string;
  attempt: number;
  outcome: Outcome;
  /** For `fail`: what kind of failure, the third part of the fingerprint. */
  failure_class?: string;
  /** For `infra`: which part of the rig, the second part of the fingerprint. */
  component?: string;
  detail?: string;
  started_at: string;
  finished_at: string;
  dials: number;
  scheduled: boolean;
  /** Which of the scenario's registry runs a timer started, from 0. */
  slot?: number;
  /** A failure the doc calls critical: reported at once, never retried. */
  critical?: boolean;
}

export interface UnresolvedFailure {
  scenario: string;
  outcome: "fail" | "infra";
  fingerprint: string[];
  since: string;
  failing_attempts: number;
  last: Verdict;
}

export class VerdictStore {
  readonly #file: string;
  readonly #evidenceDir: string;

  constructor(dir: string) {
    mkdirSync(join(dir, "evidence"), { recursive: true });
    this.#file = join(dir, "verdicts.jsonl");
    this.#evidenceDir = join(dir, "evidence");
  }

  record(verdict: Verdict): Verdict {
    if (!SHA.test(verdict.sha)) throw new Error(`verdicts: "${verdict.sha}" is not a git SHA; every verdict names the code it judged`);
    if (!(OUTCOMES as readonly string[]).includes(verdict.outcome)) throw new Error(`verdicts: unknown outcome ${verdict.outcome}`);
    if (verdict.outcome === "fail" && !verdict.failure_class) throw new Error("verdicts: a failure needs a failure_class");
    if (verdict.outcome === "infra" && !verdict.component) throw new Error("verdicts: an infrastructure fault needs a component");
    appendFileSync(this.#file, `${JSON.stringify(verdict)}\n`);
    return verdict;
  }

  all(): Verdict[] {
    if (!existsSync(this.#file)) return [];
    return readFileSync(this.#file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Verdict];
        } catch {
          return [];
        }
      });
  }

  forRun(runId: string): Verdict[] {
    return this.all().filter((v) => v.run_id === runId);
  }

  /** The newest verdict of a scenario, optionally only decisive ones. */
  latest(scenario: string, decisiveOnly = false): Verdict | undefined {
    const matching = this.all().filter((v) => v.scenario === scenario && (!decisiveOnly || DECISIVE.has(v.outcome)));
    return matching.at(-1);
  }

  /** When a scenario (or one of its registry runs) last actually ran, for cadences longer than its timer. */
  lastRanAt(scenario: string, slot?: number): number | undefined {
    const last = this.all()
      .filter((v) => v.scenario === scenario && SPENT.has(v.outcome) && (slot === undefined || (v.slot ?? 0) === slot))
      .at(-1);
    return last ? Date.parse(last.started_at) : undefined;
  }

  /** Scenarios whose latest decisive verdict is a failure. */
  unresolved(): UnresolvedFailure[] {
    const byScenario = new Map<string, Verdict[]>();
    for (const verdict of this.all()) {
      if (!DECISIVE.has(verdict.outcome)) continue;
      const list = byScenario.get(verdict.scenario) ?? [];
      list.push(verdict);
      byScenario.set(verdict.scenario, list);
    }
    const out: UnresolvedFailure[] = [];
    for (const [scenario, verdicts] of byScenario) {
      const last = verdicts.at(-1)!;
      if (last.outcome === "pass") continue;
      let streak = verdicts.length;
      while (streak > 0 && verdicts[streak - 1]!.outcome !== "pass") streak--;
      const failing = verdicts.slice(streak);
      out.push({
        scenario,
        outcome: last.outcome as "fail" | "infra",
        fingerprint: fingerprintOf(last),
        since: failing[0]!.started_at,
        failing_attempts: failing.length,
        last,
      });
    }
    return out.sort((a, b) => a.since.localeCompare(b.since));
  }

  /** Dials spent by attempts that started in [from, to). */
  dialsBetween(from: number, to = Number.POSITIVE_INFINITY): number {
    return this.all()
      .filter((v) => SPENT.has(v.outcome) && Date.parse(v.started_at) >= from && Date.parse(v.started_at) < to)
      .reduce((sum, v) => sum + v.dials, 0);
  }

  /** Scenario runs (scenario and slot) that spent anything in [from, to). */
  ranBetween(from: number, to: number): Set<string> {
    const ran = new Set<string>();
    for (const v of this.all()) {
      const at = Date.parse(v.started_at);
      if (SPENT.has(v.outcome) && at >= from && at < to) ran.add(`${v.scenario}#${v.slot ?? 0}`);
    }
    return ran;
  }

  saveEvidence(runId: string, attempt: number, evidence: unknown): void {
    const path = this.#evidencePath(runId);
    const existing = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown[]) : [];
    existing.push({ attempt, ...((evidence ?? {}) as object) });
    writeFileSync(path, JSON.stringify(existing));
  }

  evidence(runId: string): unknown[] {
    const path = this.#evidencePath(runId);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown[]) : [];
  }

  #evidencePath(runId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error("verdicts: a run id is letters, digits, - and _");
    return join(this.#evidenceDir, `${runId}.json`);
  }
}

export function fingerprintOf(verdict: Pick<Verdict, "outcome" | "scenario" | "failure_class" | "component">): string[] {
  return verdict.outcome === "infra"
    ? ["synthetic-infra", verdict.component ?? "unknown"]
    : ["synthetic", verdict.scenario, verdict.failure_class ?? "unknown"];
}
