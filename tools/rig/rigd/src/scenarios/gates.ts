/**
 * The gate and isolation scenarios: G01, S12, S13, S14, S15, S16, S17 and
 * S26. Each proves that something is refused, held or dropped, so each first
 * makes sure the thing it refuses would otherwise have happened: a seed read
 * back, a ring that proves the call reached ringing, a draft before the AI is
 * killed. A refusal is judged by its own gate's code, never by the absence of
 * success alone.
 */
import type { LeaseActivity } from "@loonext/rig-protocol";
import type { CallRecord } from "@loonext/rig-robot";
import type { SeenEvent } from "../sentry-relay.ts";
import {
  fail,
  FICTIONAL_E164,
  GUARD_PROBES,
  infra,
  pass,
  poll,
  wordErrorRate,
  type ApiAnswer,
  type GuardProbe,
  type MemberPageApi,
  type ScenarioContext,
  type ScenarioResult,
  type ScenarioRunner,
  type WebhookDelivery,
} from "./context.ts";

const DAY_MS = 86_400_000;
const W_OWNER = "qa-w-owner";
const C_OWNER = "qa-c-owner";

/** Requests a caller made to one Telnyx endpoint while the lease was live, whatever the outcome. */
export function guardCount(activity: LeaseActivity, caller: string, endpoint: string): number {
  const prefix = `${caller} ${endpoint} `;
  return Object.entries(activity.activity).reduce((sum, [key, count]) => (key.startsWith(prefix) ? sum + count : sum), 0);
}

/**
 * The app's requests the guard refused for an unowned destination: a send or
 * dial the app should have refused itself. Only the app's own (`rig-api`)
 * count, since G01's guard probes are the robot's and other runs' texts are
 * forwarded, not refused.
 */
export function appRefusedForUnowned(activity: LeaseActivity): number {
  return Object.entries(activity.activity).reduce(
    (sum, [key, count]) =>
      key.startsWith("rig-api ") && (key.endsWith(" message.to_not_owned") || key.endsWith(" dial.to_not_owned")) ? sum + count : sum,
    0,
  );
}

function callEvidence(record: CallRecord): Record<string, unknown> {
  return {
    ids: record.ids,
    state: record.state,
    dialed_at: record.dialed_at,
    answered_at: record.answered_at,
    ended_at: record.ended_at,
    hangup: record.hangup,
    errors: record.errors,
  };
}

function dialRefused(record: CallRecord): ScenarioResult | undefined {
  if (record.state !== "failed") return undefined;
  const refusal = record.errors.find((e) => e.startsWith("guard_refused:"));
  return infra(refusal ? "guard" : "robot", record.errors.join("; ") || "the robot could not place the call");
}

function refusalOf(answer: { status: number; code?: string }): string {
  return answer.code ? `${answer.status} ${answer.code}` : String(answer.status);
}

/** A critical failure outranks any other, and any failure outranks a check that could not be made. */
function worst(results: ScenarioResult[]): ScenarioResult {
  return (
    results.find((r) => r.outcome === "fail" && r.critical) ??
    results.find((r) => r.outcome === "fail") ??
    results.find((r) => r.outcome === "infra") ??
    pass()
  );
}

/** The rule each probe must be refused under; a refusal for another reason has not exercised that rule. */
export const PROBE_RULES: Readonly<Record<GuardProbe, string>> = {
  "foreign-connection": "dial.connection_not_nonprod",
  "text-from-outside": "message.from_not_owned",
  "dial-to-unowned": "dial.to_not_owned",
};

const RIG_DESTINATION_REFUSED = "rig_destination_refused";
const STRANGER_TEXT_WAIT_MS = 30_000;
/** The API reports its own errors in the background; the relay has them well within this. */
const API_ERROR_WAIT_MS = 30_000;
const COMPOSE_ROUTE = "POST /v1/conversations";
const BROWSER_CALL_ROUTE = "POST /v1/calls/browser";

/** The API's own report of a route's error, naming rig mode's destination gate. */
function gateRefusedOn(event: SeenEvent, route: string): boolean {
  return event.tags?.route === route && (event.exceptions ?? []).some((e) => e.value.includes(RIG_DESTINATION_REFUSED));
}

/**
 * Whether an API error report is one of G01's own refusals, for the relay's
 * explainer: each run leaves two 500s that would otherwise read as
 * unexplained for a day. Only inside a G01 attempt, since the same report at
 * any other time is the app reaching for a stranger by itself.
 */
export function g01Refusal(event: SeenEvent, attempts: readonly { started_at: string; finished_at: string }[]): boolean {
  if (!gateRefusedOn(event, COMPOSE_ROUTE) && !gateRefusedOn(event, BROWSER_CALL_ROUTE)) return false;
  return attempts.some((a) => Date.parse(a.started_at) <= event.at && event.at <= Date.parse(a.finished_at) + API_ERROR_WAIT_MS);
}

const FICTIONAL = {
  text: {
    route: COMPOSE_ROUTE,
    noun: "a text",
    succeeded: () => fail("fictional_text_sent", "the API sent a text to a 555-01xx number", { critical: true }),
  },
  dial: {
    route: BROWSER_CALL_ROUTE,
    noun: "a call",
    succeeded: () => fail("fictional_dial_placed", "the API authorised a call to a 555-01xx number", { critical: true }),
  },
} as const;

/**
 * A send or dial to a fictional number, which only rig mode's destination
 * gate may refuse, judged by the gate's own code. The Worker's gate files a
 * text as failed with the code. The database's, which both routes reach
 * first, raises it, so the route answers 500 and the API's error report
 * carries it.
 */
async function judgeFictional(
  ctx: ScenarioContext,
  what: keyof typeof FICTIONAL,
  answer: { ok: true } | { ok: false; status: number; code?: string },
  since: number,
): Promise<ScenarioResult | undefined> {
  const { route, noun, succeeded } = FICTIONAL[what];
  if (answer.ok) {
    ctx.evidence[`fictional_${what}`] = { refused: false };
    return succeeded();
  }
  const evidence: Record<string, unknown> = { status: answer.status, code: answer.code ?? null };
  ctx.evidence[`fictional_${what}`] = evidence;
  if (answer.code === RIG_DESTINATION_REFUSED) {
    evidence.gate = "message";
    return undefined;
  }
  if (answer.status === 500) {
    let reported: boolean | undefined;
    try {
      reported = await poll(ctx, async () => (await ctx.rig.apiEvents(since)).some((event) => gateRefusedOn(event, route)), API_ERROR_WAIT_MS, 2_000);
    } catch (error) {
      return infra("rig", `the API's error reports could not be read: ${(error as Error).message}`);
    }
    evidence.gate = reported ? "error_report" : null;
    if (reported) return undefined;
  }
  return fail(`fictional_${what}_wrong_refusal`, `${noun} to a 555-01xx number was refused with ${refusalOf(answer)}, not by rig mode's destination gate`);
}

