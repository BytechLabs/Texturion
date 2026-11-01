/**
 * The browser call scenarios after the first three: S03 and S05 to S11. Each
 * runs under the run lease. Where the robot is on the call it judges its
 * recording window by window; where only pages are, each page judges the
 * other's code.
 */
import { randomUUID } from "node:crypto";
import type { StandingRole } from "@loonext/rig-protocol";
import type { PageHearing } from "@loonext/rig-lanes";
import type { CallPlan, CallRecord, Surface } from "@loonext/rig-robot";
import {
  fail,
  infra,
  pass,
  poll,
  type AppApi,
  type CallRow,
  type CompanyField,
  type ScenarioContext,
  type ScenarioResult,
  type ScenarioRunner,
} from "./context.ts";

const OWNER = "qa-w-owner";
const TECHNICIAN = "qa-w-technician";
/** The technician as the transfer picker lists them: their display name in scripts/rig/tenants.mjs. */
export const TECHNICIAN_NAME = "QA-W Technician";
/** Every rig number has an Ontario area code, and the seed puts every workspace on the same clock. */
const DESTINATION_ZONE = "America/Toronto";
/** apps/api/src/routes/calls.ts: the dialer's refusal when the number's one line is taken. */
export const LINE_BUSY_TEXT = "This line is on another call";
/** The web ringing chip's label for a screen reader: how call waiting shows on a page already in a call. */
export const CALL_WAITING_TEXT = "Incoming call from";

/**
 * The robot's windows count from Telnyx's answer and the runner acts on its
 * own clock, so every window keeps this far from the action that bounds it.
 */
const MARGIN_MS = 1_000;
const RING_MS = 10_000;
const TALK_MS = 14_000;
/** How long the runner waits for the robot to learn of the answer before falling back to its own clock. */
const ANSWER_SYNC_MS = 5_000;
/** Under `in_turn` the next phone joins after packages/shared's RING_STEP_SECS (12 s), so the owner answers before then. */
export const OWNER_RING_MS = 8_000;
const ROBOT_REFUSAL = /guard_refused:|Telnyx \d{3} on /;

type Segment = { name: string; start_ms: number; end_ms: number };
const segment = (name: string, start_ms: number, end_ms: number): Segment => ({ name, start_ms, end_ms });

function robotEvidence(record: CallRecord): Record<string, unknown> {
  const { frames, ...judgement } = record.judgement ?? {};
  return {
    ids: record.ids,
    state: record.state,
    dialed_at: record.dialed_at,
    answered_at: record.answered_at,
    ended_at: record.ended_at,
    hangup: record.hangup,
    rtp: record.rtp,
    robot_heard: record.judgement ? judgement : undefined,
    robot_frames: frames,
    dtmf: record.dtmf || undefined,
    gathered: record.gathered,
    recording_deleted: record.recording_deleted,
    errors: record.errors,
  };
}

function pageEvidence(hearing: PageHearing): Record<string, unknown> {
  return {
    verdict: hearing.detection.verdict,
    answered: hearing.detection.answered,
    heard: hearing.detection.heard,
    echo: hearing.detection.echo,
    concealed_ratio: hearing.concealedRatio,
  };
}

function rowEvidence(row: CallRow | undefined): Record<string, unknown> | undefined {
  if (!row) return undefined;
  const { call_session_id, direction, state, outcome, forward_seconds, started_at, answered_at, ended_at } = row;
  return { call_session_id, direction, state, outcome, forward_seconds, started_at, answered_at, ended_at };
}

function dialFailure(record: CallRecord): ScenarioResult {
  const refusal = record.errors.find((e) => e.startsWith("guard_refused:"));
  return infra(refusal ? "guard" : "robot", record.errors.join("; ") || `the robot's plan ended ${record.state}`);
}

/** The robot's main window, as a result: undefined when it heard the member it should. */
function robotVerdict(record: CallRecord, member: Surface): ScenarioResult | undefined {
  const refusal = record.errors.find((e) => e.startsWith("guard_refused:"));
  if (refusal) return infra("guard", refusal);
  if (!record.answered_at) return fail("not_answered", `the call never connected (${record.errors.join("; ") || record.state})`);
  if (!record.judgement) return infra("robot", `no verdict on the robot's recording (${record.errors.join("; ") || record.state})`);
  if (!record.judgement.pass) {
    return fail("robot_did_not_hear_member", `the robot heard ${record.judgement.heard.join(", ") || record.judgement.verdict}, not ${member}`);
  }
  if (!record.recording_deleted) return infra("robot", "the robot could not delete Telnyx's copy of its recording");
  return undefined;
}

/** The crew's codes in one of the plan's named windows; the robot's own is echo, never a member. */
function membersIn(record: CallRecord, name: string): Surface[] | undefined {
  return record.judgement?.segments?.find((s) => s.name === name)?.heard.filter((surface) => surface !== "robot");
}

function settle(promise: Promise<unknown>): Promise<Error | undefined> {
  return promise.then(
    () => undefined,
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );
}

async function until(ctx: ScenarioContext, at: number): Promise<void> {
  const wait = at - ctx.now();
  if (wait > 0) await ctx.sleep(wait);
}

/** When Telnyx says the call was answered, which the robot's windows count from; undefined if the robot has not heard by then. */
function answerMoment(ctx: ScenarioContext, planId: string, timeoutMs = ANSWER_SYNC_MS): Promise<number | undefined> {
  return poll(ctx, async () => {
    const record = await ctx.robot.wait(planId, 1_000);
    return record.answered_at ? Date.parse(record.answered_at) : undefined;
  }, timeoutMs, 500);
}

