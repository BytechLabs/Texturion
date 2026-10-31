/**
 * One scenario run, start to verdict.
 *
 * Before anything is spent: the scenario must be due, the room must hold it,
 * a paid one must start inside the dial window with time to finish there, and
 * the day's and the hour's dials must have room for it. Then the run holds
 * the lease, a failing attempt is tried once more, every attempt's verdict is
 * recorded with the SHA, and only a second failure becomes a Sentry event.
 */
import { randomBytes } from "node:crypto";
import { LEASE_MAX_MS } from "@loonext/rig-protocol";
import { GuardRefusedError, type Clock } from "@loonext/rig-robot";
import { blockedByRoom, inWindow, type DialCaps, type DialWindow } from "./budget.ts";
import { LeaseBusyError, LeaseReapedError, type Lease, type LeaseClient, type ReleaseResult } from "./lease.ts";
import { dialsPerRun, type RegisteredScenario } from "./registry.ts";
import type { ScenarioContext, ScenarioResult, ScenarioRunner } from "./scenarios/context.ts";
import { infraFingerprint, syntheticFingerprint, type Dsn, type RelayDecision, type SentryRelay } from "./sentry-relay.ts";
import type { Outcome, Verdict, VerdictStore } from "./verdicts.ts";

/** A paid run must be able to finish before the window shuts. */
const WINDOW_TAIL_MS = 15 * 60 * 1000;
/** A cadence's run is due this long before its period is up, so a daily timer never slips a day. */
const DUE_SLACK_MS = 2 * 60 * 60 * 1000;
/** An attempt stops itself before the watchdog would reap its lease. */
const ATTEMPT_LIMIT_MS = LEASE_MAX_MS - 60 * 1000;
/** The longest a retry waits for the hourly cap; the run's unit allows for it. */
const MAX_RETRY_WAIT_MS = 65 * 60 * 1000;

export interface RunnerDeps {
  registry: ReadonlyMap<string, RegisteredScenario>;
  runners: Readonly<Record<string, ScenarioRunner>>;
  verdicts: VerdictStore;
  leases: Pick<LeaseClient, "acquire">;
  /** A lease for a run that dials nothing: undo journal only, no guard. */
  localLease(scenario: string): Lease | Promise<Lease>;
  /** The robot, app probe and browser lane for one attempt. */
  lanes(attempt: { scenario: string; runId: string; attempt: number }): Pick<ScenarioContext, "robot" | "app" | "browser">;
  relay?: SentryRelay;
  syntheticDsn?: Dsn;
  /** The deployed SHA: `rig deploy` writes it. */
  sha(): string;
  room(): number;
  window: DialWindow;
  caps: DialCaps;
  clock: Clock;
  sleep(ms: number): Promise<void>;
  /** Texts that reached the API after their signature aged out, since a time (late.ts). */
  lateDeliveries?(since: number): number;
  /** Marks the suite heartbeat for the dead-man. */
  ran?(at: number): void;
  log?(line: string): void;
}

export interface RunOptions {
  /** Started by a timer: honour the cadence. A manual or triage run is always due. */
  scheduled?: boolean;
}

export interface RunSummary {
  scenario: string;
  run_id?: string;
  status: "not_due" | Outcome;
  verdicts: Verdict[];
  report?: RelayDecision;
  detail?: string;
}