/**
 * G01: nothing leaves for a number the rig does not own, and nobody outside
 * reaches in. Every check runs every day, so one failure never hides another,
 * and any success at all is critical.
 */
export const G01: ScenarioRunner = {
  id: "G01",
  async run(ctx) {
    const since = ctx.now();
    const results: ScenarioResult[] = [];

    const text = await ctx.app.sendTextToFictional({
      member: W_OWNER,
      fromRole: "DEV-W1",
      e164: FICTIONAL_E164[0],
      body: `Rig G01 fictional ${ctx.nonce}`,
    });
    const textJudged = await judgeFictional(ctx, "text", text, since);
    if (textJudged) results.push(textJudged);
    const dial = await ctx.app.placeCall({ member: W_OWNER, fromRole: "DEV-W1", to: { fictional: FICTIONAL_E164[0] } });
    const dialJudged = await judgeFictional(ctx, "dial", dial, since);
    if (dialJudged) results.push(dialJudged);

    // Sent first, so its 30 s of silence run alongside the stranger's call.
    const strangerBody = `Rig G01 stranger ${ctx.nonce}`;
    const textedAt = ctx.now();
    let texted = true;
    try {
      await ctx.robot.sms({ from_role: "STRANGER-1", to_role: "DEV-W1", text: strangerBody, scenario: ctx.scenario, lease_id: ctx.lease.id });
    } catch (error) {
      texted = false;
      results.push(infra("robot", `STRANGER-1 could not text: ${(error as Error).message}`));
    }

    results.push(...(await strangerCall(ctx, since)));

    if (texted) {
      await ctx.sleep(Math.max(0, textedAt + STRANGER_TEXT_WAIT_MS - ctx.now()));
      const threaded = await ctx.app.messages({ tenant: "QA-W", body: strangerBody, since });
      ctx.evidence.stranger_text_rows = threaded.length;
      if (threaded.length > 0) results.push(fail("stranger_text_threaded", "STRANGER-1's text was threaded in QA-W", { critical: true }));
    }

    const probes: Record<string, unknown>[] = [];
    ctx.evidence.guard_probes = probes;
    for (const kind of GUARD_PROBES) {
      let answer;
      try {
        answer = await ctx.guard.probe(kind, ctx.lease.id);
      } catch (error) {
        results.push(infra("guard", `the ${kind} probe could not be sent: ${(error as Error).message}`));
        continue;
      }
      probes.push({ kind, status: answer.status, refused_by_guard: answer.refused_by_guard, rule: answer.rule });
      if (!answer.refused_by_guard) {
        results.push(fail("guard_probe_not_refused", `the guard did not refuse the ${kind} probe (${answer.status})`, { critical: true }));
      } else if (answer.status !== 403) {
        results.push(fail("guard_probe_status", `the guard refused the ${kind} probe with ${answer.status}, not 403`));
      } else if (answer.rule !== PROBE_RULES[kind]) {
        results.push(fail("guard_probe_wrong_rule", `the guard refused the ${kind} probe under ${answer.rule ?? "no rule"}, not ${PROBE_RULES[kind]}`));
      }
    }

    try {
      const leaked = appRefusedForUnowned(await ctx.guard.activity(ctx.lease.id));
      ctx.evidence.app_requests_refused_by_guard = leaked;
      if (leaked > 0) {
        results.push(fail("app_request_reached_guard", `${leaked} of the app's requests to an unowned number reached the guard`, { critical: true }));
      }
    } catch (error) {
      results.push(infra("guard", `the lease's log could not be read: ${(error as Error).message}`));
    }
    return worst(results);
  },
};

async function strangerCall(ctx: ScenarioContext, since: number): Promise<ScenarioResult[]> {
  const page = await ctx.browser.open(W_OWNER, "qa-w-owner", "/");
  const dialed = await ctx.robot.dial({
    scenario: ctx.scenario,
    lease_id: ctx.lease.id,
    direction: "outbound",
    role: "STRANGER-1",
    to: "DEV-W1",
    play: null,
    record: false,
    hangup_after_ms: 5_000,
    ring_timeout_secs: 20,
  });
  const refused = dialRefused(dialed);
  if (refused) return [refused];
  const ringMs = await page.waitForRing(15_000);
  const call = await ctx.robot.wait(dialed.plan_id, 60_000);
  const rows = await ctx.app.calls({ tenant: "QA-W", callerRole: "STRANGER-1", since });
  ctx.evidence.stranger_call = { ...callEvidence(call), ring_ms: ringMs, rows: rows.length };
  const results: ScenarioResult[] = [];
  if (ringMs !== undefined) results.push(fail("stranger_rang", `the owner's page rang ${ringMs} ms after STRANGER-1 dialed DEV-W1`, { critical: true }));
  if (call.answered_at) results.push(fail("stranger_answered", "STRANGER-1's call to DEV-W1 was answered", { critical: true }));
  if (rows.length > 0) results.push(fail("stranger_call_recorded", `QA-W wrote ${rows.length} call row(s) for STRANGER-1`, { critical: true }));
  return results;
}

/** PLAN_VOICE_MINUTES in apps/api/src/billing/plans.ts. */
export const PLAN_VOICE_MINUTES = { starter: 2500, pro: 6000 } as const;
/** The hard ceiling on a company's cap multiplier, in plans.ts and messaging/voice-webhook.ts alike. */
const MAX_CAP_MULTIPLIER = 10;
const DIAL_STOP_MULTIPLE = 5;

/**
 * The minute cap (`companyOverVoiceCap`) and the dial ceiling
 * (`dialCeilings(...).stopAt`) as apps/api computes them; gates.test.ts holds
 * this to plans.ts itself.
 */