function finishedRow(
  ctx: ScenarioContext,
  tenant: string,
  callerRole: StandingRole,
  since: number,
  match: (row: CallRow) => boolean = () => true,
): Promise<CallRow | undefined> {
  return poll(ctx, async () => {
    const rows = await ctx.app.calls({ tenant, callerRole, since });
    return rows.find((row) => row.ended_at !== null && match(row));
  }, 60_000, 2_000);
}

function metered(ctx: ScenarioContext, tenant: string, callSessionId: string): Promise<number | undefined> {
  return poll(ctx, async () => {
    const seconds = await ctx.app.meteredSeconds({ tenant, callSessionId });
    return seconds > 0 ? seconds : undefined;
  }, 60_000, 5_000);
}

/** Company settings changed under the lease, the undo registered with what they were before anything is written. */
async function changeCompany(ctx: ScenarioContext, tenant: string, values: Partial<Record<CompanyField, unknown>>): Promise<ScenarioResult | undefined> {
  const fields = Object.keys(values) as CompanyField[];
  try {
    const before = await ctx.app.companySettings({ tenant, fields });
    ctx.lease.registerUndo({ kind: "app.company-restore", params: { tenant, values: before } });
    await ctx.app.patchCompany({ tenant, values });
  } catch (error) {
    return infra("app-probe", `changing ${tenant}'s ${fields.join(", ")} failed: ${(error as Error).message}`);
  }
  ctx.evidence.company_fields = fields;
  return undefined;
}

/** An on-call shift under the lease, its undo registered under the id the runner chose before the insert. */
async function addShift(ctx: ScenarioContext, shift: Omit<Parameters<AppApi["addOnCallShift"]>[0], "id">): Promise<ScenarioResult | undefined> {
  const id = randomUUID();
  ctx.lease.registerUndo({ kind: "app.remove-on-call", params: { id } });
  try {
    await ctx.app.addOnCallShift({ ...shift, id });
  } catch (error) {
    return infra("app-probe", `putting ${shift.member} on call failed: ${(error as Error).message}`);
  }
  ctx.evidence.on_call_shift = id;
  return undefined;
}

/** S03: QA-C's owner calls DEV-W1 and QA-W's owner answers; each workspace keeps and bills its own half. */
export const S03: ScenarioRunner = {
  id: "S03",
  async run(ctx) {
    const since = ctx.now();
    const callee = await ctx.browser.open(OWNER, OWNER);
    const caller = await ctx.browser.open("qa-c-owner", "qa-c", "/calls");
    await caller.dial("DEV-W1");
    // A text-back follows only a missed call, so the callee answers on the first ring.
    const ringMs = await callee.waitForRing(RING_MS);
    ctx.evidence.ring_ms = ringMs;
    if (ringMs === undefined) {
      await settle(caller.hangUp());
      return fail("no_ring", `the QA-W owner's page did not ring within ${RING_MS / 1_000} s of QA-C's dial`);
    }
    await callee.answer();
    const answeredAt = ctx.now();
    await ctx.sleep(TALK_MS);
    const calleeHeard = await callee.hear();
    // No robot is on this call: the caller's window counts from the callee's answer mark.
    const answerMark = calleeHeard.capture.marks.find((m) => m.name === "answered")?.at ?? answeredAt;
    const callerHeard = await caller.hear({ answeredAt: answerMark });
    await settle(caller.hangUp());
    const hungUpAt = ctx.now();
    ctx.evidence.pages = { "qa-c-owner": pageEvidence(callerHeard), [OWNER]: pageEvidence(calleeHeard) };

    const [outbound, inbound] = await Promise.all([
      finishedRow(ctx, "QA-C", "DEV-W1", since, (row) => row.direction !== "inbound"),
      finishedRow(ctx, "QA-W", "DEV-C1", since, (row) => row.direction !== "outbound"),
    ]);
    ctx.evidence.rows = { "QA-C": rowEvidence(outbound), "QA-W": rowEvidence(inbound) };
    // How Telnyx routed the call on-net is kept for the rig's billing measurement, not judged.
    ctx.evidence.legs = {
      "QA-C": outbound && (await ctx.app.callLegs({ tenant: "QA-C", callSessionId: outbound.call_session_id })),
      "QA-W": inbound && (await ctx.app.callLegs({ tenant: "QA-W", callSessionId: inbound.call_session_id })),
    };
    let billing: { qa_c: number | undefined; qa_w: number | undefined; crossed: number } | undefined;
    if (outbound && inbound) {
      const [qaC, qaW] = await Promise.all([
        metered(ctx, "QA-C", outbound.call_session_id),
        metered(ctx, "QA-W", inbound.call_session_id),
      ]);
      const crossed =
        (await ctx.app.meteredSeconds({ tenant: "QA-C", callSessionId: inbound.call_session_id })) +
        (await ctx.app.meteredSeconds({ tenant: "QA-W", callSessionId: outbound.call_session_id }));
      billing = { qa_c: qaC, qa_w: qaW, crossed };
      ctx.evidence.billing = billing;
    }
    await until(ctx, hungUpAt + 30_000);
    const textBacks = (await ctx.app.messagesWith({ tenant: "QA-W", role: "DEV-C1", since })).filter((m) => m.direction === "outbound");
    ctx.evidence.text_backs = textBacks.length;

    // One workspace's state reaching the other outranks every other finding.
    if (outbound && inbound && outbound.call_session_id === inbound.call_session_id) {
      return fail("shared_session_key", "QA-C's and QA-W's rows for the call share one session key", { critical: true });
    }
    if (billing && billing.crossed > 0) {
      return fail("billed_to_other_workspace", `${billing.crossed} s of one workspace's call were metered to the other`, { critical: true });
    }
    if (callerHeard.detection.answered !== OWNER) {
      return fail("caller_did_not_hear_callee", `the QA-C page heard ${callerHeard.detection.heard.join(", ") || callerHeard.detection.verdict}`);
    }
    if (calleeHeard.detection.answered !== "qa-c") {
      return fail("callee_did_not_hear_caller", `the QA-W page heard ${calleeHeard.detection.heard.join(", ") || calleeHeard.detection.verdict}`);
    }
    if (!outbound) return fail("no_outbound_row", "QA-C has no finished outbound row for its call to DEV-W1");
    if (!inbound) return fail("no_inbound_row", "QA-W has no finished inbound row for DEV-C1's call");
    if (!billing?.qa_c) return fail("caller_not_metered", "no voice seconds were metered to QA-C for its outbound call");
    if (!billing.qa_w) return fail("callee_not_metered", "no voice seconds were metered to QA-W for the call it answered");
    if (textBacks.length > 0) return fail("text_back_after_answer", `QA-W texted DEV-C1 ${textBacks.length} time(s) after an answered call`);
    return pass();
  },
};

