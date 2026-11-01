import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { LeaseActivity } from "@loonext/rig-protocol";
import type { CallPlan } from "@loonext/rig-robot";
import { FICTIONAL_E164, GUARD_PROBES, type ApiAnswer, type CallRow, type GuardProbe, type WebhookDelivery } from "./context.ts";
import { fakeContext } from "./fakes.ts";
import {
  appRefusedForUnowned,
  CARRIER_WARN_SEGMENTS,
  downStatesFor,
  FLAG_CACHE_MS,
  G01,
  GREETING_PHRASE,
  guardCount,
  KILL_SWITCHES,
  noticeWordShare,
  PLAN_VOICE_MINUTES,
  PROBE_RULES,
  S12,
  S13,
  S14,
  S15,
  S16,
  S17,
  S26,
  SEGMENT_CAP_SEED,
  SIGN_OUT_MEMBER,
  UNAVAILABLE_NOTICE,
  voiceCaps,
  type DownState,
} from "./gates.ts";

const iso = (ms: number) => new Date(ms).toISOString();
const DAY_MS = 86_400_000;
const PHONE = /\+1\d{10}/;
/** Transforming apps/api's billing module takes seconds while the whole suite runs at once. */
const IMPORT_TIMEOUT_MS = 30_000;

function callRow(tenant: string, id: string, startedAt: number, extra: Partial<CallRow> = {}): CallRow & { tenant: string } {
  return {
    tenant,
    call_session_id: id,
    outcome: null,
    forward_seconds: 0,
    started_at: iso(startedAt),
    ended_at: null,
    voicemail_path: null,
    voicemail_transcript: null,
    voicemail_intake: null,
    ...extra,
  };
}

function activity(log: Record<string, number>): LeaseActivity {
  return { lease_id: "lease-test", scenario: "S00", expires_at: "", live: true, activity: log };
}

describe("the guard's lease log", () => {
  it("counts one endpoint whatever its outcome, and never the endpoints under it", () => {
    const log = activity({
      "rig-api POST /v2/calls 200": 2,
      "rig-api POST /v2/calls dial.to_not_owned": 1,
      "rig-api POST /v2/calls/:id/actions/reject 200": 4,
      "robot POST /v2/calls 200": 3,
    });
    expect(guardCount(log, "rig-api", "POST /v2/calls")).toBe(3);
    expect(guardCount(log, "robot", "POST /v2/calls")).toBe(3);
    expect(guardCount(log, "rig-api", "POST /v2/messages")).toBe(0);
  });

  it("counts only the app's requests refused for an unowned number, not the robot's probes or forwarded texts", () => {
    expect(
      appRefusedForUnowned(
        activity({
          "robot POST /v2/calls dial.to_not_owned": 1,
          "robot POST /v2/messages message.from_not_owned": 1,
          "rig-api POST /v2/messages 200": 9,
        }),
      ),
    ).toBe(0);
    expect(appRefusedForUnowned(activity({ "rig-api POST /v2/messages message.to_not_owned": 1, "rig-api POST /v2/calls dial.to_not_owned": 2 }))).toBe(3);
  });
});

function g01World() {
  const world = fakeContext("G01");
  world.browser.script.ringsAfterMs = undefined;
  world.robot.outcome = () => ({ state: "done", hangup: { cause: "call_rejected" } });
  return world;
}