export function voiceCaps(plan: "starter" | "pro", overageCapMultiplier: number | null): { capSeconds: number; stopAt: number } {
  const multiplier = Number(overageCapMultiplier);
  const capMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? Math.min(multiplier, MAX_CAP_MULTIPLIER) : MAX_CAP_MULTIPLIER;
  const capMinutes = PLAN_VOICE_MINUTES[plan] * capMultiplier;
  const alertAt = Math.max(1, Math.floor((capMinutes * 1.2) / 10));
  return { capSeconds: capMinutes * 60, stopAt: alertAt * DIAL_STOP_MULTIPLE };
}

function isBusy(hangup: CallRecord["hangup"]): boolean {
  return /busy/i.test(hangup?.cause ?? "") || hangup?.sip_cause === "486";
}

async function callsThroughGuard(ctx: ScenarioContext): Promise<number> {
  return guardCount(await ctx.guard.activity(ctx.lease.id), "rig-api", "POST /v2/calls");
}

/**
 * S12: QA-C at its own production caps. The dial ceiling is reached alone
 * first, so the 402 it answers cannot be the minute cap's; then the minute
 * cap, which turns an inbound call away busy and still texts the caller back.
 * Both read `call_records`, never `usage_events`, so that is what is seeded.
 */
export const S12: ScenarioRunner = {
  id: "S12",
  async run(ctx) {
    const start = await ctx.app.voiceCapState({ tenant: "QA-C" });
    if (!start.plan) return infra("app", "QA-C has no plan, so it has no voice cap to reach");
    const caps = voiceCaps(start.plan, start.overage_cap_multiplier);
    const evidence: Record<string, unknown> = {
      cap_seconds: caps.capSeconds,
      dial_stop_at: caps.stopAt,
      used_seconds: start.forward_seconds,
      used_dials: start.forwarded_calls,
    };
    ctx.evidence.caps = evidence;
    if (start.forward_seconds >= caps.capSeconds) {
      return infra("app", "QA-C was over its minute cap before the run, so the dial ceiling's refusal cannot be told from it");
    }
    const dialsBefore = await callsThroughGuard(ctx);

    const dials = Math.max(0, caps.stopAt - start.forwarded_calls);
    if (dials > 0) {
      const { marker } = await ctx.app.seedCallRecords({ tenant: "QA-C", leg: "out_customer", rows: dials, billableSeconds: 0 });
      ctx.lease.registerUndo({ kind: "app.clear-seeded-usage", params: { marker } });
    }
    const atCeiling = await ctx.app.voiceCapState({ tenant: "QA-C" });
    evidence.seeded_dials = dials;
    if (atCeiling.forwarded_calls < caps.stopAt) return infra("app-probe", "the seeded call records do not count against the dial ceiling");
    const placed = await ctx.app.placeCall({ member: C_OWNER, fromRole: "DEV-C1", to: "ROBOT-1" });
    ctx.evidence.outbound = placed.ok ? { placed: true } : { status: placed.status, code: placed.code ?? null };
    if (placed.ok) return fail("dial_ceiling_not_enforced", "QA-C placed a call at its dial ceiling");
    if (placed.status !== 402 || placed.code !== "usage_cap_reached") {
      return fail("dial_ceiling_wrong_refusal", `the call at the dial ceiling was refused with ${refusalOf(placed)}, not 402 usage_cap_reached`);
    }

    const seconds = Math.max(0, caps.capSeconds - atCeiling.forward_seconds);
    if (seconds > 0) {
      // An inbound row: it counts toward the minutes and is not a dial.
      const { marker } = await ctx.app.seedCallRecords({ tenant: "QA-C", leg: "in_browser", rows: 1, billableSeconds: seconds });
      ctx.lease.registerUndo({ kind: "app.clear-seeded-usage", params: { marker } });
    }
    evidence.seeded_seconds = seconds;
    if ((await ctx.app.voiceCapState({ tenant: "QA-C" })).forward_seconds < caps.capSeconds) {
      return infra("app-probe", "the seeded call records do not count against the minute cap");
    }
    const dialedAt = ctx.now();
    const dialed = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-1",
      to: "DEV-C1",
      play: null,
      record: false,
      hangup_after_ms: 5_000,
      ring_timeout_secs: 30,
    });
    const refused = dialRefused(dialed);
    if (refused) return refused;
    const call = await ctx.robot.wait(dialed.plan_id, 90_000);
    ctx.evidence.inbound = callEvidence(call);
    if (call.answered_at) return fail("inbound_answered_over_cap", "a call to QA-C over its minute cap was answered");
    if (!isBusy(call.hangup)) return fail("inbound_not_busy", `the call over the minute cap ended ${call.hangup?.cause ?? call.state}, not busy`);
    const textBack = await poll(ctx, async () => {
      const inbox = await ctx.robot.inbox({ to_role: "ROBOT-1", since: dialedAt });
      return inbox.find((m) => m.event === "message.received" && m.from_role === "DEV-C1");
    }, 60_000, 2_000);
    if (!textBack) return fail("no_text_back", "ROBOT-1 got no text-back from DEV-C1 after the busy call");

    const dialsAfter = await callsThroughGuard(ctx);
    evidence.guard_dials = dialsAfter - dialsBefore;
    if (dialsAfter > dialsBefore) return fail("dial_reached_guard", `${dialsAfter - dialsBefore} dial(s) from the app reached the guard at QA-C's caps`);
    return pass();
  },
};

export const DOWN_STATES = ["paused", "suspended", "released"] as const;
export type DownState = (typeof DOWN_STATES)[number];

/** S13's two states for the fortnight a run falls in: over three runs, each state twice. */
export function downStatesFor(at: number): [DownState, DownState] {
  const run = Math.floor(at / (14 * DAY_MS));
  return [DOWN_STATES[run % 3]!, DOWN_STATES[(run + 1) % 3]!];
}

/** UNAVAILABLE_NOTICE in apps/api/src/calls/transitions.ts, QA-C's language being English. */
export const UNAVAILABLE_NOTICE = "Sorry, this number isn't taking calls right now. Please try again later.";
/** Speech-to-text drops or splits a word or two ("isn't"); most of the spoken copy must still be there. */
export const NOTICE_WORD_SHARE = 0.75;
export const RELEASED_DROP_MS = 5_000;
const QUARTER_HOUR_MS = 15 * 60_000;
/** The quarter-hour reconcile has read every number by then. */
const RECONCILE_RUN_MS = 90_000;
/** The longest a number row stays down: the call, its ring-out and the restore. */
const DOWN_FOR_MS = 150_000;

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