export const ESCALATE_AFTER_MINUTES = 10;
export const HANG_UP_AT_MS = 8_000;
/** Longer than the robot lets it ring, so nothing answers before the robot hangs up. */
const S05_RING_SECONDS = 25;

/** S05: ROBOT-1 hangs up while DEV-W1 still rings: a missed call, a text-back, a ring push and an escalation that widens. */
export const S05: ScenarioRunner = {
  id: "S05",
  async run(ctx) {
    const unset = await changeCompany(ctx, "QA-W", {
      on_call_escalate_after_minutes: ESCALATE_AFTER_MINUTES,
      // An escalation opens only after hours on a known clock; every weekday missing is closed all day.
      timezone: DESTINATION_ZONE,
      business_hours: {},
      business_hours_exceptions: [],
      after_hours_calls: "ring_everyone",
      ring_seconds: S05_RING_SECONDS,
    });
    if (unset) return unset;
    const onCall = await addShift(ctx, { tenant: "QA-W", member: OWNER, role: "DEV-W1", startsAt: ctx.now() - 60_000, endsAt: ctx.now() + 30 * 60_000 });
    if (onCall) return onCall;

    const since = ctx.now();
    // Open, so the owner's page is a surface the call rings and nobody answers.
    const page = await ctx.browser.open(OWNER, OWNER);
    const dialed = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-1",
      to: "DEV-W1",
      play: null,
      record: false,
      hangup_before_answer_ms: HANG_UP_AT_MS,
      hangup_after_ms: 1_000,
      ring_timeout_secs: 30,
    });
    if (dialed.state === "failed") return dialFailure(dialed);
    ctx.evidence.ring_ms = await page.waitForRing(HANG_UP_AT_MS);
    const record = await ctx.robot.wait(dialed.plan_id, 60_000);
    const hungUpAt = ctx.now();
    ctx.evidence.call = robotEvidence(record);
    if (record.answered_at) return fail("answered_while_ringing", `the call was answered at ${record.answered_at}, before the robot hung up`);

    const textBack = await poll(ctx, async () => {
      const inbox = await ctx.robot.inbox({ to_role: "ROBOT-1", since: hungUpAt - 5_000 });
      return inbox.find((m) => m.event === "message.received" && m.from_role === "DEV-W1");
    }, 60_000, 2_000);
    ctx.evidence.text_back = textBack && { id: textBack.id, after_ms: textBack.received_at - hungUpAt };
    if (!textBack) return fail("no_text_back", "ROBOT-1 got no text-back within 60 s of hanging up");

    const row = await finishedRow(ctx, "QA-W", "ROBOT-1", since);
    ctx.evidence.row = rowEvidence(row);
    if (!row) return fail("no_call_row", "no finished call row for ROBOT-1's call");
    if (row.outcome !== "missed") return fail("row_not_missed", `the call row reads ${row.outcome ?? "nothing"}`);

    const pushes = await poll(ctx, async () => {
      const attempts = await ctx.app.pushAttempts({ tenant: "QA-W", since, purpose: "ring" });
      const rings = attempts.filter((p) => p.purpose === "ring" && (!p.call_session_id || p.call_session_id === row.call_session_id));
      return rings.length > 0 ? rings : undefined;
    }, 30_000, 2_000);
    ctx.evidence.ring_pushes = pushes?.map((p) => ({ platform: p.platform, response: p.response_class, priority: p.priority }));
    if (!pushes) return fail("no_ring_push", "no ring push attempt was recorded for the call");
    return escalationWidens(ctx, since);
  },
};

async function escalationWidens(ctx: ScenarioContext, since: number): Promise<ScenarioResult> {
  const opened = await poll(ctx, async () => (await ctx.app.escalations({ tenant: "QA-W", since })).find((e) => e.kind === "missed_call"), 30_000, 2_000);
  if (!opened) return fail("no_escalation", "the missed call opened no on-call escalation");
  const at = ctx.now() + ESCALATE_AFTER_MINUTES * 60_000 + 30_000;
  try {
    await ctx.app.fireCron("* * * * *", at);
  } catch (error) {
    return infra("cron", `firing the minute cron failed: ${(error as Error).message}`);
  }
  const widened = await poll(ctx, async () => {
    const rows = await ctx.app.escalations({ tenant: "QA-W", since });
    return rows.find((e) => e.kind === opened.kind && e.escalate_at === opened.escalate_at && e.escalated_at);
  }, 30_000, 2_000);
  ctx.evidence.escalation = {
    escalate_at: opened.escalate_at,
    fired_for: new Date(at).toISOString(),
    escalated_at: widened?.escalated_at ?? null,
    acknowledged_at: opened.acknowledged_at,
  };
  if (widened) return pass();
  return fail("escalation_not_widened", `the escalation due ${opened.escalate_at} was still narrow after the cron ran for ${new Date(at).toISOString()}`);
}

