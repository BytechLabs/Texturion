/**
 * The first call scenarios: S01, S02 and S04. Each runs
 * under the run lease, and each judges audio both ways: the robot judges its
 * recording for the member's code, and the member's page judges what it heard
 * for the robot's.
 */
import type { CallRecord } from "@loonext/rig-robot";
import type { PageHearing } from "@loonext/rig-lanes";
import { fail, infra, pass, poll, wordErrorRate, type ScenarioContext, type ScenarioResult, type ScenarioRunner } from "./context.ts";

/** S04's fixed phrase; the transcript is scored against it. */
export const VOICEMAIL_PHRASE = "Hello, this is the rig robot. Please call me back about the water heater on Tuesday.";
export const MAX_WORD_ERROR = 0.25;
const TALK_MS = 25_000;

/** What each call keeps as evidence: ids and numbers, never audio and never a phone number. */
function callEvidence(record: CallRecord, hearing?: PageHearing): Record<string, unknown> {
  const { frames: _frames, ...judgement } = record.judgement ?? {};
  return {
    ids: record.ids,
    state: record.state,
    dialed_at: record.dialed_at,
    answered_at: record.answered_at,
    ended_at: record.ended_at,
    hangup: record.hangup,
    rtp: record.rtp,
    robot_heard: record.judgement ? judgement : undefined,
    robot_frames: record.judgement?.frames,
    recording_deleted: record.recording_deleted,
    errors: record.errors,
    page_heard: hearing
      ? {
          verdict: hearing.detection.verdict,
          answered: hearing.detection.answered,
          heard: hearing.detection.heard,
          echo: hearing.detection.echo,
          concealed_ratio: hearing.concealedRatio,
          energy_before_answer: hearing.energyBeforeAnswer,
        }
      : undefined,
  };
}

/** The robot's side of a call, as a result: undefined when it heard what it should. */
function robotVerdict(record: CallRecord, member: string): ScenarioResult | undefined {
  if (record.errors.some((e) => e.startsWith("guard_refused:"))) {
    return infra("guard", record.errors.find((e) => e.startsWith("guard_refused:"))!);
  }
  if (!record.answered_at) return fail("not_answered", `the call never connected (${record.errors.join("; ") || record.state})`);
  if (!record.judgement) return infra("robot", `no verdict on the robot's recording (${record.errors.join("; ") || record.state})`);
  if (!record.judgement.pass) {
    return fail("robot_did_not_hear_member", `the robot heard ${record.judgement.heard.join(", ") || record.judgement.verdict}, not ${member}`);
  }
  if (!record.recording_deleted) return infra("robot", "the robot could not delete Telnyx's copy of its recording");
  return undefined;
}

/** S01: the browser calls a phone number; ROBOT-1 answers after 4 s. */
export const S01: ScenarioRunner = {
  id: "S01",
  async run(ctx) {
    const since = ctx.now();
    const page = await ctx.browser.open("qa-w-owner", "qa-w-owner", "/calls");
    const plan = await ctx.robot.expect({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "inbound",
      role: "ROBOT-1",
      answer_after_ms: 4_000,
      expect_within_ms: 60_000,
      expect: "qa-w-owner",
      hangup_after_ms: TALK_MS,
    });
    if (plan.state === "failed") return infra("robot", plan.errors.join("; "));
    await page.dial("ROBOT-1");
    const record = await ctx.robot.wait(plan.plan_id, 180_000);
    const answeredAt = record.answered_at ? Date.parse(record.answered_at) : undefined;
    const hearing = await page.hear({ answeredAt });
    ctx.evidence.call = callEvidence(record, hearing);

    const robot = robotVerdict(record, "qa-w-owner");
    if (robot) return robot;
    if (record.from_role !== "DEV-W1") return fail("wrong_caller_id", `the robot saw the call from ${record.from_role ?? "nobody"}`);
    if (hearing.detection.answered !== "robot") {
      return fail("member_did_not_hear_robot", `the page heard ${hearing.detection.heard.join(", ") || hearing.detection.verdict}`);
    }
    if (!(hearing.energyBeforeAnswer && hearing.energyBeforeAnswer > 0)) return fail("no_ringback", "no audio energy reached the page before answer");
    if ((await ctx.app.outboundAuthorizationsLeft({ tenant: "QA-W", since })) !== 0) {
      return fail("token_not_consumed", "the call's one-time token was not used exactly once");
    }
    const metered = await poll(ctx, async () => {
      const seconds = await ctx.app.voiceSecondsSince({ tenant: "QA-W", since });
      return seconds > 0 ? seconds : undefined;
    }, 60_000, 5_000);
    if (!metered) return fail("no_voice_meter", "no voice seconds were metered for the call");
    return pass();
  },
};

