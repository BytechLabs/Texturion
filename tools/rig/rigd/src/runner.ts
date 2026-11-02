/**
 * One scenario run, start to verdict. A run happens when it is asked for.
 *
 * Before anything is spent: the room must hold the scenario, a paid one must
 * start inside the guard's dial window with time to finish there, and the
 * day's and the clock hour's dials must have room for it. Then the run holds
 * the lease, a failing attempt is tried once more, every attempt's verdict is
 * recorded with the SHA, and only a second failure becomes a Sentry event. A
 * failure the doc calls critical is reported at once and not retried.
 */
import { randomBytes } from "node:crypto";
import { LEASE_MAX_MS } from "@loonext/rig-protocol";
import { GuardRefusedError, type Clock } from "@loonext/rig-robot";
import { blockedByRoom, clockHourStart, inWindow, utcDayStart, type DialCaps, type DialWindow } from "./budget.ts";
import { textHash } from "./late.ts";
import { LeaseBusyError, LeaseReapedError, type Lease, type LeaseClient, type ReleaseResult } from "./lease.ts";
import { dialsPerRun, type RegisteredScenario, type Registry, type RunSlot } from "./registry.ts";
import type { LeaseHandle, ScenarioContext, ScenarioHistoryApi, ScenarioLanes, ScenarioResult, ScenarioRunner } from "./scenarios/context.ts";
import { infraFingerprint, syntheticFingerprint, type Dsn, type RelayDecision, type SentryRelay } from "./sentry-relay.ts";
import type { Outcome, Verdict, VerdictStore } from "./verdicts.ts";

/** A paid run must be able to finish before the window shuts. */
const WINDOW_TAIL_MS = 15 * 60 * 1000;
/** An attempt stops itself before the watchdog would reap its lease. */
const ATTEMPT_LIMIT_MS = LEASE_MAX_MS - 60 * 1000;
/** A runner's setup before the lease is bounded too. */
const PREPARE_LIMIT_MS = 2 * 60 * 60 * 1000;
/** How long a prepare past its limit is waited for before its change is put back; the lane hold covers it. */
const PREPARE_SETTLE_MS = ATTEMPT_LIMIT_MS;
/** Two paid runs in one hour start minutes apart; the second waits this long for the first's lease. */
const LEASE_WAIT_MS = 20 * 60 * 1000;
const LEASE_POLL_MS = 30 * 1000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface RunnerDeps {
  registry: Registry;
  runners: Readonly<Record<string, ScenarioRunner>>;
  verdicts: VerdictStore;
  leases: Pick<LeaseClient, "acquire">;
  /** A lease for a run that dials nothing: undo journal only, no guard. */
  localLease(scenario: string): Lease | Promise<Lease>;
  /** The robot, app probe, browser lane and the rest of the rig, for one attempt. */
  lanes(attempt: { scenario: string; runId: string; attempt: number }): ScenarioLanes;
  relay?: SentryRelay;
  syntheticDsn?: Dsn;
  /** The deployed SHA: `rig deploy` writes it. */
  sha(): string;
  room(): number;
  /** The window the guard admits dials in: its measured one, else the registry's. */
  dialWindow(): Promise<DialWindow>;
  caps: DialCaps;
  clock: Clock;
  sleep(ms: number): Promise<void>;
  /**
   * Texts this attempt sent that reached the API only after Telnyx's
   * signature had aged out (late.ts), matched by body.
   */
  lateDeliveries?(query: { since: number; texts: ReadonlySet<string> }): number;
  /** Lanes a run holds outside any lease, while it prepares. */
  holds?: LaneHolds;
  /** Why a deploy holds the rig for a schema change, while it does (tools/rig/src/deploy-hold.mjs). */
  deployHold?(): string | undefined;
  log?(line: string): void;
}

/**
 * A run that prepares before its lease holds its lane for the whole attempt,
 * so no other run uses that device under it. A hold lapses by itself, so a
 * run that died cannot keep it.
 */
export interface LaneHolds {
  holder(lane: string, now: number): { scenario: string; run_id: string } | undefined;
  claim(lane: string, holder: { scenario: string; run_id: string }, until: number): void;
  release(lane: string, runId: string): void;
}

export interface RunOptions {
  /** Which of the scenario's registry runs to make, from 0. */
  slot?: number;
  /** Chosen by the caller, so `triage.rerun` can name the run before it finishes. */
  runId?: string;
}