/** S06's controls, from the owner's answer. Each lasts about 6 s, and the keys follow the second resume. */
export const S06_STEPS = { holdOn: 7_000, holdOff: 13_000, muteOn: 20_000, muteOff: 26_000, keys: 33_000 } as const;
/** The member's code must be back this long after a resume. */
export const RETURN_MS = 2_000;
export const S06_DIGITS = "123#";
export const S06_SEGMENTS: Segment[] = [
  segment("hold", S06_STEPS.holdOn + MARGIN_MS, S06_STEPS.holdOff - MARGIN_MS),
  segment("after_hold", S06_STEPS.holdOff + RETURN_MS + MARGIN_MS, S06_STEPS.holdOff + RETURN_MS + MARGIN_MS + 4_000),
  segment("mute", S06_STEPS.muteOn + MARGIN_MS, S06_STEPS.muteOff - MARGIN_MS),
  segment("after_mute", S06_STEPS.muteOff + RETURN_MS + MARGIN_MS, S06_STEPS.muteOff + RETURN_MS + MARGIN_MS + 4_000),
];
const S06_EXPECT: [name: string, present: boolean, failure: string][] = [
  ["hold", false, "heard_during_hold"],
  ["after_hold", true, "not_back_after_hold"],
  ["mute", false, "heard_while_muted"],
  ["after_mute", true, "not_back_after_mute"],
];

/** S06: hold, mute and the keypad, judged by what the robot heard in each window. */
export const S06: ScenarioRunner = {
  id: "S06",
  async run(ctx) {
    const page = await ctx.browser.open(OWNER, OWNER);
    const dialed = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-1",
      to: "DEV-W1",
      expect: OWNER,
      window: { start_ms: 2_000, end_ms: S06_STEPS.holdOn - MARGIN_MS },
      segments: S06_SEGMENTS,
      gather: { max_digits: 4, terminating_digit: "#" },
      hangup_after_ms: S06_STEPS.keys + 9_000,
    });
    if (dialed.state === "failed") return dialFailure(dialed);
    const ringMs = await page.waitForRing(RING_MS);
    ctx.evidence.ring_ms = ringMs;
    if (ringMs === undefined) {
      await ctx.robot.wait(dialed.plan_id, 90_000);
      return fail("no_ring", `the owner's page did not ring within ${RING_MS / 1_000} s`);
    }
    const clicked = ctx.now();
    await page.answer();
    const answeredAt = (await answerMoment(ctx, dialed.plan_id)) ?? clicked;
    const steps: [at: number, name: string, act: () => Promise<void>][] = [
      [S06_STEPS.holdOn, "hold", () => page.hold(true)],
      [S06_STEPS.holdOff, "resume", () => page.hold(false)],
      [S06_STEPS.muteOn, "mute", () => page.mute(true)],
      [S06_STEPS.muteOff, "unmute", () => page.mute(false)],
      [S06_STEPS.keys, "keypad", () => page.pressKeys(S06_DIGITS)],
    ];
    for (const [at, name, act] of steps) {
      await until(ctx, answeredAt + at);
      const error = await settle(act());
      if (error) return infra("browser-lane", `${name}: ${error.message}`);
    }
    const record = await ctx.robot.wait(dialed.plan_id, 120_000);
    ctx.evidence.call = robotEvidence(record);

    const robot = robotVerdict(record, OWNER);
    if (robot) return robot;
    for (const [name, present, failure] of S06_EXPECT) {
      const heard = membersIn(record, name);
      if (!heard) return infra("robot", `no verdict on the robot's ${name} window`);
      if (heard.includes(OWNER) !== present) {
        return fail(failure, `in the ${name} window the robot heard ${heard.join(", ") || "no member"}`);
      }
    }
    if (!record.gathered) return fail("digits_not_gathered", `the robot gathered nothing (dtmf ${record.dtmf || "none"})`);
    if (record.gathered.digits !== "123") return fail("wrong_digits", `the robot gathered ${record.gathered.digits || "nothing"}, not 123`);
    return pass();
  },
};

export const S07_VARIANTS = ["blind", "decline", "timeout", "hop-cap"] as const;
export type TransferVariant = (typeof S07_VARIANTS)[number];
export const TRANSFER_AT_MS = 8_000;
const TARGET_RING_MS = 10_000;
const SNAP_BACK_RING_MS = 15_000;
/** apps/api/src/messaging/live-call.ts TRANSFER_TIMEOUT_SECS: how long an unanswered transfer rings before it snaps back. */
export const TRANSFER_RING_SECS = 25;
/** Long enough for the voicemail greeting and its beep once the hop cap is reached. */
const VOICEMAIL_LISTEN_MS = 25_000;

/**
 * From the owner's answer: when the target must have rung, when a snap-back
 * must have rung the owner, and the window the robot then judges. Every wait
 * is bounded by these, so the window never opens before the answer it judges.
 */
export function transferTimeline(variant: TransferVariant): { targetBy: number; snapBackBy?: number; after?: Segment; hangup: number } {
  const targetBy = TRANSFER_AT_MS + TARGET_RING_MS;
  const snapBackBy = variant === "blind" ? undefined : targetBy + SNAP_BACK_RING_MS + (variant === "timeout" ? TRANSFER_RING_SECS * 1_000 : 0);
  const settledBy = snapBackBy ?? targetBy;
  if (variant === "hop-cap") return { targetBy, snapBackBy, hangup: settledBy + VOICEMAIL_LISTEN_MS };
  const after = segment("after", settledBy + RETURN_MS + MARGIN_MS, settledBy + RETURN_MS + MARGIN_MS + 8_000);
  return { targetBy, snapBackBy, after, hangup: after.end_ms + 4_000 };
}

/**
 * S07: the owner blind-transfers ROBOT-1's call to the technician. The
 * variants miss the transfer: a decline or a timeout snaps the call back to
 * the owner, and missing the snap-back too (the hop cap) sends it to voicemail.
 */