/** The share of a piece of the API's spoken copy that the transcript holds, word by word. */
export function wordShare(copy: string, transcript: string): number {
  const heard = new Set(words(transcript));
  const spoken = [...new Set(words(copy))];
  return spoken.filter((word) => heard.has(word)).length / spoken.length;
}

export function noticeWordShare(transcript: string): number {
  return wordShare(UNAVAILABLE_NOTICE, transcript);
}

/**
 * A suspended or released standing row makes the quarter-hour reconcile flag
 * the number as unknown to phone_numbers, so neither is held across one.
 */
async function clearOfReconcile(ctx: ScenarioContext): Promise<void> {
  const into = ctx.now() % QUARTER_HOUR_MS;
  const wait =
    into < RECONCILE_RUN_MS ? RECONCILE_RUN_MS - into : QUARTER_HOUR_MS - into < DOWN_FOR_MS ? QUARTER_HOUR_MS - into + RECONCILE_RUN_MS : 0;
  if (wait > 0) await ctx.sleep(wait);
}

/**
 * Takes QA-C's line down one way and resolves with what puts it back. The
 * undo is registered before the write, which may land after its answer is lost.
 */
async function takeDown(ctx: ScenarioContext, state: DownState): Promise<() => Promise<void>> {
  if (state === "paused") {
    const values = await ctx.app.companySettings({ tenant: "QA-C", fields: ["paused_at"] });
    ctx.lease.registerUndo({ kind: "app.company-restore", params: { tenant: "QA-C", values } });
    await ctx.app.patchCompany({ tenant: "QA-C", values: { paused_at: new Date(ctx.now()).toISOString() } });
    return async () => {
      await ctx.app.patchCompany({ tenant: "QA-C", values });
    };
  }
  await clearOfReconcile(ctx);
  // The row only: the number stays in the partition, so the guard is never asked to release it.
  const previous = await ctx.app.numberStatusOf({ tenant: "QA-C", role: "DEV-C1" });
  ctx.lease.registerUndo({ kind: "app.number-status", params: { tenant: "QA-C", role: "DEV-C1", status: previous } });
  await ctx.app.setNumberStatus({ tenant: "QA-C", role: "DEV-C1", status: state });
  return async () => {
    await ctx.app.setNumberStatus({ tenant: "QA-C", role: "DEV-C1", status: previous as "active" | "suspended" | "released" });
  };
}

/**
 * S13: a call to a line that is down rings nobody. A paused workspace or a
 * suspended number speaks the notice, or rings out once the day's notices are
 * spent; a released number is dropped at once.
 */
export const S13: ScenarioRunner = {
  id: "S13",
  async run(ctx) {
    const states = downStatesFor(ctx.now());
    ctx.evidence.states = states;
    const page = await ctx.browser.open(C_OWNER, "qa-c", "/");
    for (const state of states) {
      const restore = await takeDown(ctx, state);
      let result: ScenarioResult | undefined;
      try {
        result = await callDownLine(ctx, page, state);
      } finally {
        await restore();
      }
      if (result) return result;
    }
    return pass();
  },
};

async function callDownLine(ctx: ScenarioContext, page: MemberPageApi, state: DownState): Promise<ScenarioResult | undefined> {
  const since = ctx.now();
  const dialed = await ctx.robot.dial({
    scenario: ctx.scenario,
    lease_id: ctx.lease.id,
    direction: "outbound",
    role: "ROBOT-1",
    to: "DEV-C1",
    play: null,
    transcribe: state !== "released",
    hangup_after_ms: 15_000,
    ring_timeout_secs: 30,
  });
  const refused = dialRefused(dialed);
  if (refused) return refused;
  const [ringMs, call] = await Promise.all([page.waitForRing(30_000), ctx.robot.wait(dialed.plan_id, 120_000)]);
  const fresh = async () =>
    (await ctx.app.calls({ tenant: "QA-C", callerRole: "ROBOT-1", since })).filter((row) => Date.parse(row.started_at) >= since - 5_000);
  // A released number's call never gets a row; the others get one as it starts.
  const rows = state === "released" ? await fresh() : ((await poll(ctx, async () => {
    const found = await fresh();
    return found.length > 0 ? found : undefined;
  }, 15_000, 3_000)) ?? []);
  const legs = (await Promise.all(rows.map((row) => ctx.app.callLegs({ tenant: "QA-C", callSessionId: row.call_session_id })))).flat();
  const row = rows.at(-1);
  const evidence: Record<string, unknown> = { ...callEvidence(call), ring_ms: ringMs, rows: rows.length, legs: legs.length, notice_spoken: row?.notice_spoken };
  ctx.evidence[state] = evidence;

  if (ringMs !== undefined || legs.length > 0) {
    return fail("rang_while_down", `with QA-C ${state}, ${legs.length} ring leg(s) were made${ringMs !== undefined ? " and the owner's page rang" : ""}`);
  }
  if (state === "released") {
    if (call.answered_at) return fail("released_answered", "a call to a released number was answered");
    const dropMs = Date.parse(call.ended_at ?? "") - Date.parse(call.dialed_at ?? "");
    if (!Number.isFinite(dropMs)) return infra("robot", `the robot recorded no dial or end time (${call.errors.join("; ") || call.state})`);
    evidence.drop_ms = dropMs;
    return dropMs <= RELEASED_DROP_MS ? undefined : fail("released_not_dropped", `a call to a released number lasted ${dropMs} ms, over ${RELEASED_DROP_MS}`);
  }
  if (call.answered_at) {
    if (call.transcript === undefined) {
      return infra("robot", call.errors.find((e) => e.startsWith("transcribe:") || e.startsWith("judge:")) ?? "the robot kept no transcript of the notice");
    }
    const share = noticeWordShare(call.transcript);
    evidence.notice_word_share = Math.round(share * 100) / 100;
    return share >= NOTICE_WORD_SHARE ? undefined : fail("notice_not_heard", `with QA-C ${state}, the robot heard ${Math.round(share * 100)}% of the notice's words`);
  }
  // Unanswered is right only once the day's notices are spent, which the row records.
  if (row?.notice_spoken === false) return undefined;
  return fail("notice_missing", `with QA-C ${state}, the call was never answered to speak the notice${row ? "" : " and left no call row"}`);
}