/** S02: ROBOT-1 calls DEV-W1 and the owner answers in the browser. */
export const S02: ScenarioRunner = {
  id: "S02",
  async run(ctx) {
    const since = ctx.now();
    const page = await ctx.browser.open("qa-w-owner", "qa-w-owner", "/");
    const dialed = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-1",
      to: "DEV-W1",
      expect: "qa-w-owner",
      hangup_after_ms: TALK_MS,
    });
    if (dialed.state === "failed") {
      const refusal = dialed.errors.find((e) => e.startsWith("guard_refused:"));
      return infra(refusal ? "guard" : "robot", dialed.errors.join("; "));
    }
    const ringMs = await page.waitForRing(6_000);
    ctx.evidence.ring_ms = ringMs;
    if (ringMs === undefined) {
      await ctx.robot.wait(dialed.plan_id, 90_000);
      return fail("no_ring_within_6s", "the owner's page did not ring within 6 s");
    }
    await page.answer();
    const record = await ctx.robot.wait(dialed.plan_id, 180_000);
    const hearing = await page.hear();
    ctx.evidence.call = callEvidence(record, hearing);

    const robot = robotVerdict(record, "qa-w-owner");
    if (robot) return robot;
    if (hearing.detection.answered !== "robot") {
      return fail("member_did_not_hear_robot", `the page heard ${hearing.detection.heard.join(", ") || hearing.detection.verdict}`);
    }
    const row = await poll(ctx, async () => {
      const rows = await ctx.app.calls({ tenant: "QA-W", callerRole: "ROBOT-1", since });
      return rows.find((r) => r.ended_at !== null);
    }, 60_000, 2_000);
    if (!row) return fail("no_call_row", "no finished call row for ROBOT-1's call");
    if (row.outcome !== "answered") return fail("row_not_answered", `the call row reads ${row.outcome ?? "nothing"}`);
    const metered = await poll(ctx, async () => {
      const seconds = await ctx.app.meteredSeconds({ tenant: "QA-W", callSessionId: row.call_session_id });
      return seconds > 0 ? seconds : undefined;
    }, 60_000, 5_000);
    ctx.evidence.billing = { row_seconds: row.forward_seconds, metered_seconds: metered };
    if (metered !== row.forward_seconds) {
      return fail("billed_seconds_mismatch", `the row billed ${row.forward_seconds} s and the meter ${metered ?? 0} s`);
    }
    return pass();
  },
};