export const S07: ScenarioRunner = {
  id: "S07",
  async run(ctx) {
    const variant = (ctx.slot.label ?? "blind") as TransferVariant;
    if (!S07_VARIANTS.includes(variant)) return infra("runner", `S07 has no "${variant}" variant`);
    ctx.evidence.variant = variant;
    const timeline = transferTimeline(variant);
    // In turn, the owner rings alone and answers before the technician joins: one ring dial, so a snap-back still fits S07's three.
    const unset = await changeCompany(ctx, "QA-W", { ring_strategy: "in_turn" });
    if (unset) return unset;
    const owner = await ctx.browser.open(OWNER, OWNER);
    const technician = await ctx.browser.open(TECHNICIAN, TECHNICIAN);
    const since = ctx.now();
    const dialed = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-1",
      to: "DEV-W2",
      expect: OWNER,
      window: { start_ms: 2_000, end_ms: TRANSFER_AT_MS - MARGIN_MS },
      segments: timeline.after ? [timeline.after] : undefined,
      hangup_after_ms: timeline.hangup,
    });
    if (dialed.state === "failed") return dialFailure(dialed);
    const ringMs = await owner.waitForRing(OWNER_RING_MS);
    ctx.evidence.ring_ms = ringMs;
    if (ringMs === undefined) {
      await ctx.robot.wait(dialed.plan_id, 90_000);
      return fail("no_ring", `the owner's page did not ring within ${OWNER_RING_MS / 1_000} s`);
    }
    const clicked = ctx.now();
    await owner.answer();
    const answeredAt = (await answerMoment(ctx, dialed.plan_id)) ?? clicked;
    const left = (by: number) => Math.max(0, answeredAt + by - ctx.now());

    await until(ctx, answeredAt + TRANSFER_AT_MS);
    const refused = await settle(owner.transfer({ to: TECHNICIAN_NAME, mode: "blind" }));
    if (refused) return infra("browser-lane", refused.message);
    const targetRing = await technician.waitForRing(left(timeline.targetBy));
    ctx.evidence.target_ring_ms = targetRing;
    if (targetRing === undefined) {
      await ctx.robot.wait(dialed.plan_id, 180_000);
      return fail("transfer_never_rang", "the technician's page did not ring for the transfer");
    }
    if (variant === "blind") {
      await technician.answer();
    } else {
      if (variant !== "timeout") await technician.decline();
      const snapBack = await owner.waitForRing(left(timeline.snapBackBy!));
      ctx.evidence.snap_back_ms = snapBack;
      if (snapBack === undefined) {
        await ctx.robot.wait(dialed.plan_id, 180_000);
        return fail("no_snap_back", `after the ${variant} the owner's page never rang again`);
      }
      if (variant === "hop-cap") await owner.decline();
      else await owner.answer();
    }
    const record = await ctx.robot.wait(dialed.plan_id, 180_000);
    ctx.evidence.call = robotEvidence(record);
    const robot = robotVerdict(record, OWNER);
    if (robot) return robot;
    const row = await finishedRow(ctx, "QA-W", "ROBOT-1", since);
    ctx.evidence.row = rowEvidence(row);
    if (!row) return fail("no_call_row", "no finished call row for ROBOT-1's call");
    const legs = await ctx.app.callLegs({ tenant: "QA-W", callSessionId: row.call_session_id });
    ctx.evidence.legs = legs;

    if (variant === "hop-cap") {
      return row.outcome === "voicemail"
        ? pass()
        : fail("hop_cap_not_voicemail", `after a missed transfer and a missed snap-back the row reads ${row.outcome ?? "nothing"}`);
    }
    const heard = membersIn(record, "after");
    if (!heard) return infra("robot", "no verdict on the robot's window after the transfer");
    if (variant === "blind") {
      if (!heard.includes(TECHNICIAN) || heard.includes(OWNER)) {
        return fail("robot_did_not_hear_target", `after the transfer the robot heard ${heard.join(", ") || "no member"}`);
      }
      if (!legs.some((leg) => leg.kind === "transfer" && leg.member === TECHNICIAN && leg.state === "answered")) {
        return fail("transfer_not_recorded", "the call's legs hold no answered transfer leg to the technician");
      }
      return pass();
    }
    if (!heard.includes(OWNER) || heard.includes(TECHNICIAN)) {
      return fail("did_not_snap_back", `after the ${variant} the robot heard ${heard.join(", ") || "no member"}, not the owner`);
    }
    return pass();
  },
};

export const CONSULT_AT_MS = 7_000;
/** The target must have answered 2 s before this opens, so the consult is up throughout. */
export const CONSULT_SEGMENT = segment("consult", 20_000, 27_000);
export const COMPLETE_AT_MS = 28_000;
export const AFTER_COMPLETE_SEGMENT = segment("after", 31_000, 39_000);
const WEEK_MS = 7 * 86_400_000;

/** Which way S08 runs: the slot's label when it names one, else alternating by week. */
export function consultDirection(ctx: Pick<ScenarioContext, "slot" | "now">): "inbound" | "outbound" {
  const label = ctx.slot.label;
  if (label === "inbound" || label === "outbound") return label;
  return Math.floor(ctx.now() / WEEK_MS) % 2 === 0 ? "inbound" : "outbound";
}

/**
 * S08: a consult transfer, inbound (ROBOT-1 calls DEV-W2) or outbound (the
 * owner calls ROBOT-1). While the owner and the technician talk the robot
 * hears no member; after completion it hears the technician, and the owner's
 * leg is gone.
 */