export async function runScenario(deps: RunnerDeps, id: string, options: RunOptions = {}): Promise<RunSummary> {
  const entry = deps.registry.get(id);
  if (!entry) throw new Error(`${id} is not in the scenario registry`);
  const runner = deps.runners[id];
  if (!runner) throw new Error(`rigd has no runner for ${id}`);
  const now = deps.clock.now();
  if (options.scheduled && !isDue(deps, entry, now)) return { scenario: id, status: "not_due", verdicts: [] };

  const sha = deps.sha();
  const runId = `${id}-${new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
  const verdicts: Verdict[] = [];
  const record = (attempt: number, startedAt: number, result: { outcome: Outcome; failure_class?: string; component?: string; detail?: string }, dials: number) => {
    const verdict = deps.verdicts.record({
      run_id: runId,
      scenario: id,
      sha,
      attempt,
      outcome: result.outcome,
      failure_class: result.failure_class,
      component: result.component,
      detail: result.detail,
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date(deps.clock.now()).toISOString(),
      dials,
      scheduled: Boolean(options.scheduled),
    });
    verdicts.push(verdict);
    return verdict;
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      // Three dials an hour leave no room to retry a two-dial run at once; it
      // waits for the hour to roll over, if the window is still open then.
      const wait = retryWait(deps, entry, deps.clock.now());
      if (wait > 0) {
        deps.log?.(`${id}: waiting ${Math.round(wait / 60_000)} min for the hourly dial cap before the retry`);
        await deps.sleep(wait);
      }
    }
    const startedAt = deps.clock.now();
    const gate = admission(deps, entry, startedAt);
    if (gate) {
      record(attempt, startedAt, gate, 0);
      return finish(deps, entry, runId, verdicts);
    }
    const outcome = await attemptOnce(deps, entry, runner, runId, attempt, sha);
    record(attempt, startedAt, outcome, outcome.spent ? dialsPerRun(entry) : 0);
    if (!(outcome.outcome === "fail" || outcome.outcome === "infra")) break;
    if (attempt === 1) deps.log?.(`${id}: attempt 1 ${outcome.outcome} (${outcome.detail ?? ""}); retrying once`);
  }
  return finish(deps, entry, runId, verdicts);
}

function isDue(deps: RunnerDeps, entry: RegisteredScenario, now: number): boolean {
  const { cadence } = entry;
  if (cadence.kind !== "days" || cadence.everyDays <= 1) return true;
  const last = deps.verdicts.lastRanAt(entry.id);
  return last === undefined || now - last >= cadence.everyDays * 86_400_000 - DUE_SLACK_MS;
}

/** Why a run may not start now, or undefined when it may. */
function admission(deps: RunnerDeps, entry: RegisteredScenario, now: number) {
  const dials = dialsPerRun(entry);
  if (blockedByRoom(entry, deps.room())) {
    return { outcome: "not_runnable" as const, detail: `room ${deps.room()} is under ${Math.max(2, entry.room_min)}` };
  }
  if (dials === 0) return undefined;
  if (!entry.paid) return { outcome: "not_runnable" as const, detail: "dials without paid: the registry is wrong" };
  if (!inWindow(deps.window, now) || !inWindow(deps.window, now + WINDOW_TAIL_MS)) {
    return { outcome: "skipped" as const, detail: "outside the dial window" };
  }
  if (deps.verdicts.dialsSince(now - 86_400_000) + dials > deps.caps.daily) {
    return { outcome: "skipped" as const, detail: `the daily cap of ${deps.caps.daily} dials is spent` };
  }
  if (deps.verdicts.dialsSince(now - 3_600_000) + dials > deps.caps.hourly) {
    return { outcome: "skipped" as const, detail: `the hourly cap of ${deps.caps.hourly} dials is spent` };
  }
  return undefined;
}

/** How long until the hourly cap admits the retry, or 0 when waiting would not help. */
function retryWait(deps: RunnerDeps, entry: RegisteredScenario, now: number): number {
  const dials = dialsPerRun(entry);
  if (dials === 0 || deps.verdicts.dialsSince(now - 3_600_000) + dials <= deps.caps.hourly) return 0;
  const recent = deps.verdicts
    .all()
    .map((v) => ({ at: Date.parse(v.started_at), dials: v.dials }))
    .filter((v) => v.dials > 0 && v.at >= now - 3_600_000)
    .sort((a, b) => a.at - b.at);
  for (const { at } of recent) {
    const when = at + 3_600_000 + 1_000;
    if (when - now > MAX_RETRY_WAIT_MS) return 0;
    if (!inWindow(deps.window, when) || !inWindow(deps.window, when + WINDOW_TAIL_MS)) return 0;
    if (deps.verdicts.dialsSince(when - 3_600_000) + dials <= deps.caps.hourly) return when - now;
  }
  return 0;
}

type AttemptOutcome ={ outcome: Outcome; failure_class?: string; component?: string; detail?: string; spent: boolean };

async function attemptOnce(
  deps: RunnerDeps,
  entry: RegisteredScenario,
  runner: ScenarioRunner,
  runId: string,
  attempt: number,
  sha: string,
): Promise<AttemptOutcome> {
  const paid = dialsPerRun(entry) > 0;
  const attemptStartedAt = deps.clock.now();
  let lease: Lease;
  try {
    lease = paid ? await deps.leases.acquire(entry.id) : await deps.localLease(entry.id);
  } catch (error) {
    if (error instanceof LeaseBusyError) return { outcome: "skipped", detail: "another scenario holds the lease", spent: false };
    if (error instanceof GuardRefusedError) return { outcome: "skipped", detail: `the guard refused the lease: ${error.rule}`, spent: false };
    return { outcome: "infra", component: "lease", detail: (error as Error).message, spent: false };
  }

  const evidence: Record<string, unknown> = { sha, lane: entry.lane };
  const base = {
    scenario: entry.id,
    runId,
    attempt,
    lease,
    now: () => deps.clock.now(),
    sleep: deps.sleep,
    nonce: `${runId}-${attempt}`.slice(-24),
    evidence,
  };
  const ctx: ScenarioContext = { ...base, ...deps.lanes({ scenario: entry.id, runId, attempt }) };

  let result: ScenarioResult;
  try {
    result = await withLimit(runner.run(ctx), ATTEMPT_LIMIT_MS, deps);
  } catch (error) {
    result = attemptError(error);
  }
  let released: ReleaseResult | undefined;
  try {
    await ctx.browser.closeAll();
  } catch (error) {
    deps.log?.(`${entry.id}: closing the lanes failed: ${(error as Error).message}`);
  }
  try {
    released = await lease.release();
  } catch (error) {
    result = { outcome: "infra", component: "lease", detail: `release failed: ${(error as Error).message}` };
  }
  evidence.lease = released;
  if (released?.reaped && result.outcome === "pass") {
    result = { outcome: "infra", component: "lease", detail: "the watchdog reaped the lease before the run finished" };
  } else if (released && released.failed.length > 0) {
    result = {
      outcome: "infra",
      component: "lease-undo",
      detail: `undo failed: ${released.failed.map((f) => `${f.kind} (${f.error})`).join(", ")}`,
    };
  }
  if (runner.afterRelease && result.outcome === "pass") {
    try {
      result = (await runner.afterRelease(ctx)) ?? result;
    } catch (error) {
      result = attemptError(error);
    }
  }
  // A failure while texts were arriving too late to verify measures the outage, not the product.
  const failureClass = result.outcome === "fail" ? result.failure_class : undefined;
  const late = failureClass ? (deps.lateDeliveries?.(attemptStartedAt) ?? 0) : 0;
  if (late > 0) {
    evidence.late_deliveries = late;
    deps.verdicts.saveEvidence(runId, attempt, evidence);
    return {
      outcome: "late_delivery",
      detail: `${late} text(s) reached the API after Telnyx's signature window; ${failureClass} not counted`,
      spent: paid,
    };
  }
  deps.verdicts.saveEvidence(runId, attempt, evidence);
  const { outcome } = result;
  return {
    outcome,
    failure_class: outcome === "fail" ? result.failure_class : undefined,
    component: outcome === "infra" ? result.component : undefined,
    detail: "detail" in result ? result.detail : undefined,
    spent: paid,
  };
}