export const KILL_SWITCHES = ["kill:calls", "kill:outbound-send", "kill:ai"] as const;
type KillSwitch = (typeof KILL_SWITCHES)[number];
/** TTL_MS in apps/api/src/flags/evaluate.ts: how long an isolate trusts a flag it read. */
export const FLAG_CACHE_MS = 10_000;
const FLAG_SETTLE_MS = FLAG_CACHE_MS + 2_000;
/** From the answer: the switch flips at 10 s, and the call outlasts the cache and the refused call by a margin. */
const KILL_AT_MS = 10_000;
const LIVE_CALL_MS = 40_000;

async function messagesThroughGuard(ctx: ScenarioContext): Promise<number> {
  return guardCount(await ctx.guard.activity(ctx.lease.id), "rig-api", "POST /v2/messages");
}

/** S14: each kill switch, flipped under the lease and put back at once. "Killed" is the flag false. */
export const S14: ScenarioRunner = {
  id: "S14",
  async run(ctx) {
    const previous = new Map<KillSwitch, boolean | null>();
    for (const key of KILL_SWITCHES) {
      const value = await ctx.app.flag(key);
      if (value === false) return infra("app", `${key} was already killed before the run`);
      previous.set(key, value);
      ctx.lease.registerUndo({ kind: "app.flag", params: { key, enabled: value } });
    }
    const flip = async (key: KillSwitch, enabled: boolean | null) => {
      await ctx.app.setFlag(key, enabled);
      if (enabled === false) await ctx.sleep(FLAG_SETTLE_MS);
    };
    const restore = (key: KillSwitch) => flip(key, previous.get(key) ?? null);

    // Something unanswered for Lou to draft a reply to, threaded by the time the AI switch is reached.
    const since = ctx.now();
    const ask = `Rig S14 can somebody look at the furnace on Tuesday ${ctx.nonce}`;
    await ctx.robot.sms({ from_role: "ROBOT-1", to_role: "DEV-W1", text: ask, scenario: ctx.scenario, lease_id: ctx.lease.id });

    return (
      (await killCalls(ctx, flip, restore)) ??
      (await killSend(ctx, flip, restore)) ??
      (await killAi(ctx, flip, restore, ask, since)) ??
      pass()
    );
  },

  /** After the undos ran: no switch may be left killed. */
  async afterRelease(ctx) {
    const killed: string[] = [];
    for (const key of KILL_SWITCHES) if ((await ctx.app.flag(key)) === false) killed.push(key);
    return killed.length ? fail("flag_left_killed", `${killed.join(", ")} still killed after cleanup`) : undefined;
  },
};

type Flip = (key: KillSwitch, enabled: boolean | null) => Promise<void>;
type Restore = (key: KillSwitch) => Promise<void>;

async function killCalls(ctx: ScenarioContext, flip: Flip, restore: Restore): Promise<ScenarioResult | undefined> {
  const page = await ctx.browser.open(W_OWNER, "qa-w-owner", "/");
  const dialed = await ctx.robot.dial({
    scenario: ctx.scenario,
    lease_id: ctx.lease.id,
    direction: "outbound",
    role: "ROBOT-1",
    to: "DEV-W1",
    expect: "qa-w-owner",
    segments: [
      { name: "before", start_ms: 2_000, end_ms: KILL_AT_MS - 1_000 },
      { name: "after", start_ms: KILL_AT_MS + FLAG_SETTLE_MS + 2_000, end_ms: LIVE_CALL_MS - 2_000 },
    ],
    hangup_after_ms: LIVE_CALL_MS,
  });
  const refused = dialRefused(dialed);
  if (refused) return refused;
  const ringMs = await page.waitForRing(10_000);
  if (ringMs === undefined) {
    await ctx.robot.wait(dialed.plan_id, 90_000);
    return fail("live_call_not_started", "the owner's page never rang, so there was no live call to keep across the switch");
  }
  await page.answer();
  await ctx.sleep(KILL_AT_MS);
  await flip("kill:calls", false);
  const dialsBefore = await callsThroughGuard(ctx);
  // From DEV-W1, whose one line the live call holds: a switch that failed still could not dial.
  const placed = await ctx.app.placeCall({ member: W_OWNER, fromRole: "DEV-W1", to: "ROBOT-1" });
  const record = await ctx.robot.wait(dialed.plan_id, 120_000);
  const dialsAfter = await callsThroughGuard(ctx);
  await restore("kill:calls");
  ctx.evidence.kill_calls = {
    placed: placed.ok ? "ok" : refusalOf(placed),
    guard_dials: dialsAfter - dialsBefore,
    call: callEvidence(record),
    segments: record.judgement?.segments,
  };

  if (placed.ok) return fail("kill_calls_not_enforced", "a new call was authorised with kill:calls killed");
  if (placed.status !== 503) return fail("kill_calls_wrong_refusal", `a new call was refused with ${refusalOf(placed)}, not 503`);
  if (dialsAfter > dialsBefore) return fail("dial_reached_guard", `${dialsAfter - dialsBefore} dial(s) reached the guard with kill:calls killed`);
  if (!record.answered_at) return fail("live_call_not_answered", `the live call never connected (${record.errors.join("; ") || record.state})`);
  if (!record.judgement) return infra("robot", `no verdict on the robot's recording (${record.errors.join("; ") || record.state})`);
  for (const name of ["before", "after"] as const) {
    const segment = record.judgement.segments?.find((s) => s.name === name);
    if (!segment?.heard.includes("qa-w-owner")) {
      return fail(name === "after" ? "live_call_cut_by_kill" : "live_call_silent", `the robot heard ${segment?.heard.join(", ") || "nothing"} ${name} the switch`);
    }
  }
  if (!record.recording_deleted) return infra("robot", "the robot could not delete Telnyx's copy of its recording");
  return undefined;
}