export const S08: ScenarioRunner = {
  id: "S08",
  async run(ctx) {
    const direction = consultDirection(ctx);
    ctx.evidence.direction = direction;
    if (direction === "inbound") {
      // The owner answers alone, so the crew ring is one dial and the consult's two legs keep the run at three.
      const unset = await changeCompany(ctx, "QA-W", { ring_strategy: "in_turn" });
      if (unset) return unset;
    }
    const owner = await ctx.browser.open(OWNER, OWNER, "/calls");
    const technician = await ctx.browser.open(TECHNICIAN, TECHNICIAN);
    const since = ctx.now();
    const plan: Omit<CallPlan, "direction"> = {
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      role: "ROBOT-1",
      expect: OWNER,
      window: { start_ms: 2_000, end_ms: CONSULT_AT_MS - MARGIN_MS },
      segments: [CONSULT_SEGMENT, AFTER_COMPLETE_SEGMENT],
      hangup_after_ms: AFTER_COMPLETE_SEGMENT.end_ms + 4_000,
    };
    let started: CallRecord;
    if (direction === "inbound") {
      started = await ctx.robot.dial({ ...plan, direction: "outbound", to: "DEV-W2" });
      if (started.state === "failed") return dialFailure(started);
      const ringMs = await owner.waitForRing(OWNER_RING_MS);
      ctx.evidence.ring_ms = ringMs;
      if (ringMs === undefined) {
        await ctx.robot.wait(started.plan_id, 90_000);
        return fail("no_ring", `the owner's page did not ring within ${OWNER_RING_MS / 1_000} s`);
      }
      await owner.answer();
    } else {
      started = await ctx.robot.expect({ ...plan, direction: "inbound", answer_after_ms: 3_000, expect_within_ms: 60_000 });
      if (started.state === "failed") return dialFailure(started);
      await owner.dial("ROBOT-1");
    }
    // The robot answers the outbound case itself, so its record is the only clock for when.
    const answeredAt = await answerMoment(ctx, started.plan_id, 30_000);
    if (answeredAt === undefined) {
      ctx.evidence.call = robotEvidence(await ctx.robot.wait(started.plan_id, 60_000));
      return fail("not_answered", "the robot's call never connected");
    }

    await until(ctx, answeredAt + CONSULT_AT_MS);
    // The call bar may offer Complete only once the target answers, so the target answers while the transfer is still in hand.
    const transferring = settle(owner.transfer({ to: TECHNICIAN_NAME, mode: "consult" }));
    const targetRing = await technician.waitForRing(Math.max(0, answeredAt + CONSULT_SEGMENT.start_ms - RETURN_MS - ctx.now()));
    ctx.evidence.target_ring_ms = targetRing;
    if (targetRing !== undefined) {
      await technician.answer();
      await owner.mark("consult_answered");
    }
    const consultAnsweredAt = ctx.now();
    const refused = await transferring;
    // The web call bar has blind transfer only today; a lane that cannot drive the consult is not a product failure.
    if (refused) return infra("browser-lane", refused.message);
    if (targetRing === undefined) {
      await ctx.robot.wait(started.plan_id, 120_000);
      return fail("consult_never_rang", "the technician's page did not ring for the consult");
    }
    await until(ctx, answeredAt + COMPLETE_AT_MS);
    const incomplete = await settle(owner.completeTransfer());
    if (incomplete) return infra("browser-lane", incomplete.message);
    const record = await ctx.robot.wait(started.plan_id, 180_000);
    const consult = { windowStartMs: 2_000, windowEndMs: answeredAt + COMPLETE_AT_MS - MARGIN_MS - consultAnsweredAt };
    const targetHeard = await technician.hear(consult);
    const senderHeard = await owner.hear({ ...consult, answerMark: "consult_answered" });
    ctx.evidence.call = robotEvidence(record);
    ctx.evidence.pages = { [OWNER]: pageEvidence(senderHeard), [TECHNICIAN]: pageEvidence(targetHeard) };

    const robot = robotVerdict(record, OWNER);
    if (robot) return robot;
    const during = membersIn(record, CONSULT_SEGMENT.name);
    const after = membersIn(record, AFTER_COMPLETE_SEGMENT.name);
    if (!during || !after) return infra("robot", "no verdict on the robot's consult and after-transfer windows");
    if (during.length > 0) return fail("robot_heard_consult", `during the consult the robot heard ${during.join(", ")}`);
    if (senderHeard.detection.answered !== TECHNICIAN) {
      return fail("sender_did_not_hear_target", `during the consult the owner's page heard ${senderHeard.detection.heard.join(", ") || senderHeard.detection.verdict}`);
    }
    if (targetHeard.detection.answered !== OWNER) {
      return fail("target_did_not_hear_sender", `during the consult the technician's page heard ${targetHeard.detection.heard.join(", ") || targetHeard.detection.verdict}`);
    }
    if (!after.includes(TECHNICIAN) || after.includes(OWNER)) {
      return fail("robot_did_not_hear_target", `after the transfer the robot heard ${after.join(", ") || "no member"}`);
    }
    // An outbound row is filed under the number it called, which here is ROBOT-1 too.
    const row = await finishedRow(ctx, "QA-W", "ROBOT-1", since);
    ctx.evidence.row = rowEvidence(row);
    if (!row) return fail("no_call_row", "no finished call row for the call");
    const legs = await ctx.app.callLegs({ tenant: "QA-W", callSessionId: row.call_session_id });
    ctx.evidence.legs = legs;
    if (legs.some((leg) => leg.member === OWNER && leg.kind === "consult" && leg.state === "answered")) {
      return fail("sender_leg_not_ended", "the owner's consult leg is still answered after the transfer completed");
    }
    return pass();
  },
};

/** The number of dials the app made through the guard under this lease. */
async function appDials(ctx: ScenarioContext): Promise<number> {
  const { activity } = await ctx.guard.activity(ctx.lease.id);
  return Object.entries(activity)
    .filter(([key]) => key.startsWith("rig-api POST /v2/calls "))
    .reduce((sum, [, count]) => sum + count, 0);
}