export interface RunSummary {
  scenario: string;
  run_id?: string;
  status: Outcome;
  verdicts: Verdict[];
  report?: RelayDecision;
  detail?: string;
}

const RUN_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function newRunId(scenario: string, at: number): string {
  return `${scenario}-${new Date(at).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
}

export async function runScenario(deps: RunnerDeps, id: string, options: RunOptions = {}): Promise<RunSummary> {
  const entry = deps.registry.byId.get(id);
  if (!entry) throw new Error(`${id} is not in the scenario registry`);
  const runner = deps.runners[id];
  if (!runner) throw new Error(`rigd has no runner for ${id}`);
  const slot = entry.runs[options.slot ?? 0];
  if (!slot) throw new Error(`${id} has no run ${options.slot} in the registry`);
  if (options.runId !== undefined && !RUN_ID.test(options.runId)) throw new Error("a run id is letters, digits, - and _");
  const window = await deps.dialWindow();
  const now = deps.clock.now();

  const sha = deps.sha();
  const runId = options.runId ?? newRunId(id, now);
  const verdicts: Verdict[] = [];
  const record = (attempt: number, startedAt: number, result: AttemptOutcome | Gate, dials: number) => {
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
      ...(options.slot ? { slot: options.slot } : {}),
      ...(result.critical ? { critical: true } : {}),
    });
    verdicts.push(verdict);
    return verdict;
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      const at = retryAt(deps, entry, deps.clock.now(), window);
      if (at === undefined) {
        record(attempt, deps.clock.now(), { outcome: "skipped", detail: "no hour left in the dial window has room for the retry; run it again to finish" }, 0);
        break;
      }
      const wait = at - deps.clock.now();
      if (wait > 0) {
        deps.log?.(`${id}: waiting ${Math.round(wait / 60_000)} min for an hour with room before the retry`);
        await deps.sleep(wait);
      }
    }
    const startedAt = deps.clock.now();
    const gate = admission(deps, entry, startedAt, window);
    if (gate) {
      record(attempt, startedAt, gate, 0);
      break;
    }
    const outcome = await attemptOnce(deps, entry, runner, runId, attempt, sha, window, slot);
    record(attempt, startedAt, outcome, outcome.spent ? dialsPerRun(entry) : 0);
    if (outcome.critical) break;
    if (!RETRIED.has(outcome.outcome)) break;
    if (attempt === 1) deps.log?.(`${id}: attempt 1 ${outcome.outcome} (${outcome.detail ?? ""}); retrying once`);
  }
  return finish(deps, entry, runId, verdicts);
}

const RETRIED: ReadonlySet<Outcome> = new Set(["fail", "infra", "late_delivery"]);

interface Gate {
  outcome: Outcome;
  detail: string;
  failure_class?: undefined;
  component?: undefined;
  critical?: undefined;
}

/** Why a run may not start now, or undefined when it may. */
function admission(deps: RunnerDeps, entry: RegisteredScenario, now: number, window: DialWindow): Gate | undefined {
  const dials = dialsPerRun(entry);
  const held = deps.deployHold?.();
  if (held) return { outcome: "skipped", detail: held };
  if (blockedByRoom(entry, deps.room())) {
    return { outcome: "not_runnable", detail: `room ${deps.room()} is under ${Math.max(2, entry.room_min)}` };
  }
  if (dials === 0) return undefined;
  if (!inWindow(window, now) || !inWindow(window, now + WINDOW_TAIL_MS)) {
    return { outcome: "skipped", detail: `outside the dial window (${String(window.startHour).padStart(2, "0")}:00 UTC for ${window.hours} h)` };
  }
  const day = utcDayStart(now);
  if (deps.verdicts.dialsBetween(day, day + DAY_MS) + dials > deps.caps.daily) {
    return { outcome: "skipped", detail: `the daily cap of ${deps.caps.daily} dials is spent` };
  }
  const hour = clockHourStart(now);
  if (deps.verdicts.dialsBetween(hour, hour + HOUR_MS) + dials > deps.caps.hourly) {
    return { outcome: "skipped", detail: `the hourly cap of ${deps.caps.hourly} dials is spent` };
  }
  return undefined;
}

/**
 * When the retry may start: now, or the first clock hour left in the dial
 * window whose cap holds it. Undefined when no hour today does.
 */
function retryAt(deps: RunnerDeps, entry: RegisteredScenario, now: number, window: DialWindow): number | undefined {
  const dials = dialsPerRun(entry);
  if (dials === 0) return now;
  const today = utcDayStart(now);
  if (deps.verdicts.dialsBetween(today, today + DAY_MS) + dials > deps.caps.daily) return undefined;
  for (let k = 0; k < 24; k++) {
    const hour = clockHourStart(now) + k * HOUR_MS;
    const at = k === 0 ? now : hour + 60_000;
    if (!inWindow(window, at) || !inWindow(window, at + WINDOW_TAIL_MS)) break;
    if (deps.verdicts.dialsBetween(hour, hour + HOUR_MS) + dials <= deps.caps.hourly) return at;
  }
  return undefined;
}

type AttemptOutcome = {
  outcome: Outcome;
  failure_class?: string;
  component?: string;
  detail?: string;
  critical?: boolean;
  spent: boolean;
};

/** A lane another run holds is waited for as a busy lease is. */
async function acquireLease(
  deps: RunnerDeps,
  entry: RegisteredScenario,
  runner: ScenarioRunner,
  runId: string,
  window: DialWindow,
): Promise<Lease | AttemptOutcome> {
  const paid = dialsPerRun(entry) > 0;
  const atGuard = paid || runner.guardLease === true;
  const started = deps.clock.now();
  const waited = () => Math.round((deps.clock.now() - started) / 60_000);
  for (;;) {
    const holder = deps.holds?.holder(entry.lane, deps.clock.now());
    if (holder && holder.run_id !== runId) {
      const next = deps.clock.now() + LEASE_POLL_MS;
      if (next - started <= LEASE_WAIT_MS && (!paid || inWindow(window, next + WINDOW_TAIL_MS))) {
        await deps.sleep(LEASE_POLL_MS);
        continue;
      }
      return { outcome: "skipped", detail: `${holder.scenario} held the ${entry.lane} lane for ${waited()} min while it prepared`, spent: false };
    }
    try {
      if (!atGuard) return await deps.localLease(entry.id);
      return await deps.leases.acquire(entry.id, paid ? {} : { dials: false });
    } catch (error) {
      if (error instanceof LeaseBusyError) {
        const next = deps.clock.now() + LEASE_POLL_MS;
        // Only a paid run has the dial window to finish inside.
        if (next - started <= LEASE_WAIT_MS && (!paid || inWindow(window, next + WINDOW_TAIL_MS))) {
          await deps.sleep(LEASE_POLL_MS);
          continue;
        }
        return { outcome: "skipped", detail: `another scenario held the lease for ${waited()} min`, spent: false };
      }
      // Only a busy lease is a reason to skip. Any other refusal, a rejected
      // token or a guard that does not answer is the rig's fault to report.
      if (error instanceof GuardRefusedError) {
        return { outcome: "infra", component: "guard", detail: `the guard refused the lease: ${error.rule}`, spent: false };
      }
      return { outcome: "infra", component: "lease", detail: (error as Error).message, spent: false };
    }
  }
}

async function attemptOnce(
  deps: RunnerDeps,
  entry: RegisteredScenario,
  runner: ScenarioRunner,
  runId: string,
  attempt: number,
  sha: string,
  window: DialWindow,
  slot: RunSlot,
): Promise<AttemptOutcome> {
  const holds = runner.prepare ? deps.holds : undefined;
  holds?.claim(entry.lane, { scenario: entry.id, run_id: runId }, deps.clock.now() + PREPARE_LIMIT_MS + ATTEMPT_LIMIT_MS);
  try {
    return await attemptHeld(deps, entry, runner, runId, attempt, sha, window, slot);
  } finally {
    holds?.release(entry.lane, runId);
  }
}

async function attemptHeld(
  deps: RunnerDeps,
  entry: RegisteredScenario,
  runner: ScenarioRunner,
  runId: string,
  attempt: number,
  sha: string,
  window: DialWindow,
  slot: RunSlot,
): Promise<AttemptOutcome> {
  const paid = dialsPerRun(entry) > 0;
  const evidence: Record<string, unknown> = { sha, lane: entry.lane };
  const texts = new Set<string>();
  const lanes = deps.lanes({ scenario: entry.id, runId, attempt });
  const base = {
    scenario: entry.id,
    runId,
    attempt,
    slot: { index: slot.index, ...(slot.label ? { label: slot.label } : {}) },
    now: () => deps.clock.now(),
    sleep: deps.sleep,
    nonce: `${runId}-${attempt}`.slice(-24),
    evidence,
    history: historyOf(deps, entry.id),
    laneHeldBy(lane: string) {
      const holder = deps.holds?.holder(lane, deps.clock.now());
      return holder && holder.run_id !== runId ? holder.scenario : undefined;
    },
    blockedAt(room: number) {
      return deps.registry.scenarios.filter((scenario) => scenario.runsOn === "rig" && blockedByRoom(scenario, room)).map((scenario) => scenario.id);
    },
  };

  const unleased: LeaseHandle = {
    id: "",
    registerUndo() {
      throw new Error("prepare runs before the lease; register undos in run");
    },
  };
  // No lease holds an undo for what a finished prepare changed, so the runner puts it back when no run follows.
  const abandon = async () => {
    try {
      await runner.abandon?.({ ...base, ...lanes, lease: unleased });
    } catch (error) {
      evidence.abandon_error = error instanceof Error ? error.message : String(error);
    }
  };
  if (runner.prepare) {
    let prepared: ScenarioResult | undefined;
    let returned: { value: ScenarioResult | undefined } | undefined;
    let settled = false;
    const preparing = runner
      .prepare({ ...base, ...lanes, lease: unleased })
      .then((value) => ((returned = { value }), value))
      .finally(() => (settled = true));
    try {
      prepared = await withLimit(preparing, PREPARE_LIMIT_MS, deps);
    } catch (error) {
      prepared = attemptError(error);
    }
    if (prepared) {
      // A prepare that returned its own result put back what it changed. One
      // that threw or ran out of time did not, and one still running may yet.
      if (returned?.value !== prepared) {
        if (!settled) await withLimit(preparing.catch(() => undefined), PREPARE_SETTLE_MS, deps);
        await abandon();
      }
      deps.verdicts.saveEvidence(runId, attempt, evidence);
      return { ...outcomeOf(prepared), spent: false };
    }
    if (paid && !inWindow(window, deps.clock.now() + WINDOW_TAIL_MS)) {
      await abandon();
      deps.verdicts.saveEvidence(runId, attempt, evidence);
      return { outcome: "skipped", detail: "the dial window closed while the run prepared", spent: false };
    }
  }

  const acquired = await acquireLease(deps, entry, runner, runId, window);
  if (!("id" in acquired)) {
    if (runner.prepare) {
      await abandon();
      deps.verdicts.saveEvidence(runId, attempt, evidence);
    }
    return acquired;
  }
  const lease = acquired;
  const attemptStartedAt = deps.clock.now();

  const ctx: ScenarioContext = {
    ...base,
    lease,
    browser: lanes.browser,
    guard: lanes.guard,
    devices: lanes.devices,
    rig: lanes.rig,
    mail: lanes.mail,
    stripe: lanes.stripe,
    handoff: lanes.handoff,
    robot: noting(lanes.robot, "sms", (message: { text: string }) => texts.add(textHash(message.text))),
    app: noting(lanes.app, "sendText", (args: { body: string }) => texts.add(textHash(args.body))),
  };

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
  // The after-release check reads what the undos left behind, so it runs
  // whatever the attempt came to: a run that failed half way is the one most
  // likely to have left a change in place.
  if (runner.afterRelease) {
    try {
      const after = await runner.afterRelease(ctx);
      if (after && after.outcome !== "pass") result = after;
    } catch (error) {
      evidence.after_release_error = error instanceof Error ? error.message : String(error);
      if (result.outcome === "pass") result = attemptError(error);
    }
  }

  const critical = result.outcome === "fail" && result.critical === true;
  const failureClass = result.outcome === "fail" && !critical ? result.failure_class : undefined;
  // A failure while this attempt's own texts reached the API too late to
  // verify measures the delay, not the product; it is retried, not reported.
  const late = failureClass && texts.size > 0 ? (deps.lateDeliveries?.({ since: attemptStartedAt, texts }) ?? 0) : 0;
  if (late > 0) {
    evidence.late_deliveries = late;
    deps.verdicts.saveEvidence(runId, attempt, evidence);
    return {
      outcome: "late_delivery",
      detail: `${late} of this attempt's text(s) reached the API after Telnyx's signature window; ${failureClass} not counted`,
      spent: paid,
    };
  }
  deps.verdicts.saveEvidence(runId, attempt, evidence);
  const { outcome } = result;
  return {
    outcome,
    failure_class: result.outcome === "fail" ? result.failure_class : undefined,
    component: result.outcome === "infra" ? result.component : undefined,
    detail: "detail" in result ? result.detail : undefined,
    ...(critical ? { critical: true } : {}),
    spent: paid,
  };
}

function historyOf(deps: RunnerDeps, scenario: string): ScenarioHistoryApi {
  return {
    async attempts({ since }) {
      return deps.verdicts
        .all()
        .filter((v) => v.scenario === scenario && Date.parse(v.finished_at) >= since)
        .reverse()
        .map((v) => ({
          run_id: v.run_id,
          attempt: v.attempt,
          outcome: v.outcome,
          finished_at: v.finished_at,
          evidence: (deps.verdicts.evidence(v.run_id).find((e) => (e as { attempt?: unknown }).attempt === v.attempt) as Record<string, unknown> | undefined) ?? null,
        }));
    },
  };
}

/** The same object, with one method also telling `note` what it was called with. */
function noting<T extends object, A>(target: T, method: string, note: (arg: A) => void): T {
  return new Proxy(target, {
    get(object, property) {
      const value: unknown = Reflect.get(object, property);
      if (typeof value !== "function") return value;
      if (property !== method) return value.bind(object);
      return (arg: A, ...rest: unknown[]) => {
        note(arg);
        return (value as (...args: unknown[]) => unknown).call(object, arg, ...rest);
      };
    },
  });
}

function outcomeOf(result: ScenarioResult): Omit<AttemptOutcome, "spent"> {
  return {
    outcome: result.outcome,
    failure_class: result.outcome === "fail" ? result.failure_class : undefined,
    component: result.outcome === "infra" ? result.component : undefined,
    detail: "detail" in result ? result.detail : undefined,
    ...(result.outcome === "fail" && result.critical ? { critical: true } : {}),
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

const DECISIVE: ReadonlySet<Outcome> = new Set(["pass", "fail", "infra"]);

async function finish(deps: RunnerDeps, entry: RegisteredScenario, runId: string, verdicts: Verdict[]): Promise<RunSummary> {
  const last = verdicts.at(-1)!;
  const summary: RunSummary = { scenario: entry.id, run_id: runId, status: last.outcome, verdicts, detail: last.detail };
  // The event describes this run's last attempt that actually judged
  // something, never a later "skipped" from the window or the cap.
  const judged = verdicts.filter((v) => DECISIVE.has(v.outcome)).at(-1);
  if (!judged || judged.outcome === "pass" || !deps.relay || !deps.syntheticDsn) return summary;

  const critical = verdicts.find((v) => v.critical);
  // Retried once before it is reported: the scenario's last two decisive
  // attempts both failed, and the newer is this run's. A retry the window or
  // the cap stopped is finished by the next run's first attempt.
  const decisive = deps.verdicts.all().filter((v) => v.scenario === entry.id && DECISIVE.has(v.outcome));
  const lastTwo = decisive.slice(-2);
  const failedTwice = lastTwo.length === 2 && lastTwo.every((v) => v.outcome !== "pass") && lastTwo[1]!.run_id === runId;
  if (!critical && !failedTwice) return summary;

  const reported = critical ?? judged;
  const fingerprint =
    reported.outcome === "infra"
      ? infraFingerprint(reported.component ?? "unknown")
      : syntheticFingerprint(entry.id, reported.failure_class ?? "unknown");
  summary.report = await deps.relay.send(deps.syntheticDsn, {
    fingerprint,
    message: `${entry.id} ${reported.outcome === "infra" ? `infrastructure: ${reported.component}` : `failed: ${reported.failure_class}`}${critical ? " (critical)" : ""}`,
    level: critical ? "fatal" : "error",
    runId,
    release: reported.sha,
    tags: { scenario: entry.id, lane: entry.lane, sha: reported.sha, ...(critical ? { critical: "true" } : {}) },
    extra: { detail: reported.detail, run_id: runId },
  });
  return summary;
}