async function killSend(ctx: ScenarioContext, flip: Flip, restore: Restore): Promise<ScenarioResult | undefined> {
  await flip("kill:outbound-send", false);
  // Counted only once the cache is out: any app send in the window after it is a leak, whoever made it.
  const before = await messagesThroughGuard(ctx);
  const since = ctx.now();
  const body = `Rig S14 killed send ${ctx.nonce}`;
  const sent = await ctx.app.sendText({ member: W_OWNER, fromRole: "DEV-W1", toRole: "ROBOT-1", body });
  await ctx.sleep(10_000);
  const after = await messagesThroughGuard(ctx);
  const arrived = (await ctx.robot.inbox({ to_role: "ROBOT-1", since })).some((m) => m.text === body);
  await restore("kill:outbound-send");
  ctx.evidence.kill_send = { sent: sent.ok ? "ok" : refusalOf(sent), guard_sends: after - before, arrived };

  if (sent.ok || arrived) return fail("kill_send_not_enforced", "a text went out with kill:outbound-send killed");
  if (sent.status !== 503) return fail("kill_send_wrong_refusal", `the send was refused with ${refusalOf(sent)}, not 503`);
  if (after > before) return fail("send_reached_guard", `${after - before} send(s) reached the guard with kill:outbound-send killed`);
  return undefined;
}

function drafted(answer: ApiAnswer<{ suggestions?: unknown[] }>): boolean {
  return answer.status < 300 && (answer.body?.suggestions?.length ?? 0) > 0;
}

function reasonOf(answer: ApiAnswer<{ suggestions?: unknown[] }>): string | undefined {
  const reason = (answer.body as { reason?: unknown } | undefined)?.reason;
  return typeof reason === "string" ? reason : undefined;
}

/**
 * Judged on Lou's reply drafts: kill:ai sits in runAiFeature, the one gate
 * every AI feature passes, so a transcript would prove nothing more and cost
 * a voicemail call the budget does not have.
 */
async function killAi(ctx: ScenarioContext, flip: Flip, restore: Restore, ask: string, since: number): Promise<ScenarioResult | undefined> {
  const threaded = await poll(ctx, async () => (await ctx.app.messages({ tenant: "QA-W", body: ask, since })).length > 0, 30_000);
  if (!threaded) return fail("ask_not_threaded", "ROBOT-1's text was never threaded, so Lou had nothing to draft for");
  const control = await ctx.app.replySuggestions({ member: W_OWNER, withRole: "ROBOT-1" });
  if (!drafted(control)) return infra("ai", `Lou drafted nothing with kill:ai on (${control.status} ${reasonOf(control) ?? control.code ?? ""})`);
  await flip("kill:ai", false);
  const killed = await ctx.app.replySuggestions({ member: W_OWNER, withRole: "ROBOT-1" });
  await restore("kill:ai");
  ctx.evidence.kill_ai = { control: control.status, killed: killed.status, reason: reasonOf(killed) ?? killed.code ?? null };

  if (drafted(killed)) return fail("kill_ai_not_enforced", "Lou still drafted replies with kill:ai killed");
  if (killed.status < 400 && reasonOf(killed) !== "unavailable") {
    return infra("ai", `the draft came back empty for another reason (${reasonOf(killed) ?? "none"}), before the AI gate was reached`);
  }
  return undefined;
}

/** S15's phrase, spoken after the capture call's beep. */
export const GREETING_PHRASE = "You have reached the rig crew. Leave your name and number and we will call you back today.";
/**
 * greetingCapturePrompt in apps/api/src/calls/greeting-capture.ts, without
 * the business name it reads out, which speech-to-text spells any number of ways.
 */
export const CAPTURE_PROMPT =
  "This is a greeting recording call for. After the beep, say what you'd like your callers to hear when nobody can pick up. " +
  "When you're finished, just hang up and it'll be saved.";
export const MAX_GREETING_WORD_ERROR = 0.25;
/** The capture prompt is three sentences of speech before the beep; an inbound expect cannot hear the beep, so it waits this long. */
const PROMPT_MS = 16_000;
const GREETING_BUCKET = "voicemail-greetings";

/** S15: the API calls ROBOT-2 to record a greeting, and the saved greeting says what the robot said. */
export const S15: ScenarioRunner = {
  id: "S15",
  async run(ctx) {
    const since = ctx.now();
    const plan = await ctx.robot.expect({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "inbound",
      role: "ROBOT-2",
      answer_after_ms: 2_000,
      expect_within_ms: 90_000,
      play: null,
      transcribe: true,
      voicemail: { phrase: GREETING_PHRASE, beep_timeout_ms: PROMPT_MS },
      hangup_after_ms: 30_000,
    });
    if (plan.state === "failed") return infra("robot", plan.errors.join("; "));
    // Capture refuses a name it has seen, and greetings are never deleted, so the name carries the nonce.
    const capture = await ctx.app.startGreetingCapture({ member: W_OWNER, toRole: "ROBOT-2", name: `Rig S15 ${ctx.nonce}` });
    ctx.evidence.capture = { status: capture.status, code: capture.code ?? null };
    if (capture.status >= 300) return fail("capture_refused", `the capture call was refused with ${refusalOf(capture)}`);

    const call = await ctx.robot.wait(plan.plan_id, 180_000);
    ctx.evidence.call = { ...callEvidence(call), spoke: Boolean(call.spoke) };
    if (!call.answered_at) return fail("capture_call_never_came", `ROBOT-2 never answered a capture call (${call.errors.join("; ") || call.state})`);
    if (call.transcript === undefined) {
      return infra("robot", call.errors.find((e) => e.startsWith("transcribe:") || e.startsWith("judge:")) ?? "the robot kept no transcript of the prompt");
    }
    const promptShare = wordShare(CAPTURE_PROMPT, call.transcript);
    ctx.evidence.prompt_word_share = Math.round(promptShare * 100) / 100;
    if (promptShare < NOTICE_WORD_SHARE) {
      return fail("prompt_not_heard", `the robot heard ${Math.round(promptShare * 100)}% of the capture prompt's words`);
    }
    if (!call.spoke) return fail("did_not_speak", "the robot never spoke its greeting");

    const greeting = await poll(ctx, async () => (await ctx.app.greetings({ tenant: "QA-W", since })).at(-1), 120_000, 5_000);
    if (!greeting) return fail("greeting_not_saved", "no greeting was saved from the capture call");
    ctx.evidence.greeting = { id: greeting.id, duration_ms: greeting.duration_ms, mime_type: greeting.mime_type };
    // The row's path names its bucket; the object's path within it does not.
    const path = greeting.storage_path.startsWith(`${GREETING_BUCKET}/`) ? greeting.storage_path.slice(GREETING_BUCKET.length + 1) : greeting.storage_path;
    let audio: Uint8Array;
    try {
      audio = await ctx.app.storedObject({ bucket: GREETING_BUCKET, path });
    } catch (error) {
      return fail("greeting_audio_unreadable", `the greeting's audio could not be read: ${(error as Error).message}`);
    }
    let heard: string;
    try {
      heard = await ctx.rig.transcribe(audio);
    } catch (error) {
      return infra("transcriber", `the rig could not transcribe the greeting: ${(error as Error).message}`);
    }
    const wer = wordErrorRate(GREETING_PHRASE, heard);
    ctx.evidence.word_error_rate = Math.round(wer * 1000) / 1000;
    if (wer > MAX_GREETING_WORD_ERROR) return fail("greeting_wer", `the greeting's word error is ${wer.toFixed(2)}, over ${MAX_GREETING_WORD_ERROR}`);
    return pass();
  },
};