export const BUSY_VOICEMAIL_MS = 8_000;
/** A dial that slipped past the line check reaches the guard within this. */
const DIAL_SETTLE_MS = 5_000;
const SELF_DIAL_MS = 15_000;

/**
 * S09: while DEV-W1's one line is on ROBOT-1's call, ROBOT-2 reaches
 * voicemail and the owner's own dial is refused before any dial; once the
 * line is free, DEV-W1 calling itself reaches voicemail too.
 */
export const S09: ScenarioRunner = {
  id: "S09",
  async run(ctx) {
    const page = await ctx.browser.open(OWNER, OWNER, "/calls");
    const first = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-1",
      to: "DEV-W1",
      record: false,
      hangup_after_ms: 120_000,
    });
    if (first.state === "failed") return dialFailure(first);
    const ringMs = await page.waitForRing(RING_MS);
    ctx.evidence.ring_ms = ringMs;
    if (ringMs === undefined) {
      await ctx.robot.wait(first.plan_id, 150_000);
      return fail("no_ring", `the owner's page did not ring within ${RING_MS / 1_000} s`);
    }
    await page.answer();

    const busySince = ctx.now();
    const second = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-2",
      to: "DEV-W1",
      play: null,
      record: false,
      hangup_after_ms: 6_000,
      ring_timeout_secs: 30,
    });
    const secondRecord = second.state === "failed" ? second : await ctx.robot.wait(second.plan_id, 60_000);
    ctx.evidence.second_call = robotEvidence(secondRecord);
    // nonprod-robot-ovp allows the robot one call at a time, so Telnyx or the guard may refuse this one.
    const refusal = secondRecord.errors.find((e) => ROBOT_REFUSAL.test(e));
    if (refusal) return infra("robot", `the second robot call was refused: ${refusal}`);
    if (second.state === "failed") return infra("robot", second.errors.join("; ") || "the second robot call failed");

    const readDials = () => appDials(ctx).catch((error: unknown) => infra("guard", `reading the lease's activity failed: ${(error as Error).message}`));
    const dialsBefore = await readDials();
    if (typeof dialsBefore !== "number") return dialsBefore;
    const busyDial = await settle(page.dial("ROBOT-2"));
    if (busyDial) return infra("browser-lane", `dialing from the busy line: ${busyDial.message}`);
    const busyNotice = await page.waitForText(LINE_BUSY_TEXT, 10_000);
    await ctx.sleep(DIAL_SETTLE_MS);
    const dialsAfter = await readDials();
    if (typeof dialsAfter !== "number") return dialsAfter;
    ctx.evidence.busy_notice = busyNotice;
    ctx.evidence.dials_while_busy = dialsAfter - dialsBefore;
    await settle(page.hangUp());
    const firstRecord = await ctx.robot.wait(first.plan_id, 150_000);
    ctx.evidence.first_call = robotEvidence(firstRecord);

    const selfSince = ctx.now();
    await page.dial("DEV-W1");
    await ctx.sleep(SELF_DIAL_MS);
    await settle(page.hangUp());

    const busyRow = await finishedRow(ctx, "QA-W", "ROBOT-2", busySince);
    // Both halves of a self-dial are filed under DEV-W1; the inbound one is the half voicemail takes.
    const selfRow = await finishedRow(ctx, "QA-W", "DEV-W1", selfSince, (row) => row.direction !== "outbound");
    ctx.evidence.rows = { busy: rowEvidence(busyRow), self_dial: rowEvidence(selfRow) };

    if (!firstRecord.answered_at) return fail("not_answered", "ROBOT-1's call to DEV-W1 never connected");
    if (!secondRecord.answered_at) return fail("busy_caller_not_answered", "ROBOT-2's call to the busy line was never answered");
    if (!secondRecord.dialed_at) return infra("robot", "the second robot call has no dial time");
    const busyMs = Date.parse(secondRecord.answered_at) - Date.parse(secondRecord.dialed_at);
    ctx.evidence.busy_voicemail_ms = busyMs;
    if (busyMs > BUSY_VOICEMAIL_MS) return fail("busy_voicemail_late", `the busy line answered ROBOT-2 after ${busyMs} ms, over ${BUSY_VOICEMAIL_MS}`);
    if (busyRow?.outcome !== "voicemail") return fail("busy_row_not_voicemail", `ROBOT-2's row reads ${busyRow?.outcome ?? "nothing"}`);
    if (!busyNotice) return fail("no_busy_notice", `the owner's page never said "${LINE_BUSY_TEXT}"`);
    if (dialsAfter > dialsBefore) return fail("dialed_while_busy", `the app dialed ${dialsAfter - dialsBefore} time(s) from a line already on a call`);
    if (selfRow?.outcome !== "voicemail") return fail("self_dial_not_voicemail", `DEV-W1's call to itself reads ${selfRow?.outcome ?? "nothing"}`);
    return pass();
  },
};