describe("G01, isolation self-test", () => {
  it("passes when the app refuses, the stranger is shut out and the guard refuses every probe under its rule", async () => {
    const { ctx, app, robot, guard, time } = g01World();
    // The robot's own probes and other runs' forwarded texts are not the app's refusals.
    guard.log = { "robot POST /v2/calls dial.to_not_owned": 1, "rig-api POST /v2/messages 200": 4 };
    const started = time.now;
    expect(await G01.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(app.fictionalSends).toEqual([{ member: "qa-w-owner", e164: FICTIONAL_E164[0], body: expect.stringContaining(ctx.nonce) }]);
    expect(robot.plans[0]).toMatchObject({ direction: "outbound", role: "STRANGER-1", to: "DEV-W1", lease_id: "lease-test" });
    expect(robot.sent[0]).toMatchObject({ from_role: "STRANGER-1", to_role: "DEV-W1" });
    expect(robot.sent[0]!.text).toContain(ctx.nonce);
    expect(time.now - started).toBeGreaterThanOrEqual(30_000);
    expect(ctx.evidence.guard_probes).toHaveLength(GUARD_PROBES.length);
    expect(JSON.stringify(ctx.evidence)).not.toMatch(PHONE);
  });

  it("calls a text or a dial to a fictional number critical, and a refusal by another gate a plain failure", async () => {
    const sent = g01World();
    sent.app.sendTextToFictional = async () => ({ ok: true, messageId: "m-1" });
    expect(await G01.run(sent.ctx)).toMatchObject({ failure_class: "fictional_text_sent", critical: true });

    const placed = g01World();
    placed.app.placeCall = async () => ({ ok: true as const, sessionId: "s-1" });
    expect(await G01.run(placed.ctx)).toMatchObject({ failure_class: "fictional_dial_placed", critical: true });

    const textOther = g01World();
    textOther.app.sendTextToFictional = async () => ({ ok: false, status: 422, code: "validation_failed" });
    const textResult = await G01.run(textOther.ctx);
    expect(textResult).toMatchObject({ failure_class: "fictional_text_wrong_refusal" });
    expect(textResult).not.toHaveProperty("critical");

    const dialOther = g01World();
    dialOther.app.placeCall = async () => ({ ok: false as const, status: 403, code: "forbidden" });
    expect(await G01.run(dialOther.ctx)).toMatchObject({ failure_class: "fictional_dial_wrong_refusal" });
  });

  it("calls an app request the guard had to refuse critical", async () => {
    for (const key of ["rig-api POST /v2/messages message.to_not_owned", "rig-api POST /v2/calls dial.to_not_owned"]) {
      const world = g01World();
      world.guard.log = { [key]: 1 };
      expect(await G01.run(world.ctx)).toMatchObject({ failure_class: "app_request_reached_guard", critical: true });
    }
  });

  it("calls a stranger's ring, answer, call row or threaded text critical", async () => {
    const rang = g01World();
    rang.browser.script.ringsAfterMs = 2_000;
    expect(await G01.run(rang.ctx)).toMatchObject({ failure_class: "stranger_rang", critical: true });

    const answered = g01World();
    answered.robot.outcome = () => ({ state: "done", answered_at: "2026-10-31T15:00:04.000Z" });
    expect(await G01.run(answered.ctx)).toMatchObject({ failure_class: "stranger_answered", critical: true });

    const recorded = g01World();
    recorded.app.callRows.push(callRow("QA-W", "stranger-1", recorded.time.now));
    expect(await G01.run(recorded.ctx)).toMatchObject({ failure_class: "stranger_call_recorded", critical: true });

    const threaded = g01World();
    threaded.robot.onSms = (message) => threaded.app.thread("QA-W", message.text, "inbound");
    expect(await G01.run(threaded.ctx)).toMatchObject({ failure_class: "stranger_text_threaded", critical: true });
  });

  it("calls any probe the guard let through critical, and a refusal under another rule or status a plain failure", async () => {
    for (const kind of GUARD_PROBES) {
      const through = g01World();
      through.guard.probes[kind] = { status: 200, refused_by_guard: false, rule: null };
      expect(await G01.run(through.ctx)).toMatchObject({ failure_class: "guard_probe_not_refused", critical: true });

      // A 403 that Telnyx gave, not the guard, means the guard forwarded the request.
      const telnyx = g01World();
      telnyx.guard.probes[kind] = { status: 403, refused_by_guard: false, rule: null };
      expect(await G01.run(telnyx.ctx)).toMatchObject({ failure_class: "guard_probe_not_refused", critical: true });
    }
    const status = g01World();
    status.guard.probes["dial-to-unowned"] = { status: 401, refused_by_guard: true, rule: PROBE_RULES["dial-to-unowned"] };
    expect(await G01.run(status.ctx)).toMatchObject({ failure_class: "guard_probe_status" });

    // Refused for a missing lease, the probe never reached the rule it is there to prove.
    const rule = g01World();
    rule.guard.probes["foreign-connection"] = { status: 403, refused_by_guard: true, rule: "dial.lease_missing" };
    const ruleResult = await G01.run(rule.ctx);
    expect(ruleResult).toMatchObject({ failure_class: "guard_probe_wrong_rule" });
    expect(ruleResult).not.toHaveProperty("critical");
  });

  it("runs every check, so a critical failure outranks a plain one found first", async () => {
    const world = g01World();
    world.app.sendTextToFictional = async () => ({ ok: false, status: 422, code: "validation_failed" });
    world.guard.probes["text-from-outside"] = { status: 200, refused_by_guard: false, rule: null };
    expect(await G01.run(world.ctx)).toMatchObject({ failure_class: "guard_probe_not_refused", critical: true });
  });

  it("blames the robot or the guard when either cannot be reached", async () => {
    const robot = g01World();
    robot.robot.dial = async (plan: CallPlan) => ({ plan_id: "plan-0", plan, state: "failed", ids: {}, events: [], dtmf: "", errors: ["robot: Telnyx is unreachable"] });
    expect(await G01.run(robot.ctx)).toMatchObject({ outcome: "infra", component: "robot" });

    const guard = g01World();
    guard.guard.probe = async () => {
      throw new Error("guard: /telnyx answered 502");
    };
    expect(await G01.run(guard.ctx)).toMatchObject({ outcome: "infra", component: "guard" });
  });
});

function s12World(options: { counts?: boolean; seconds?: number } = {}) {
  const world = fakeContext("S12");
  const { app, robot } = world;
  const state = { plan: "pro" as const, overage_cap_multiplier: 3, forward_seconds: options.seconds ?? 1_200, forwarded_calls: 40 };
  const caps = voiceCaps("pro", 3);
  const seeded: { marker: string; tenant: string; leg: string; rows: number; billableSeconds: number }[] = [];
  const atPlaceCall: { forward_seconds: number; forwarded_calls: number; member: string; fromRole: string; to: string }[] = [];
  Object.assign(app, {
    voiceCapState: async () => ({ ...state }),
    seedCallRecords: async (args: { tenant: string; leg: "out_customer" | "in_browser"; rows: number; billableSeconds: number }) => {
      const marker = `rig-seed-calls-${seeded.length + 1}`;
      seeded.push({ marker, ...args });
      if (options.counts !== false) {
        if (args.leg === "out_customer") state.forwarded_calls += args.rows;
        state.forward_seconds += args.rows * args.billableSeconds;
      }
      return { marker };
    },
  });
  app.onPlaceCall = (args) => {
    atPlaceCall.push({ ...args, forward_seconds: state.forward_seconds, forwarded_calls: state.forwarded_calls });
    return state.forward_seconds >= caps.capSeconds || state.forwarded_calls >= caps.stopAt
      ? { ok: false, status: 402, code: "usage_cap_reached" }
      : { ok: true, sessionId: "s-1" };
  };
  robot.outcome = () => ({ state: "done", hangup: { cause: "user_busy", sip_cause: "486" } });
  const dial = robot.dial.bind(robot);
  robot.dial = async (plan: CallPlan) => {
    robot.deliver({ from_role: "DEV-C1", to_role: "ROBOT-1", text: "Sorry we missed your call" });
    return dial(plan);
  };
  return { ...world, state, caps, seeded, atPlaceCall };
}

describe("S12, voice and dial-count caps", () => {
  it("computes the caps apps/api enforces, from production's own dialCeilings and voice minutes", async () => {
    const plans = (await importFromRepo("apps/api/src/billing/plans.ts")) as {
      dialCeilings: (plan: string, multiplier: number | string | null) => { stopAt: number };
      PLAN_VOICE_MINUTES: Record<string, number>;
    };
    expect(PLAN_VOICE_MINUTES).toEqual(plans.PLAN_VOICE_MINUTES);
    for (const plan of ["starter", "pro"] as const) {
      for (const multiplier of [null, 0.5, 1, 3, 10, 12]) {
        const caps = voiceCaps(plan, multiplier);
        expect(caps.stopAt).toBe(plans.dialCeilings(plan, multiplier).stopAt);
        expect(caps.capSeconds).toBe(plans.PLAN_VOICE_MINUTES[plan]! * 60 * (multiplier && multiplier > 0 ? Math.min(multiplier, 10) : 10));
      }
    }
    // companyOverVoiceCap is not exported apart from its database read, so its arithmetic is held to the text.
    const webhook = readFileSync(repoPath("apps/api/src/messaging/voice-webhook.ts"), "utf8");
    expect(webhook).toMatch(/const MAX_CAP_MULTIPLIER = 10;/);
    expect(webhook).toMatch(/PLAN_VOICE_MINUTES\[company\.plan\] \* 60 \* capMultiplier/);
  }, IMPORT_TIMEOUT_MS);

  it("reaches the dial ceiling alone, then the minute cap, and passes on 402, busy, a text-back and no dial", async () => {
    const { ctx, seeded, undo, atPlaceCall, caps, robot } = s12World();
    expect(await S12.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(caps).toEqual({ capSeconds: 6_000 * 3 * 60, stopAt: 10_800 });
    expect(seeded).toEqual([
      { marker: "rig-seed-calls-1", tenant: "QA-C", leg: "out_customer", rows: 10_800 - 40, billableSeconds: 0 },
      { marker: "rig-seed-calls-2", tenant: "QA-C", leg: "in_browser", rows: 1, billableSeconds: caps.capSeconds - 1_200 },
    ]);
    expect(undo).toEqual(seeded.map((s) => ({ kind: "app.clear-seeded-usage", params: { marker: s.marker } })));
    // Under the minute cap when the call was refused, so the 402 can only be the dial ceiling's.
    expect(atPlaceCall).toEqual([{ member: "qa-c-owner", fromRole: "DEV-C1", to: "ROBOT-1", forward_seconds: 1_200, forwarded_calls: 10_800 }]);
    expect(robot.plans[0]).toMatchObject({ direction: "outbound", role: "ROBOT-1", to: "DEV-C1", lease_id: "lease-test" });
    expect(JSON.stringify(ctx.evidence)).not.toMatch(PHONE);
  });

  it("names a call placed at the ceiling, and one refused by something else", async () => {
    const placed = s12World();
    placed.app.onPlaceCall = () => ({ ok: true, sessionId: "s-1" });
    expect(await S12.run(placed.ctx)).toMatchObject({ failure_class: "dial_ceiling_not_enforced" });
    expect(placed.robot.plans).toEqual([]);

    const other = s12World();
    other.app.onPlaceCall = () => ({ ok: false, status: 403, code: "forbidden" });
    expect(await S12.run(other.ctx)).toMatchObject({ failure_class: "dial_ceiling_wrong_refusal" });

    // The same status from another gate is not the ceiling's refusal.
    const paused = s12World();
    paused.app.onPlaceCall = () => ({ ok: false, status: 402, code: "workspace_paused" });
    expect(await S12.run(paused.ctx)).toMatchObject({ failure_class: "dial_ceiling_wrong_refusal" });
  });

  it("fails an inbound call over the minute cap that is answered or not turned away busy", async () => {
    const answered = s12World();
    answered.robot.outcome = () => ({ state: "done", answered_at: "2026-10-31T15:00:04.000Z", hangup: { cause: "normal_clearing" } });
    expect(await S12.run(answered.ctx)).toMatchObject({ failure_class: "inbound_answered_over_cap" });

    const rang = s12World();
    rang.robot.outcome = () => ({ state: "done", hangup: { cause: "timeout" } });
    expect(await S12.run(rang.ctx)).toMatchObject({ failure_class: "inbound_not_busy" });
  });

  it("fails a busy call that never texts the caller back", async () => {
    const world = s12World();
    world.robot.deliver = () => undefined;
    expect(await S12.run(world.ctx)).toMatchObject({ failure_class: "no_text_back" });
  });

  it("fails a dial that reached the guard, but not the inbound call's own reject", async () => {
    const dialed = s12World();
    const dial = dialed.robot.dial;
    dialed.robot.dial = async (plan: CallPlan) => {
      dialed.guard.log["rig-api POST /v2/calls 200"] = 1;
      return dial(plan);
    };
    expect(await S12.run(dialed.ctx)).toMatchObject({ failure_class: "dial_reached_guard" });

    const rejected = s12World();
    const reject = rejected.robot.dial;
    rejected.robot.dial = async (plan: CallPlan) => {
      rejected.guard.log["rig-api POST /v2/calls/:id/actions/reject 200"] = 1;
      return reject(plan);
    };
    expect((await S12.run(rejected.ctx)).outcome).toBe("pass");
  });

  it("blames the probe when its seeds do not count, before anything is dialed", async () => {
    const uncounted = s12World({ counts: false });
    expect(await S12.run(uncounted.ctx)).toMatchObject({ outcome: "infra", component: "app-probe" });
    expect(uncounted.atPlaceCall).toEqual([]);
    expect(uncounted.undo).toHaveLength(1);
  });

  it("cannot tell the two gates apart when QA-C starts over its minute cap", async () => {
    const over = s12World({ seconds: voiceCaps("pro", 3).capSeconds });
    expect(await S12.run(over.ctx)).toMatchObject({ outcome: "infra", component: "app" });
    expect(over.seeded).toEqual([]);
  });

  it("blames the robot when it cannot dial", async () => {
    const world = s12World();
    world.robot.dial = async (plan: CallPlan) => ({ plan_id: "plan-0", plan, state: "failed", ids: {}, events: [], dtmf: "", errors: ["guard_refused:dial.window"] });
    expect(await S12.run(world.ctx)).toMatchObject({ outcome: "infra", component: "guard" });
  });
});

const NOTICE_HEARD = "Sorry, this number is not taking calls right now. Please try again later.";
const BASE = Date.UTC(2026, 9, 31, 15, 5);

/** A time whose fortnight takes these states, in this order; the rotation repeats every three fortnights. */
function fortnightWith(first: DownState, second?: DownState): number {
  for (let k = 0; k < 3; k++) {
    const at = BASE + k * 14 * DAY_MS;
    const [a, b] = downStatesFor(at);
    if (a === first && (second === undefined || b === second)) return at;
  }
  throw new Error(`no fortnight in the rotation starts ${first}${second ? `, ${second}` : ""}`);
}

function s13World(at: number) {
  const world = fakeContext("S13");
  const { app, robot, time } = world;
  time.now = at;
  world.browser.script.ringsAfterMs = undefined;
  const changes: { at: number; status: string }[] = [];
  const setNumberStatus = app.setNumberStatus.bind(app);
  app.setNumberStatus = async (args) => {
    changes.push({ at: time.now, status: args.status });
    return setNumberStatus(args);
  };
  const down = (): DownState | "up" => {
    if (app.companies.get("QA-C")?.paused_at) return "paused";
    const status = app.numberStatus.get("QA-C/DEV-C1");
    return status === "suspended" || status === "released" ? status : "up";
  };
  const script = { noticeSpoken: true, answered: true, transcript: NOTICE_HEARD as string | undefined, dropMs: 1_500, errors: [] as string[] };
  robot.outcome = () => {
    const state = down();
    if (state === "released") return { state: "done", dialed_at: iso(time.now), ended_at: iso(time.now + script.dropMs), hangup: { cause: "call_rejected" } };
    const id = `down-${app.callRows.length}`;
    app.callRows.push(callRow("QA-C", id, time.now, { notice_spoken: script.noticeSpoken }));
    return {
      state: "done",
      dialed_at: iso(time.now),
      answered_at: script.answered ? iso(time.now + 1_000) : undefined,
      ended_at: iso(time.now + 8_000),
      transcript: script.answered ? script.transcript : undefined,
      errors: script.errors,
    };
  };
  const restored = () => down() === "up";
  return { ...world, changes, script, restored };
}

describe("S13, a line that is down", () => {
  it("rotates two of the three states, so three runs take each state twice", () => {
    const seen = [0, 1, 2].flatMap((k) => downStatesFor(BASE + k * 14 * DAY_MS));
    for (const state of ["paused", "suspended", "released"]) expect(seen.filter((s) => s === state)).toHaveLength(2);
    expect(new Set(downStatesFor(BASE))).toHaveProperty("size", 2);
  });

  it("speaks the English notice apps/api speaks, and accepts a transcript that splits a word", () => {
    const source = readFileSync(repoPath("apps/api/src/calls/transitions.ts"), "utf8");
    expect(/export const UNAVAILABLE_NOTICE =\s*"([^"]+)";/.exec(source)?.[1]).toBe(UNAVAILABLE_NOTICE);
    expect(noticeWordShare(UNAVAILABLE_NOTICE)).toBe(1);
    expect(noticeWordShare(NOTICE_HEARD)).toBeGreaterThanOrEqual(0.75);
    expect(noticeWordShare("Thanks for calling, please leave a message")).toBeLessThan(0.75);
  });

  it("passes every rotation, and puts each state back before the next", async () => {
    for (const k of [0, 1, 2]) {
      const at = BASE + k * 14 * DAY_MS;
      const world = s13World(at);
      expect(await S13.run(world.ctx)).toEqual({ outcome: "pass", detail: undefined });
      const states = downStatesFor(at);
      expect(world.ctx.evidence.states).toEqual(states);
      expect(world.restored()).toBe(true);
      expect(world.robot.plans.map((p) => ({ role: p.role, to: p.to, lease_id: p.lease_id, transcribe: p.transcribe }))).toEqual(
        states.map((s) => ({ role: "ROBOT-1", to: "DEV-C1", lease_id: "lease-test", transcribe: s !== "released" })),
      );
      expect(world.undo.map((u) => u.kind)).toEqual(states.map((s) => (s === "paused" ? "app.company-restore" : "app.number-status")));
      for (const action of world.undo) {
        expect(action.params).toEqual(action.kind === "app.company-restore" ? { tenant: "QA-C", values: { paused_at: null } } : { tenant: "QA-C", role: "DEV-C1", status: "active" });
      }
      expect(JSON.stringify(world.ctx.evidence)).not.toMatch(PHONE);
    }
  });

  it("never holds a number row down across a quarter hour", async () => {
    // 15:13:30, too close to 15:15 to hold the row down through a call.
    const late = s13World(fortnightWith("suspended") + 8 * 60_000 + 30_000);
    expect(new Date(late.time.now).getUTCMinutes()).toBe(13);
    expect((await S13.run(late.ctx)).outcome).toBe("pass");
    const downAt = late.changes[0]!.at % (15 * 60_000);
    expect(downAt).toBeGreaterThanOrEqual(90_000);
    expect(15 * 60_000 - downAt).toBeGreaterThanOrEqual(150_000);

    // 15:00:20, while the reconcile may still be reading.
    const early = s13World(fortnightWith("released") - 5 * 60_000 + 20_000);
    expect((await S13.run(early.ctx)).outcome).toBe("pass");
    expect(early.changes[0]!.at % (15 * 60_000)).toBeGreaterThanOrEqual(90_000);
  });

  it("fails a ring or a ring leg on a line that is down, and still puts the line back", async () => {
    const rang = s13World(BASE);
    rang.browser.script.ringsAfterMs = 1_500;
    expect(await S13.run(rang.ctx)).toMatchObject({ failure_class: "rang_while_down" });
    expect(rang.restored()).toBe(true);

    const legs = s13World(fortnightWith("paused"));
    const outcome = legs.robot.outcome;
    legs.robot.outcome = (plan) => {
      const record = outcome(plan);
      for (const row of legs.app.callRows) legs.app.legs.set(`QA-C/${row.call_session_id}`, [{ member: "qa-c-owner", state: "ringing", kind: "browser" }]);
      return record;
    };
    expect(await S13.run(legs.ctx)).toMatchObject({ failure_class: "rang_while_down" });
    expect(legs.restored()).toBe(true);
  });

  it("fails a notice nobody heard, and an unanswered call while notices were still allowed", async () => {
    const garbled = s13World(fortnightWith("paused"));
    garbled.script.transcript = "thank you for calling";
    expect(await S13.run(garbled.ctx)).toMatchObject({ failure_class: "notice_not_heard" });

    const unspoken = s13World(fortnightWith("suspended"));
    unspoken.script.answered = false;
    expect(await S13.run(unspoken.ctx)).toMatchObject({ failure_class: "notice_missing" });

    const rowless = s13World(fortnightWith("paused"));
    rowless.script.answered = false;
    rowless.robot.outcome = () => ({ state: "done", dialed_at: iso(rowless.time.now), ended_at: iso(rowless.time.now + 30_000) });
    expect(await S13.run(rowless.ctx)).toMatchObject({ failure_class: "notice_missing" });
  });

  it("passes a ring-out once the day's notices are spent, as the row records", async () => {
    const spent = s13World(fortnightWith("paused", "suspended"));
    spent.script.answered = false;
    spent.script.noticeSpoken = false;
    expect((await S13.run(spent.ctx)).outcome).toBe("pass");
  });

  it("blames the robot when it has no transcriber", async () => {
    const world = s13World(fortnightWith("paused"));
    world.script.transcript = undefined;
    world.script.errors = ["transcribe: the robot has no transcriber"];
    expect(await S13.run(world.ctx)).toMatchObject({ outcome: "infra", component: "robot", detail: "transcribe: the robot has no transcriber" });
  });

  it("fails a released number that answers or is not dropped within 5 s", async () => {
    const slow = s13World(fortnightWith("released"));
    slow.script.dropMs = 8_000;
    expect(await S13.run(slow.ctx)).toMatchObject({ failure_class: "released_not_dropped" });
    expect(slow.restored()).toBe(true);

    const answered = s13World(fortnightWith("released"));
    answered.robot.outcome = () => ({ state: "done", dialed_at: iso(answered.time.now), answered_at: iso(answered.time.now + 1_000), ended_at: iso(answered.time.now + 3_000) });
    expect(await S13.run(answered.ctx)).toMatchObject({ failure_class: "released_answered" });
  });
});

function s14World() {
  const world = fakeContext("S14");
  const { app, robot, time, undo } = world;
  const killed = (key: string) => app.flags.get(key) === false;
  const flips: { key: string; enabled: boolean | null; at: number; undos: number }[] = [];
  /** Flips and the requests each switch is judged by, in the order they happened. */
  const timeline: { key: string; flip?: boolean | null; at: number }[] = [];
  const setFlag = app.setFlag.bind(app);
  app.setFlag = async (key: string, enabled: boolean | null) => {
    flips.push({ key, enabled, at: time.now, undos: undo.length });
    timeline.push({ key, flip: enabled, at: time.now });
    return setFlag(key, enabled);
  };
  app.onPlaceCall = () => {
    timeline.push({ key: "kill:calls", at: time.now });
    return killed("kill:calls") ? { ok: false, status: 503, code: "service_unavailable" } : { ok: true, sessionId: "s-2" };
  };
  app.onSend = (_send, id) => {
    timeline.push({ key: "kill:outbound-send", at: time.now });
    return killed("kill:outbound-send") ? { ok: false, status: 503, code: "service_unavailable" } : { ok: true, messageId: id };
  };
  const unavailable = { suggestions: [], reason: "unavailable" };
  const ai = { drafts: () => !killed("kill:ai") };
  app.replySuggestions = async () => {
    timeline.push({ key: "kill:ai", at: time.now });
    return (ai.drafts() ? { status: 200, body: { suggestions: ["Rig draft"] } } : { status: 200, body: unavailable }) as ApiAnswer<{ suggestions?: unknown[] }>;
  };
  robot.onSms = (message) => app.thread("QA-W", message.text, "inbound");
  return { ...world, flips, timeline, ai };
}

describe("S14, kill switches", () => {
  it("waits out the same flag cache apps/api keeps", () => {
    const source = readFileSync(repoPath("apps/api/src/flags/evaluate.ts"), "utf8");
    expect(Number(/const TTL_MS = ([\d_]+);/.exec(source)?.[1]?.replace(/_/g, ""))).toBe(FLAG_CACHE_MS);
  });

  it("passes when each switch stops its work, the live call carries on and every flag goes back", async () => {
    const { ctx, app, robot, undo, flips, browser } = s14World();
    expect(await S14.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(undo).toEqual(KILL_SWITCHES.map((key) => ({ kind: "app.flag", params: { key, enabled: null } })));
    expect(flips[0]!.undos).toBe(KILL_SWITCHES.length);
    expect(flips.map((f) => `${f.key}=${f.enabled}`)).toEqual([
      "kill:calls=false",
      "kill:calls=null",
      "kill:outbound-send=false",
      "kill:outbound-send=null",
      "kill:ai=false",
      "kill:ai=null",
    ]);
    expect([...app.flags]).toEqual([]);
    expect(await S14.afterRelease!(ctx)).toBeUndefined();
    expect(robot.plans[0]).toMatchObject({ direction: "outbound", role: "ROBOT-1", to: "DEV-W1", expect: "qa-w-owner", lease_id: "lease-test" });
    expect(robot.plans[0]!.segments!.map((s) => s.name)).toEqual(["before", "after"]);
    expect(browser.actions).toContain("qa-w-owner answer");
    expect(app.sends[0]!.body).toContain(ctx.nonce);
    expect(robot.sent[0]!.text).toContain(ctx.nonce);
  });

  it("judges each switch only once the cache has run out, and its call's 'after' window only after that", async () => {
    const { ctx, timeline, robot } = s14World();
    expect((await S14.run(ctx)).outcome).toBe("pass");
    for (const key of KILL_SWITCHES) {
      const killedAt = timeline.findIndex((t) => t.key === key && t.flip === false);
      const judged = timeline.slice(killedAt + 1).find((t) => t.key === key && !("flip" in t));
      expect(judged).toBeDefined();
      expect(judged!.at - timeline[killedAt]!.at).toBeGreaterThanOrEqual(FLAG_CACHE_MS);
    }
    const [before, after] = robot.plans[0]!.segments!;
    expect(before!.end_ms).toBeLessThanOrEqual(10_000);
    expect(after!.start_ms).toBeGreaterThanOrEqual(10_000 + FLAG_CACHE_MS);
  });

  it("names a call authorised with kill:calls killed, a refusal that is not 503, and a dial that reached the guard", async () => {
    const placed = s14World();
    placed.app.onPlaceCall = () => ({ ok: true, sessionId: "s-2" });
    expect(await S14.run(placed.ctx)).toMatchObject({ failure_class: "kill_calls_not_enforced" });
    expect(placed.app.flags.get("kill:calls")).not.toBe(false);

    const busy = s14World();
    busy.app.onPlaceCall = () => ({ ok: false, status: 409, code: "conflict" });
    expect(await S14.run(busy.ctx)).toMatchObject({ failure_class: "kill_calls_wrong_refusal" });

    const leaked = s14World();
    const onPlaceCall = leaked.app.onPlaceCall;
    leaked.app.onPlaceCall = (args) => {
      leaked.guard.log["rig-api POST /v2/calls 200"] = 1;
      return onPlaceCall(args);
    };
    expect(await S14.run(leaked.ctx)).toMatchObject({ failure_class: "dial_reached_guard" });
  });

  it("fails a live call the switch cut off, or one that never rang", async () => {
    const cut = s14World();
    const outcome = cut.robot.outcome;
    cut.robot.outcome = (plan) => {
      const record = outcome(plan);
      return {
        ...record,
        judgement: { ...record.judgement!, segments: [{ name: "before", verdict: "heard", heard: ["qa-w-owner"] }, { name: "after", verdict: "silent", heard: [] }] },
      };
    };
    expect(await S14.run(cut.ctx)).toMatchObject({ failure_class: "live_call_cut_by_kill" });

    const silent = s14World();
    silent.browser.script.ringsAfterMs = undefined;
    expect(await S14.run(silent.ctx)).toMatchObject({ failure_class: "live_call_not_started" });
  });

  it("names a text that went out with kill:outbound-send killed, a refusal that is not 503, and a send that reached the guard", async () => {
    const sent = s14World();
    sent.app.onSend = (_send, id) => ({ ok: true, messageId: id });
    expect(await S14.run(sent.ctx)).toMatchObject({ failure_class: "kill_send_not_enforced" });
    expect(sent.app.flags.get("kill:outbound-send")).not.toBe(false);

    const arrived = s14World();
    const refuse = arrived.app.onSend;
    arrived.app.onSend = (send, id) => {
      arrived.robot.deliver({ from_role: "DEV-W1", to_role: "ROBOT-1", text: send.body });
      return refuse(send, id);
    };
    expect(await S14.run(arrived.ctx)).toMatchObject({ failure_class: "kill_send_not_enforced" });

    const capped = s14World();
    capped.app.onSend = () => ({ ok: false, status: 402, code: "usage_cap_reached" });
    expect(await S14.run(capped.ctx)).toMatchObject({ failure_class: "kill_send_wrong_refusal" });

    const leaked = s14World();
    const onSend = leaked.app.onSend;
    leaked.app.onSend = (send, id) => {
      leaked.guard.log["rig-api POST /v2/messages 200"] = 1;
      return onSend(send, id);
    };
    expect(await S14.run(leaked.ctx)).toMatchObject({ failure_class: "send_reached_guard" });
  });

  it("fails Lou drafting with kill:ai killed, and blames the AI when it drafted nothing to begin with", async () => {
    const drafting = s14World();
    drafting.ai.drafts = () => true;
    expect(await S14.run(drafting.ctx)).toMatchObject({ failure_class: "kill_ai_not_enforced" });
    expect(drafting.app.flags.get("kill:ai")).not.toBe(false);

    const idle = s14World();
    idle.ai.drafts = () => false;
    expect(await S14.run(idle.ctx)).toMatchObject({ outcome: "infra", component: "ai" });
    expect(idle.flips.some((f) => f.key === "kill:ai")).toBe(false);

    const unthreaded = s14World();
    unthreaded.robot.onSms = () => undefined;
    expect(await S14.run(unthreaded.ctx)).toMatchObject({ failure_class: "ask_not_threaded" });
  });

  it("changes nothing when a switch is already killed, and calls a switch left killed a failure afterwards", async () => {
    const world = s14World();
    world.app.flags.set("kill:ai", false);
    expect(await S14.run(world.ctx)).toMatchObject({ outcome: "infra", component: "app" });
    expect(world.flips).toEqual([]);
    expect(await S14.afterRelease!(world.ctx)).toMatchObject({ failure_class: "flag_left_killed" });

    const left = s14World();
    left.app.flags.set("kill:calls", false);
    left.app.flags.set("kill:outbound-send", true);
    expect(await S14.afterRelease!(left.ctx)).toMatchObject({ failure_class: "flag_left_killed", detail: "kill:calls still killed after cleanup" });
  });
});

const GREETING_PATH = "voicemail-greetings/company-w/greeting-1.mp3";

function s15World() {
  const world = fakeContext("S15");
  const { app, robot, rig, time } = world;
  robot.outcome = (plan) => ({
    state: "done",
    answered_at: iso(time.now + 2_000),
    transcript: "This is a greeting recording call for QA-W. After the beep, say what you'd like your callers to hear.",
    spoke: plan.voicemail?.phrase,
    recording_deleted: true,
  });
  const names: string[] = [];
  Object.assign(app, {
    startGreetingCapture: async (args: { member: string; toRole: string; name: string }) => {
      names.push(`${args.member} ${args.toRole} ${args.name}`);
      return app.greetingCapture;
    },
  });
  app.greetingRows.push({ tenant: "QA-W", id: "greeting-1", created_at: iso(time.now), storage_path: GREETING_PATH, mime_type: "audio/mpeg", duration_ms: 6_000 });
  app.objects.set(GREETING_PATH, new Uint8Array([1, 2, 3]));
  rig.transcript = GREETING_PHRASE.toLowerCase();
  return { ...world, names };
}

describe("S15, greeting-capture call", () => {
  it("reads the audio from the greeting bucket apps/api writes it to, at the path the row names", () => {
    const source = readFileSync(repoPath("apps/api/src/calls/greeting-capture-leg.ts"), "utf8");
    expect(source).toMatch(/export const GREETING_BUCKET = "voicemail-greetings";/);
    expect(source).toContain("storage_path: `${GREETING_BUCKET}/${objectPath}`");
  });

  it("passes when the robot hears the prompt, speaks after the beep and the greeting says what it said", async () => {
    const { ctx, robot, names } = s15World();
    expect(await S15.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(robot.plans[0]).toMatchObject({
      direction: "inbound",
      role: "ROBOT-2",
      transcribe: true,
      lease_id: "lease-test",
      voicemail: { phrase: GREETING_PHRASE },
    });
    expect(robot.plans[0]!.voicemail!.beep_timeout_ms).toBeGreaterThan(10_000);
    expect(names).toEqual([`qa-w-owner ROBOT-2 Rig S15 ${ctx.nonce}`]);
    expect(ctx.evidence.word_error_rate).toBe(0);
    expect(ctx.evidence.greeting).toEqual({ id: "greeting-1", duration_ms: 6_000, mime_type: "audio/mpeg" });
  });

  it("fails a refused capture, a call that never came, a silent prompt and a robot that never spoke", async () => {
    const refused = s15World();
    refused.app.greetingCapture = { status: 422, code: "validation_failed" };
    expect(await S15.run(refused.ctx)).toMatchObject({ failure_class: "capture_refused" });

    const never = s15World();
    never.robot.outcome = () => ({ state: "failed", errors: ["no call arrived"] });
    expect(await S15.run(never.ctx)).toMatchObject({ failure_class: "capture_call_never_came" });

    const silent = s15World();
    const outcome = silent.robot.outcome;
    silent.robot.outcome = (plan) => ({ ...outcome(plan), transcript: "  " });
    expect(await S15.run(silent.ctx)).toMatchObject({ failure_class: "prompt_not_heard" });

    const mute = s15World();
    const spoke = mute.robot.outcome;
    mute.robot.outcome = (plan) => ({ ...spoke(plan), spoke: undefined });
    expect(await S15.run(mute.ctx)).toMatchObject({ failure_class: "did_not_speak" });
  });

  it("fails a greeting that was never saved, that cannot be read, or that says something else", async () => {
    const unsaved = s15World();
    unsaved.app.greetingRows = [];
    expect(await S15.run(unsaved.ctx)).toMatchObject({ failure_class: "greeting_not_saved" });

    // An older greeting is somebody else's.
    const old = s15World();
    old.app.greetingRows[0]!.created_at = iso(old.time.now - 60_000);
    expect(await S15.run(old.ctx)).toMatchObject({ failure_class: "greeting_not_saved" });

    const missing = s15World();
    missing.app.objects.clear();
    expect(await S15.run(missing.ctx)).toMatchObject({ failure_class: "greeting_audio_unreadable" });

    const garbled = s15World();
    garbled.rig.transcript = "you have reached the rig please call back";
    expect(await S15.run(garbled.ctx)).toMatchObject({ failure_class: "greeting_wer" });
  });

  it("blames the robot or the rig when either cannot transcribe", async () => {
    const robot = s15World();
    const outcome = robot.robot.outcome;
    robot.robot.outcome = (plan) => ({ ...outcome(plan), transcript: undefined, errors: ["transcribe: the robot has no transcriber"] });
    expect(await S15.run(robot.ctx)).toMatchObject({ outcome: "infra", component: "robot" });

    const rig = s15World();
    rig.rig.transcribe = async () => {
      throw new Error("whisper.cpp is not installed");
    };
    expect(await S15.run(rig.ctx)).toMatchObject({ outcome: "infra", component: "transcriber" });
  });
});

function s16World() {
  const world = fakeContext("S16");
  const { app, time } = world;
  Object.assign(app, { userIdOf: async (member: string) => `user-${member}` });
  app.callRows.push(callRow("QA-W", "ring-1", time.now));
  app.legs.set("QA-W/ring-1", [{ member: "qa-w-owner", state: "cancelled", kind: "browser" }]);
  const push = (userId: string) =>
    app.pushes.push({ tenant: "QA-W", purpose: "ring", platform: "web", response_class: "accepted", attempted_at: iso(time.now), user_id: userId } as (typeof app.pushes)[number]);
  push("user-qa-w-owner");
  app.onPlaceCall = (args) => (args.member === "qa-w-note-member" ? { ok: false, status: 403, code: "forbidden" } : { ok: true, sessionId: "s-1" });
  return { ...world, push };
}

describe("S16, note-level member and sign-out", () => {
  it("passes when only the owner rings, the note member cannot dial, and sign-out takes the voice token away until a fresh sign-in", async () => {
    const { ctx, app, robot, undo } = s16World();
    expect(await S16.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(undo).toEqual([{ kind: "app.ring-audience", params: { tenant: "QA-W", role: "DEV-W1", member: "qa-w-note-member", level: null } }]);
    expect(app.audiences.get("QA-W/DEV-W1/qa-w-note-member")).toBe("note");
    expect(robot.plans[0]).toMatchObject({ direction: "outbound", role: "ROBOT-1", to: "DEV-W1", lease_id: "lease-test" });
    expect(app.signedOut.has(SIGN_OUT_MEMBER)).toBe(true);
    expect(ctx.evidence.tokens).toEqual({ before: 200, signed_out: 200, after: 403 });
    expect(await S16.afterRelease!(ctx)).toBeUndefined();
    expect(app.signedOut.has(SIGN_OUT_MEMBER)).toBe(false);
  });

  it("fails a ring leg or a push for the note member, and a call where even the owner did not ring", async () => {
    const leg = s16World();
    leg.app.legs.set("QA-W/ring-1", [
      { member: "qa-w-owner", state: "cancelled", kind: "browser" },
      { member: "qa-w-note-member", state: "cancelled", kind: "browser" },
    ]);
    expect(await S16.run(leg.ctx)).toMatchObject({ failure_class: "note_member_rang" });

    const pushed = s16World();
    pushed.push("user-qa-w-note-member");
    expect(await S16.run(pushed.ctx)).toMatchObject({ failure_class: "note_member_pushed" });

    const unrung = s16World();
    unrung.browser.script.ringsAfterMs = undefined;
    expect(await S16.run(unrung.ctx)).toMatchObject({ failure_class: "owner_not_rung" });

    const legless = s16World();
    legless.app.legs.clear();
    expect(await S16.run(legless.ctx)).toMatchObject({ failure_class: "owner_not_rung" });

    const rowless = s16World();
    rowless.app.callRows = [];
    expect(await S16.run(rowless.ctx)).toMatchObject({ failure_class: "no_call_row" });
  });

  it("fails a note member's call that was authorised, or refused with anything but 403", async () => {
    const placed = s16World();
    placed.app.onPlaceCall = () => ({ ok: true, sessionId: "s-1" });
    expect(await S16.run(placed.ctx)).toMatchObject({ failure_class: "note_member_placed_call" });

    const other = s16World();
    other.app.onPlaceCall = () => ({ ok: false, status: 402, code: "usage_cap_reached" });
    expect(await S16.run(other.ctx)).toMatchObject({ failure_class: "note_member_wrong_refusal" });
  });

  it("fails a token minted after sign-out, a refused sign-out, and a token a fresh sign-in cannot mint", async () => {
    const survives = s16World();
    survives.app.signOutSession = async () => ({ status: 200 });
    expect(await S16.run(survives.ctx)).toMatchObject({ failure_class: "voice_survives_sign_out" });

    const refused = s16World();
    refused.app.signOutSession = async () => ({ status: 401 });
    expect(await S16.run(refused.ctx)).toMatchObject({ failure_class: "sign_out_refused" });

    const unrestored = s16World();
    unrestored.app.tokenAnswer = () => ({ status: 403, code: "forbidden" });
    expect(await S16.afterRelease!(unrestored.ctx)).toMatchObject({ failure_class: "voice_not_restored" });
  });

  it("blames the probe when the sign-out member cannot mint to begin with", async () => {
    const broken = s16World();
    broken.app.tokenAnswer = () => ({ status: 500 });
    expect(await S16.run(broken.ctx)).toMatchObject({ outcome: "infra", component: "app-probe" });
  });
});

function s17World(attempts: (number | null)[] = [503, 200], extra: Partial<WebhookDelivery> = {}) {
  const world = fakeContext("S17");
  const { app, guard, rig, undo, time } = world;
  const delivery: WebhookDelivery = {
    id: "delivery-1",
    status: "delivered",
    event_type: "call.initiated",
    event_id: "event-1",
    attempts: attempts.map((http_status) => ({ host: "edge.example.invalid", http_status, at: null })),
    ...extra,
  };
  guard.deliveries = [delivery];
  app.webhookEventRows = [{ event_id: "event-1", event_type: "call.initiated", processed_at: iso(time.now), attempts: 1 }];
  const armed: number[] = [];
  const failNext = rig.failNextCallEvent.bind(rig);
  rig.failNextCallEvent = async (status: 503) => {
    armed.push(undo.length);
    return failNext(status);
  };
  return { ...world, delivery, armed };
}

describe("S17, webhook failover", () => {
  it("passes when the event failed once, failed over to a 2xx and was recorded and processed once", async () => {
    const { ctx, rig, undo, armed, robot } = s17World();
    expect(await S17.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(rig.faults).toEqual([503]);
    expect(undo).toEqual([{ kind: "rig.disarm-call-event-fault", params: {} }]);
    expect(armed).toEqual([1]);
    expect(robot.plans[0]).toMatchObject({ direction: "outbound", role: "ROBOT-1", to: "DEV-W1", lease_id: "lease-test" });
    expect(ctx.evidence.delivery).toMatchObject({ attempts: [503, 200] });
    expect(JSON.stringify(ctx.evidence)).not.toContain("edge.example.invalid");
  });

  it("blames the rig when no delivery shows the 503, and the guard when the log is empty", async () => {
    const unwired = s17World([200]);
    expect(await S17.run(unwired.ctx)).toMatchObject({ outcome: "infra", component: "rig" });

    const empty = s17World();
    empty.guard.deliveries = [];
    expect(await S17.run(empty.ctx)).toMatchObject({ outcome: "infra", component: "guard" });
  });

  it("fails a 503 never followed by a 2xx", async () => {
    expect(await S17.run(s17World([503, 503]).ctx)).toMatchObject({ failure_class: "no_failover_success" });
    expect(await S17.run(s17World([200, 503]).ctx)).toMatchObject({ failure_class: "no_failover_success" });
    expect(await S17.run(s17World([503, null]).ctx)).toMatchObject({ failure_class: "no_failover_success" });
  });

  it("cannot match the event while deliveries name no event id", async () => {
    const world = s17World();
    world.delivery.event_id = null;
    expect(await S17.run(world.ctx)).toMatchObject({ outcome: "infra", component: "guard" });
  });

  it("fails the event when the API never recorded it, recorded it twice or never processed it", async () => {
    const lost = s17World();
    lost.app.webhookEventRows = [{ event_id: "event-2", event_type: "call.initiated", processed_at: iso(lost.time.now), attempts: 1 }];
    expect(await S17.run(lost.ctx)).toMatchObject({ failure_class: "event_not_recorded" });

    const twice = s17World();
    twice.app.webhookEventRows.push({ ...twice.app.webhookEventRows[0]! });
    expect(await S17.run(twice.ctx)).toMatchObject({ failure_class: "event_recorded_twice" });

    const unprocessed = s17World();
    unprocessed.app.webhookEventRows[0]!.processed_at = null;
    expect(await S17.run(unprocessed.ctx)).toMatchObject({ failure_class: "event_not_processed" });
  });

  it("blames the robot when it cannot dial", async () => {
    const world = s17World();
    world.robot.dial = async (plan: CallPlan) => ({ plan_id: "plan-0", plan, state: "failed", ids: {}, events: [], dtmf: "", errors: ["robot: Telnyx is unreachable"] });
    expect(await S17.run(world.ctx)).toMatchObject({ outcome: "infra", component: "robot" });
  });
});

function s26World() {
  const world = fakeContext("S26");
  const { app, rig, time } = world;
  const seededSegments: { tenant: string; role: string; segments: number; body: string }[] = [];
  Object.assign(app, {
    seedOutboundSegments: async (args: { tenant: string; role: string; segments: number; body: string }) => {
      seededSegments.push(args);
      return { marker: `rig-seed-messages-${seededSegments.length}` };
    },
  });
  const gates = { cap: true, hourly: true };
  const used = () => app.seeded.reduce((sum, row) => sum + row.quantity, 0);
  const hour = () => seededSegments.reduce((sum, row) => sum + row.segments, 0);
  app.onSend = (_send, id) => {
    if (gates.hourly && hour() >= 250) return { ok: false, status: 429, code: "rate_limited" };
    if (gates.cap && used() > 3 * 2_500) return { ok: false, status: 402, code: "usage_cap_reached" };
    return { ok: true, messageId: id };
  };
  const fireCron = app.fireCron.bind(app);
  app.fireCron = async (cron: string, at?: number) => {
    await fireCron(cron, at);
    if (cron === "25 * * * *" && hour() >= 1_600) {
      rig.events.push({ at: time.now, level: "warning", message: "QA-C is at 80% of its carrier ceiling for the day", fingerprint: ["carrier-ceiling"] });
    }
  };
  return { ...world, seededSegments, gates };
}

describe("S26, messaging caps", () => {
  it("seeds past the gates apps/api runs, at their own numbers", async () => {
    const migrations = repoPath("supabase/migrations");
    const latest = readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .filter((name) => readFileSync(`${migrations}/${name}`, "utf8").includes("function public.gate_outbound_send"))
      .at(-1)!;
    const gate = readFileSync(`${migrations}/${latest}`, "utf8");
    expect(gate).toMatch(/v_hour_segments >= 250/);
    expect(gate).toMatch(/when 'starter' then 500 when 'pro' then 2500/);
    expect(SEGMENT_CAP_SEED).toBeGreaterThanOrEqual(10 * 2_500);
    expect(CARRIER_WARN_SEGMENTS).toBeGreaterThanOrEqual(250);

    const { approachingCarrierCeiling } = (await importFromRepo("packages/shared/src/carrier-throughput.ts")) as {
      approachingCarrierCeiling: (sent: number, useCase: string) => boolean;
    };
    expect(approachingCarrierCeiling(CARRIER_WARN_SEGMENTS, "LOW_VOLUME")).toBe(true);
    expect(approachingCarrierCeiling(CARRIER_WARN_SEGMENTS, "SOLE_PROPRIETOR")).toBe(true);

    const { ERROR_CODE_STATUS } = (await importFromRepo("packages/shared/src/error-codes.ts")) as { ERROR_CODE_STATUS: Record<string, number> };
    expect(ERROR_CODE_STATUS).toMatchObject({ usage_cap_reached: 402, rate_limited: 429, service_unavailable: 503, forbidden: 403 });
  });

  it("passes when each gate refuses with its own code and the carrier alert lands", async () => {
    const { ctx, app, undo, seededSegments } = s26World();
    expect(await S26.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(app.seeded).toEqual([
      { marker: "rig-seed-1", tenant: "QA-C", type: "sms_outbound", channel: "sms", unit: "segment", quantity: SEGMENT_CAP_SEED },
    ]);
    expect(seededSegments).toEqual([{ tenant: "QA-C", role: "ROBOT-1", segments: CARRIER_WARN_SEGMENTS, body: expect.stringContaining(ctx.nonce) }]);
    expect(undo).toEqual([
      { kind: "app.clear-seeded-usage", params: { marker: "rig-seed-1" } },
      { kind: "app.clear-seeded-usage", params: { marker: "rig-seed-messages-1" } },
    ]);
    expect(ctx.evidence.gates).toMatchObject({ segment_cap: "402 usage_cap_reached", hourly_limit: "429 rate_limited", real_sends: 0, carrier_alert: true });
    expect(app.sends.map((s) => s.body)).toEqual([`Rig S26 segment_cap ${ctx.nonce}`, `Rig S26 hourly_limit ${ctx.nonce}`]);
    expect(app.sends.every((s) => s.member === "qa-c-owner" && s.fromRole === "DEV-C1" && s.toRole === "ROBOT-1")).toBe(true);
    expect(app.firedCrons).toEqual([{ cron: "25 * * * *" }]);
  });

  it("names a gate that let a text out, and lets out no more than two", async () => {
    const cap = s26World();
    cap.gates.cap = false;
    expect(await S26.run(cap.ctx)).toMatchObject({ failure_class: "segment_cap_not_enforced" });

    const hourly = s26World();
    const send = hourly.app.onSend;
    hourly.app.onSend = (args, id) => (args.body.includes("hourly_limit") ? { ok: true, messageId: id } : send(args, id));
    expect(await S26.run(hourly.ctx)).toMatchObject({ failure_class: "hourly_limit_not_enforced" });

    const both = s26World();
    both.gates.cap = false;
    both.gates.hourly = false;
    expect(await S26.run(both.ctx)).toMatchObject({ failure_class: "segment_cap_not_enforced" });
    expect(both.app.sends).toHaveLength(2);
    expect(both.ctx.evidence.gates).toMatchObject({ segment_cap: "sent", hourly_limit: "sent", real_sends: 2 });
  });

  it("names a refusal under another gate's code", async () => {
    const cap = s26World();
    const send = cap.app.onSend;
    cap.app.onSend = (args, id) => (args.body.includes("segment_cap") ? { ok: false, status: 403, code: "forbidden" } : send(args, id));
    expect(await S26.run(cap.ctx)).toMatchObject({ failure_class: "segment_cap_wrong_refusal" });

    const paused = s26World();
    const sendPaused = paused.app.onSend;
    paused.app.onSend = (args, id) => (args.body.includes("segment_cap") ? { ok: false, status: 402, code: "workspace_paused" } : sendPaused(args, id));
    expect(await S26.run(paused.ctx)).toMatchObject({ failure_class: "segment_cap_wrong_refusal" });

    // With the hourly limit not reading the seeded segments, the monthly cap still seeded answers instead.
    const hourly = s26World();
    hourly.gates.hourly = false;
    expect(await S26.run(hourly.ctx)).toMatchObject({ failure_class: "hourly_limit_wrong_refusal", detail: expect.stringContaining("402 usage_cap_reached") });
  });

  it("fails when the carrier alert never reaches loonext-rig, and counts no other event as it", async () => {
    const silent = s26World();
    silent.app.fireCron = async () => undefined;
    silent.rig.events.push({ at: silent.time.now + 1, message: "carrier lookup failed for a contact" });
    silent.rig.events.push({ at: silent.time.now - 60_000, message: "carrier ceiling warning", fingerprint: ["carrier-ceiling"] });
    expect(await S26.run(silent.ctx)).toMatchObject({ failure_class: "carrier_alert_missing" });

    const retry = s26World();
    retry.ctx.attempt = 2;
    retry.app.fireCron = async () => undefined;
    expect(await S26.run(retry.ctx)).toMatchObject({ failure_class: "carrier_alert_missing", detail: expect.stringContaining("already warned") });
  });

});

describe("G01's probe rules", () => {
  it("are rules the guard refuses under", async () => {
    const { RULES } = (await importFromRepo("tools/guard/src/refusal.ts")) as { RULES: readonly string[] };
    for (const kind of GUARD_PROBES) expect(RULES).toContain(PROBE_RULES[kind as GuardProbe]);
  });
});

function repoPath(path: string): string {
  return fileURLToPath(new URL(`../../../../../${path}`, import.meta.url));
}

/**
 * The production module these runners mirror, loaded by vitest at run time.
 * A computed specifier keeps tsc out of apps/api, whose imports rigd's
 * NodeNext settings cannot resolve.
 */
function importFromRepo(path: string): Promise<unknown> {
  return import(/* @vite-ignore */ pathToFileURL(repoPath(path)).href);
}