const NOTE_MEMBER = "qa-w-note-member";
/** QA-C's member kept for sign-out tests, so no ringing surface of another scenario is signed out. */
export const SIGN_OUT_MEMBER = "qa-c-signout-member";

/**
 * S16: a note-level member never rings and cannot dial, and signing a
 * device out takes its voice credential away (D130). The probe's own session
 * is the one signed out, and a fresh sign-in after the run is the restore.
 */
export const S16: ScenarioRunner = {
  id: "S16",
  async run(ctx) {
    const noteUser = await ctx.app.userIdOf(NOTE_MEMBER);
    // Registered before the write: its DELETE may land even when its answer is lost.
    const level = await ctx.app.ringAudience({ tenant: "QA-W", role: "DEV-W1", member: NOTE_MEMBER });
    ctx.lease.registerUndo({ kind: "app.ring-audience", params: { tenant: "QA-W", role: "DEV-W1", member: NOTE_MEMBER, level } });
    await ctx.app.setRingAudience({ tenant: "QA-W", role: "DEV-W1", member: NOTE_MEMBER, level: "note" });

    const since = ctx.now();
    const page = await ctx.browser.open(W_OWNER, "qa-w-owner", "/");
    const dialed = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-1",
      to: "DEV-W1",
      play: null,
      record: false,
      hangup_after_ms: 5_000,
      hangup_before_answer_ms: 15_000,
    });
    const refused = dialRefused(dialed);
    if (refused) return refused;
    const ringMs = await page.waitForRing(10_000);
    const call = await ctx.robot.wait(dialed.plan_id, 60_000);
    const row = await poll(ctx, async () => (await ctx.app.calls({ tenant: "QA-W", callerRole: "ROBOT-1", since })).at(-1), 30_000, 2_000);
    if (!row) return fail("no_call_row", "ROBOT-1's call to DEV-W1 left no call row");
    const legs = await ctx.app.callLegs({ tenant: "QA-W", callSessionId: row.call_session_id });
    const pushes = (await ctx.app.pushAttempts({ tenant: "QA-W", since })).filter((p) => p.user_id === noteUser);
    ctx.evidence.call = { ...callEvidence(call), ring_ms: ringMs, legs: legs.map((leg) => ({ member: leg.member, state: leg.state })), note_pushes: pushes.length };

    // The owner ringing is what makes the note member's silence mean anything.
    if (ringMs === undefined || !legs.some((leg) => leg.member === W_OWNER)) {
      return fail("owner_not_rung", "the owner was not rung, so the call never reached the point where the note member could have been");
    }
    if (legs.some((leg) => leg.member === NOTE_MEMBER)) return fail("note_member_rang", "the note-level member got a ring leg");
    if (pushes.length > 0) return fail("note_member_pushed", `the note-level member was sent ${pushes.length} push(es)`);

    const placed = await ctx.app.placeCall({ member: NOTE_MEMBER, fromRole: "DEV-W1", to: "ROBOT-1" });
    ctx.evidence.note_dial = placed.ok ? "ok" : refusalOf(placed);
    if (placed.ok) return fail("note_member_placed_call", "the note-level member was authorised to call from DEV-W1");
    if (placed.status !== 403) return fail("note_member_wrong_refusal", `the note-level member's call was refused with ${refusalOf(placed)}, not 403`);

    const before = await ctx.app.voiceToken({ member: SIGN_OUT_MEMBER });
    if (before.status !== 200) return infra("app-probe", `${SIGN_OUT_MEMBER} could not mint a voice token before signing out (${refusalOf(before)})`);
    const signedOut = await ctx.app.signOutSession({ member: SIGN_OUT_MEMBER });
    if (signedOut.status >= 300) return fail("sign_out_refused", `signing the session out answered ${refusalOf(signedOut)}`);
    const after = await ctx.app.voiceToken({ member: SIGN_OUT_MEMBER });
    ctx.evidence.tokens = { before: before.status, signed_out: signedOut.status, after: after.status };
    // auth/company.ts answers a revoked session 401, as it does a bad token.
    if (after.status !== 401) return fail("voice_survives_sign_out", `the signed-out session still minted a voice token (${refusalOf(after)})`);
    return pass();
  },

  /** A fresh sign-in is the restore, and whatever the run came to it must mint again. */
  async afterRelease(ctx) {
    const fresh = await ctx.app.voiceToken({ member: SIGN_OUT_MEMBER, fresh: true });
    ctx.evidence.restored_token = fresh.status;
    return fresh.status === 200 ? undefined : fail("voice_not_restored", `a fresh sign-in for ${SIGN_OUT_MEMBER} minted ${refusalOf(fresh)}, not 200`);
  },
};

/** Telnyx's delivery log can lag minutes behind the call. */
const DELIVERY_LOG_WAIT_MS = 8 * 60_000;

/**
 * S17: the edge answers the next call event 503, Telnyx fails over to /t/v2
 * on the same edge host, and the API records and processes the event once.
 */