function attemptError(error: unknown): ScenarioResult {
  if (error instanceof LeaseReapedError) return { outcome: "infra", component: "lease", detail: error.message };
  if (error instanceof GuardRefusedError) return { outcome: "infra", component: "guard", detail: `guard_refused:${error.rule}` };
  return { outcome: "infra", component: "runner", detail: error instanceof Error ? error.message : String(error) };
}

function withLimit<T>(promise: Promise<T>, ms: number, deps: RunnerDeps): Promise<T | ScenarioResult> {
  let cancel: (() => void) | undefined;
  const limit = new Promise<ScenarioResult>((resolve) => {
    cancel = deps.clock.after(ms, () =>
      resolve({ outcome: "infra", component: "runner", detail: `the attempt ran past ${Math.round(ms / 60_000)} minutes` }),
    );
  });
  return Promise.race([promise, limit]).finally(() => cancel?.());
}

async function finish(deps: RunnerDeps, entry: RegisteredScenario, runId: string, verdicts: Verdict[]): Promise<RunSummary> {
  const last = verdicts.at(-1)!;
  deps.ran?.(deps.clock.now());
  const summary: RunSummary = { scenario: entry.id, run_id: runId, status: last.outcome, verdicts, detail: last.detail };
  // Retried once before it is reported: the scenario's last two decisive
  // attempts both failed, and the newer is this run's. A retry the window or
  // the cap stopped is finished by the next run's first attempt.
  const decisive = deps.verdicts.all().filter((v) => v.scenario === entry.id && ["pass", "fail", "infra"].includes(v.outcome));
  const lastTwo = decisive.slice(-2);
  const failedTwice =
    lastTwo.length === 2 && lastTwo.every((v) => v.outcome === "fail" || v.outcome === "infra") && lastTwo[1]!.run_id === runId;
  if (failedTwice && deps.relay && deps.syntheticDsn) {
    const fingerprint =
      last.outcome === "infra" ? infraFingerprint(last.component ?? "unknown") : syntheticFingerprint(entry.id, last.failure_class ?? "unknown");
    summary.report = await deps.relay.send(deps.syntheticDsn, {
      fingerprint,
      message: `${entry.id} ${last.outcome === "infra" ? `infrastructure: ${last.component}` : `failed: ${last.failure_class}`}`,
      runId,
      release: last.sha,
      tags: { scenario: entry.id, lane: entry.lane, sha: last.sha },
      extra: { detail: last.detail, run_id: runId },
    });
  }
  return summary;
}