/** S10: the owner calls DEV-W2 from DEV-W1. DEV-W2's crew rings, the owner's page shows call waiting, and the two pages talk. */
export const S10: ScenarioRunner = {
  id: "S10",
  async run(ctx) {
    const since = ctx.now();
    const caller = await ctx.browser.open(OWNER, OWNER, "/calls");
    const crew = await ctx.browser.open(TECHNICIAN, TECHNICIAN);
    await caller.dial("DEV-W2");
    // DEV-W2's audience includes the owner, whose page is already on the call it placed.
    const [crewRing, ownRing, waiting] = await Promise.all([
      crew.waitForRing(RING_MS),
      caller.waitForRing(RING_MS),
      caller.waitForText(CALL_WAITING_TEXT, RING_MS),
    ]);
    ctx.evidence.ring_ms = { [TECHNICIAN]: crewRing, [OWNER]: ownRing };
    ctx.evidence.call_waiting = waiting;
    if (crewRing === undefined) {
      await settle(caller.hangUp());
      return fail("crew_not_rung", `the technician's page did not ring within ${RING_MS / 1_000} s`);
    }
    await crew.answer();
    const answeredAt = ctx.now();
    await ctx.sleep(TALK_MS);
    const crewHeard = await crew.hear();
    const answerMark = crewHeard.capture.marks.find((m) => m.name === "answered")?.at ?? answeredAt;
    const callerHeard = await caller.hear({ answeredAt: answerMark });
    await settle(caller.hangUp());
    ctx.evidence.pages = { [OWNER]: pageEvidence(callerHeard), [TECHNICIAN]: pageEvidence(crewHeard) };

    // Both rows are QA-W's: the inbound one is filed under its caller, DEV-W1, and the outbound one under DEV-W2.
    const inbound = await finishedRow(ctx, "QA-W", "DEV-W1", since, (row) => row.direction === "inbound");
    const outbound = (await ctx.app.calls({ tenant: "QA-W", callerRole: "DEV-W2", since })).find((row) => row.direction === "outbound");
    ctx.evidence.rows = { inbound: rowEvidence(inbound), outbound: rowEvidence(outbound) };

    if (ownRing === undefined) return fail("owner_not_rung", "the owner's page did not ring for DEV-W2, whose audience includes the owner");
    if (!waiting) return fail("no_call_waiting", "the owner's page, already on a call, never showed the incoming one");
    if (callerHeard.detection.answered !== TECHNICIAN) {
      return fail("caller_did_not_hear_crew", `the owner's page heard ${callerHeard.detection.heard.join(", ") || callerHeard.detection.verdict}`);
    }
    if (crewHeard.detection.answered !== OWNER) {
      return fail("crew_did_not_hear_caller", `the technician's page heard ${crewHeard.detection.heard.join(", ") || crewHeard.detection.verdict}`);
    }
    if (!inbound) return fail("no_call_row", "QA-W has no finished inbound row for DEV-W1's call to DEV-W2");
    if (inbound.outcome !== "answered") return fail("row_not_answered", `the inbound row reads ${inbound.outcome ?? "nothing"}`);
    return pass();
  },
};

export const S11_RING_SECONDS = 20;
export const RING_LENGTH_TOLERANCE_MS = 2_000;
/** How long the owner's page must stay quiet. */
const IDLE_MS = 15_000;

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Business hours that are closed now on the destination clock but open later
 * or earlier today, in packages/shared business-hours.ts's shape. Every other
 * weekday is missing, which is closed all day.
 */
export function hoursClosedAt(at: number): Record<string, { open: string; close: string }> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DESTINATION_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const minutes = Number(part("hour")) * 60 + Number(part("minute"));
  const [open, close] = minutes + 180 < 24 * 60 ? [minutes + 120, minutes + 180] : [minutes - 180, minutes - 120];
  return { [part("weekday").toLowerCase()]: { open: hhmm(open), close: hhmm(close) } };
}

/**
 * S11: after hours with `on_call_only`, ROBOT-1's call to DEV-W2 rings only
 * the technician, who is on call, and voicemail takes it at the ring length.
 * #106 always rings an owner where they have a surface; the after-hours rule
 * is what keeps this owner's page quiet.
 */
export const S11: ScenarioRunner = {
  id: "S11",
  async run(ctx) {
    const unset = await changeCompany(ctx, "QA-W", {
      timezone: DESTINATION_ZONE,
      business_hours: hoursClosedAt(ctx.now()),
      business_hours_exceptions: [],
      after_hours_calls: "on_call_only",
      ring_strategy: "in_turn",
      ring_seconds: S11_RING_SECONDS,
    });
    if (unset) return unset;
    const onCall = await addShift(ctx, { tenant: "QA-W", member: TECHNICIAN, role: "DEV-W2", startsAt: ctx.now() - 60_000, endsAt: ctx.now() + 30 * 60_000 });
    if (onCall) return onCall;

    const owner = await ctx.browser.open(OWNER, OWNER);
    const technician = await ctx.browser.open(TECHNICIAN, TECHNICIAN);
    const dialed = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-1",
      to: "DEV-W2",
      play: null,
      record: false,
      hangup_after_ms: 5_000,
      ring_timeout_secs: 60,
    });
    if (dialed.state === "failed") return dialFailure(dialed);
    const [onCallRing, ownerRing] = await Promise.all([technician.waitForRing(RING_MS), owner.waitForRing(IDLE_MS)]);
    ctx.evidence.ring_ms = { [TECHNICIAN]: onCallRing, [OWNER]: ownerRing };
    const record = await ctx.robot.wait(dialed.plan_id, 120_000);
    ctx.evidence.call = robotEvidence(record);

    if (onCallRing === undefined) return fail("on_call_not_rung", `the on-call technician's page did not ring within ${RING_MS / 1_000} s`);
    if (ownerRing !== undefined) return fail("off_call_rang", `the owner's page rang after hours, ${ownerRing} ms in, though only the technician is on call`);
    if (!record.answered_at) return fail("voicemail_not_answered", `voicemail never took the call (${record.errors.join("; ") || record.state})`);
    if (!record.dialed_at) return infra("robot", "the robot's call has no dial time");
    const ringLengthMs = Date.parse(record.answered_at) - Date.parse(record.dialed_at);
    ctx.evidence.ring_length_ms = ringLengthMs;
    if (Math.abs(ringLengthMs - S11_RING_SECONDS * 1_000) > RING_LENGTH_TOLERANCE_MS) {
      return fail("ring_length", `voicemail answered after ${ringLengthMs} ms, not ${S11_RING_SECONDS} s ± ${RING_LENGTH_TOLERANCE_MS / 1_000} s`);
    }
    return pass();
  },
};