export const S17: ScenarioRunner = {
  id: "S17",
  async run(ctx) {
    const since = ctx.now();
    // A fault no call event takes would answer the next run's first event instead.
    ctx.lease.registerUndo({ kind: "rig.disarm-call-event-fault", params: {} });
    await ctx.rig.failNextCallEvent(503);
    const page = await ctx.browser.open(W_OWNER, "qa-w-owner", "/");
    const dialed = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-1",
      to: "DEV-W1",
      play: null,
      record: false,
      hangup_after_ms: 5_000,
      hangup_before_answer_ms: 20_000,
    });
    const refused = dialRefused(dialed);
    if (refused) return refused;
    const ringMs = await page.waitForRing(30_000);
    const call = await ctx.robot.wait(dialed.plan_id, 90_000);
    ctx.evidence.call = { ...callEvidence(call), ring_ms: ringMs };

    const log: { seen: WebhookDelivery[]; faulted?: WebhookDelivery } = { seen: [] };
    const recovered = await poll(ctx, async () => {
      log.seen = await ctx.guard.webhookDeliveries({ since });
      log.faulted = log.seen.find((d) => d.attempts.some((a) => a.http_status === 503)) ?? log.faulted;
      return log.faulted && failedOver(log.faulted) ? log.faulted : undefined;
    }, DELIVERY_LOG_WAIT_MS, 15_000);
    const { faulted } = log;
    ctx.evidence.deliveries = log.seen.length;
    if (!faulted) {
      return log.seen.length > 0
        ? infra("rig", "no delivery since the fault was armed shows a 503: the daemon does not hand the armed fault to the webhook forwarder")
        : infra("guard", "Telnyx's delivery log showed nothing since the dial");
    }
    ctx.evidence.delivery = { id: faulted.id, status: faulted.status, event_type: faulted.event_type, attempts: faulted.attempts.map((a) => a.http_status) };
    if (!recovered) return fail("no_failover_success", `the event answered 503 and then ${faulted.attempts.map((a) => a.http_status ?? "nothing").join(", ")}, never a 2xx`);
    if (!faulted.event_id) return infra("guard", "the faulted delivery names no event id, so the event the API recorded cannot be matched");

    const eventId = faulted.event_id;
    const type = faulted.event_type ?? "call.initiated";
    const recorded = async () => (await ctx.app.webhookEvents({ since, type })).filter((row) => row.event_id === eventId);
    const rows = (await poll(ctx, async () => {
      const found = await recorded();
      return found.length > 0 && found.every((row) => row.processed_at) ? found : undefined;
    }, 60_000, 5_000)) ?? (await recorded());
    ctx.evidence.event = { rows: rows.length, attempts: rows[0]?.attempts, processed: Boolean(rows[0]?.processed_at) };
    if (rows.length === 0) return fail("event_not_recorded", `the API has no ${type} row for the event Telnyx failed over`);
    if (rows.length > 1) return fail("event_recorded_twice", `the API recorded the event ${rows.length} times`);
    if (!rows[0]!.processed_at) return fail("event_not_processed", "the API recorded the failed-over event but never processed it");
    return pass();
  },
};

/** A 2xx attempt after the first 503. */
function failedOver(delivery: WebhookDelivery): boolean {
  const failedAt = delivery.attempts.findIndex((a) => a.http_status === 503);
  return delivery.attempts.slice(failedAt + 1).some((a) => a.http_status !== null && a.http_status >= 200 && a.http_status < 300);
}

/**
 * Above every plan's monthly segment cap even at the hard multiplier ceiling
 * (10 x pro's 2,500), so S26 never needs to lower a cap to reach one.
 */
export const SEGMENT_CAP_SEED = MAX_CAP_MULTIPLIER * 2_500;
/**
 * 80% of LOW_VOLUME's 2,000-a-day carrier ceiling, which is also over the
 * 250-segment hourly limit and over the sole proprietor's 800.
 */
export const CARRIER_WARN_SEGMENTS = 1_600;

function isCarrierAlert(event: SeenEvent): boolean {
  const texts = [event.message, ...(event.fingerprint ?? []), ...Object.values(event.tags ?? {}), ...(event.exceptions ?? []).map((e) => e.value)];
  return texts.some((text) => text !== undefined && /carrier[\s_-]*(ceiling|daily)/i.test(text));
}

/**
 * S26: QA-C at each messaging cap. The monthly cap reads every usage row,
 * while the hourly limit and the carrier's day read outbound message rows, so
 * each is seeded where its gate reads. Only a gate that failed lets a send
 * out, which is at most two.
 */
export const S26: ScenarioRunner = {
  id: "S26",
  async run(ctx) {
    const since = ctx.now();
    let realSends = 0;
    const evidence: Record<string, unknown> = {};
    ctx.evidence.gates = evidence;
    const expectRefusal = async (name: string, status: number, code: string) => {
      const sent = await ctx.app.sendText({ member: C_OWNER, fromRole: "DEV-C1", toRole: "ROBOT-1", body: `Rig S26 ${name} ${ctx.nonce}` });
      evidence[name] = sent.ok ? "sent" : refusalOf(sent);
      if (sent.ok) {
        realSends++;
        return fail(`${name}_not_enforced`, `a text went out past the ${name.replace("_", " ")}`);
      }
      return sent.status === status && sent.code === code ? undefined : fail(`${name}_wrong_refusal`, `the send was refused with ${refusalOf(sent)}, not ${status} ${code}`);
    };

    // Checked before the hourly limit is seeded: the limit answers first once both are reached.
    const usage = await ctx.app.seedUsage({ tenant: "QA-C", type: "sms_outbound", channel: "sms", unit: "segment", quantity: SEGMENT_CAP_SEED });
    ctx.lease.registerUndo({ kind: "app.clear-seeded-usage", params: { marker: usage.marker } });
    const segmentCap = await expectRefusal("segment_cap", 402, "usage_cap_reached");

    const segments = await ctx.app.seedOutboundSegments({ tenant: "QA-C", role: "ROBOT-1", segments: CARRIER_WARN_SEGMENTS, body: `Rig S26 seeded ${ctx.nonce}` });
    ctx.lease.registerUndo({ kind: "app.clear-seeded-usage", params: { marker: segments.marker } });
    const hourly = await expectRefusal("hourly_limit", 429, "rate_limited");
    evidence.real_sends = realSends;

    await ctx.app.fireCron("25 * * * *");
    const alert = await poll(ctx, async () => (await ctx.rig.apiEvents(since)).find(isCarrierAlert), 60_000, 5_000);
    evidence.carrier_alert = Boolean(alert);
    const alerted = alert
      ? undefined
      : fail(
          "carrier_alert_missing",
          `the 80% carrier-ceiling alert did not reach loonext-rig${ctx.attempt > 1 ? "; a retry the same UTC day finds the day already warned" : ""}`,
        );
    return segmentCap ?? hourly ?? alerted ?? pass();
  },
};