/** S04: nobody answers; voicemail, transcript, intake, webhook and text-back. */
export const S04: ScenarioRunner = {
  id: "S04",
  async run(ctx) {
    const since = ctx.now();
    // Open, so the owner's page is a surface that rings and is left unanswered.
    await ctx.browser.open("qa-w-owner", "qa-w-owner", "/");
    const dialed = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-1",
      to: "DEV-W1",
      play: null,
      record: false,
      voicemail: { phrase: VOICEMAIL_PHRASE, beep_timeout_ms: 45_000 },
      hangup_after_ms: 50_000,
      ring_timeout_secs: 60,
    });
    if (dialed.state === "failed") return infra("robot", dialed.errors.join("; "));
    const record = await ctx.robot.wait(dialed.plan_id, 180_000);
    ctx.evidence.call = { ...callEvidence(record), amd: record.amd, spoke: Boolean(record.spoke) };
    if (!record.answered_at) return fail("voicemail_not_answered", "voicemail never picked up");
    if (!record.spoke) return fail("no_beep", "the robot never reached the point of speaking");
    // The text-back clock starts at hang-up, so it is watched while the slower checks run.
    const textBackCheck = textBack(ctx, ctx.now()).catch((error: unknown) =>
      infra("robot", `reading the robot's inbox failed: ${(error as Error).message}`),
    );
    const voicemail = await voicemailChecks(ctx, since);
    return voicemail ?? (await textBackCheck) ?? pass();
  },
};

async function voicemailChecks(ctx: ScenarioContext, since: number): Promise<ScenarioResult | undefined> {
  const row = await poll(ctx, async () => {
    const rows = await ctx.app.calls({ tenant: "QA-W", callerRole: "ROBOT-1", since });
    return rows.find((r) => r.voicemail_path !== null);
  }, 90_000, 3_000);
  if (!row) return fail("voicemail_not_stored", "no call row with a stored voicemail");
  if (row.outcome !== "voicemail") return fail("row_not_voicemail", `the call row reads ${row.outcome ?? "nothing"}`);

  const held = await poll(ctx, async () => ((await ctx.app.telnyxRecordings(row.call_session_id)) === 0 ? true : undefined), 60_000, 5_000);
  if (!held) return fail("telnyx_copy_kept", "Telnyx still holds the voicemail recording");

  const transcribed = await poll(ctx, async () => {
    const rows = await ctx.app.calls({ tenant: "QA-W", callerRole: "ROBOT-1", since });
    return rows.find((r) => r.call_session_id === row.call_session_id && r.voicemail_transcript);
  }, 120_000, 5_000);
  if (!transcribed?.voicemail_transcript) return fail("no_transcript", "the voicemail was never transcribed");
  const wer = wordErrorRate(VOICEMAIL_PHRASE, transcribed.voicemail_transcript);
  ctx.evidence.word_error_rate = Math.round(wer * 1000) / 1000;
  if (wer > MAX_WORD_ERROR) return fail("transcript_wer", `word error ${wer.toFixed(2)}, over ${MAX_WORD_ERROR}`);
  if (transcribed.voicemail_intake === null || transcribed.voicemail_intake === undefined) {
    const intake = await poll(ctx, async () => {
      const rows = await ctx.app.calls({ tenant: "QA-W", callerRole: "ROBOT-1", since });
      const current = rows.find((r) => r.call_session_id === row.call_session_id);
      return current?.voicemail_intake ?? undefined;
    }, 60_000, 5_000);
    if (!intake) return fail("no_intake", "no intake was written for the voicemail");
  }

  const webhook = await poll(ctx, async () => {
    const deliveries = await ctx.robot.sink({ since, type: "voicemail.received" });
    return deliveries[0];
  }, 120_000, 3_000);
  if (!webhook) return fail("webhook_missing", "no voicemail.received webhook reached the robot's sink");
  if (!Object.keys(webhook.headers).some((name) => name.includes("signature"))) {
    return fail("webhook_unsigned", "the voicemail.received webhook carried no signature header");
  }
  return undefined;
}

async function textBack(ctx: ScenarioContext, hungUpAt: number): Promise<ScenarioResult | undefined> {
  const reply = await poll(ctx, async () => {
    const inbox = await ctx.robot.inbox({ to_role: "ROBOT-1", since: hungUpAt - 5_000 });
    return inbox.find((m) => m.event === "message.received" && m.from_role === "DEV-W1");
  }, 60_000, 2_000);
  return reply ? undefined : fail("no_text_back", "ROBOT-1 got no text-back within 60 s");
}
