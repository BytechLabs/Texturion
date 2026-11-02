import { describe, expect, it } from "vitest";
import { S01, S02, S04, VOICEMAIL_PHRASE } from "./calls.ts";
import { wordErrorRate } from "./context.ts";
import { fakeContext } from "./fakes.ts";
import { isQuietHour, S20, S21, S23, S24, S25 } from "./texts.ts";

const TENANT_OF_MEMBER: Record<string, string> = { "qa-w-owner": "QA-W", "qa-e-owner": "QA-E" };
const TENANT_OF_NUMBER: Record<string, string> = { "DEV-W1": "QA-W", "DEV-E1": "QA-E" };

function textWorld(scenario: string) {
  const world = fakeContext(scenario);
  const { app, robot, time } = world;
  app.onSend = (send, id) => {
    app.thread(TENANT_OF_MEMBER[send.member]!, send.body, "outbound");
    app.usage.set(id, [{ type: "sms", quantity: 1, stripe_reported_at: new Date(time.now).toISOString() }]);
    const receiver = TENANT_OF_NUMBER[send.toRole];
    if (receiver) app.thread(receiver, send.body, "inbound");
    else robot.deliver({ from_role: send.fromRole, to_role: send.toRole, text: send.body });
    robot.sinkItems.push({ received_at: time.now, headers: {}, body: JSON.stringify({ type: "message.sent", data: { id } }), type: "message.sent" });
    return { ok: true, messageId: id };
  };
  robot.onSms = (message) => {
    const tenant = TENANT_OF_NUMBER[message.to_role];
    if (tenant) app.thread(tenant, message.text, "inbound");
    app.pushes.push({ tenant: tenant ?? "", purpose: "alert", platform: "web", response_class: "accepted", attempted_at: new Date(time.now).toISOString() });
  };
  return world;
}

describe("S20, outbound text", () => {
  it("passes when the exact body arrives, is delivered, metered and announced", async () => {
    const { ctx, app } = textWorld("S20");
    expect(await S20.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(app.sends[0]).toMatchObject({ member: "qa-w-owner", fromRole: "DEV-W1", toRole: "ROBOT-1" });
    expect(app.sends[0]!.body).toContain(ctx.nonce);
    expect(app.firedCrons).toEqual([{ cron: "0 * * * *" }, { cron: "*/5 * * * *" }]);
  });

  it("names each missing piece", async () => {
    const lost = textWorld("S20");
    lost.robot.deliver = () => undefined;
    expect(await S20.run(lost.ctx)).toMatchObject({ outcome: "fail", failure_class: "not_delivered" });

    const unmetered = textWorld("S20");
    const send = unmetered.app.onSend;
    unmetered.app.onSend = (args, id) => {
      const result = send(args, id);
      unmetered.app.usage.set(id, [{ type: "sms", quantity: 1, stripe_reported_at: null }]);
      return result;
    };
    expect(await S20.run(unmetered.ctx)).toMatchObject({ failure_class: "meter_not_reported" });

    const silent = textWorld("S20");
    silent.robot.sinkItems = [];
    const original = silent.app.onSend;
    silent.app.onSend = (args, id) => {
      const result = original(args, id);
      silent.robot.sinkItems = [];
      return result;
    };
    expect(await S20.run(silent.ctx)).toMatchObject({ failure_class: "webhook_missing" });

    const refused = textWorld("S20");
    refused.app.onSend = () => ({ ok: false, status: 402, code: "plan_required" });
    expect(await S20.run(refused.ctx)).toMatchObject({ failure_class: "send_refused" });
  });

  it("points the workspace's webhooks at the robot's sink first, and blames the rig when it cannot", async () => {
    const world = textWorld("S20");
    expect((await S20.run(world.ctx)).outcome).toBe("pass");
    expect(world.app.webhooks.get("qa-w-owner")).toEqual(["message.sent"]);

    const unnamed = textWorld("S20");
    unnamed.app.webhookRefusal = "the store has no robot-webhook-secret";
    expect(await S20.run(unnamed.ctx)).toMatchObject({ outcome: "infra", component: "webhook-endpoint" });
    expect(unnamed.app.sends).toEqual([]);
  });
});

describe("S21, inbound text", () => {
  it("passes when the text threads once, shows in the page and pushes", async () => {
    const { ctx, browser } = textWorld("S21");
    expect((await S21.run(ctx)).outcome).toBe("pass");
    expect(browser.opened[0]).toMatchObject({ member: "qa-w-owner" });
  });

  it("fails a text threaded twice, and one the page never shows", async () => {
    const twice = textWorld("S21");
    const thread = twice.robot.onSms;
    twice.robot.onSms = (message) => {
      thread(message);
      thread(message);
    };
    expect(await S21.run(twice.ctx)).toMatchObject({ failure_class: "threaded_twice" });
    const stale = textWorld("S21");
    stale.browser.script.showsText = false;
    expect(await S21.run(stale.ctx)).toMatchObject({ failure_class: "no_realtime_update" });
  });

  it("subscribes the owner's browser when the owner has nowhere to push to", async () => {
    const fresh = textWorld("S21");
    fresh.app.targets.clear();
    fresh.browser.script.canPush = true;
    fresh.browser.script.onPush = (member) => fresh.app.targets.set(member, 1);
    expect((await S21.run(fresh.ctx)).outcome).toBe("pass");
    expect(fresh.browser.actions).toContain("qa-w-owner enable push");

    const unsaved = textWorld("S21");
    unsaved.app.targets.clear();
    unsaved.browser.script.canPush = true;
    expect(await S21.run(unsaved.ctx)).toMatchObject({ failure_class: "push_subscription_not_saved" });

    const unable = textWorld("S21");
    unable.app.targets.clear();
    unable.browser.script.canPush = false;
    expect(await S21.run(unable.ctx)).toMatchObject({ outcome: "infra", component: "push-target" });
    expect(unable.robot.sent).toEqual([]);
  });
});

describe("S23, Loonext texts Loonext", () => {
  it("passes when both workspaces thread both directions", async () => {
    const { ctx, app } = textWorld("S23");
    expect((await S23.run(ctx)).outcome).toBe("pass");
    expect(app.sends.map((s) => `${s.fromRole}>${s.toRole}`)).toEqual(["DEV-W1>DEV-E1", "DEV-E1>DEV-W1"]);
  });

  it("names the 40007 loop error", async () => {
    const world = textWorld("S23");
    world.app.onSend = (send, id) => {
      world.app.thread(TENANT_OF_MEMBER[send.member]!, send.body, "outbound", { status: "failed", error_code: "40007" });
      world.app.thread(TENANT_OF_NUMBER[send.toRole]!, send.body, "inbound");
      return { ok: true, messageId: id };
    };
    expect(await S23.run(world.ctx)).toMatchObject({ failure_class: "loop_error_40007" });
  });
});

function stopWorld() {
  const world = textWorld("S24");
  const { app, robot, undo } = world;
  const key = "QA-E/ROBOT-2";
  const undoBeforeStop: number[] = [];
  robot.onSms = ({ text }) => {
    const word = text.trim().toUpperCase();
    if (word === "STOP" || word === "ARRET") {
      undoBeforeStop.push(undo.length);
      app.optOuts.set(key, { active: true, source: "keyword" });
    } else if (word === "START") app.optOuts.set(key, { active: false, source: "keyword" });
    else if (word === "HELP" || word === "AIDE") robot.deliver({ from_role: "DEV-E1", to_role: "ROBOT-2", text: "Reply STOP to opt out." });
    else if (/stop texting/i.test(text)) app.hints.set(key, "2026-10-31T15:05:00.000Z");
  };
  app.onSend = (send, id) => (app.optOuts.get(key)?.active ? { ok: false, status: 422, code: "contact_opted_out" } : { ok: true, messageId: id });
  return { ...world, undoBeforeStop, key };
}

describe("S24, STOP and friends", () => {
  it("passes, with the START undo registered before any STOP was sent", async () => {
    const { ctx, robot, undo, undoBeforeStop, browser } = stopWorld();
    expect((await S24.run(ctx)).outcome).toBe("pass");
    expect(undo).toEqual([{ kind: "robot.sms", params: { from_role: "ROBOT-2", to_role: "DEV-E1", text: "START" } }]);
    expect(undoBeforeStop.every((count) => count === 1)).toBe(true);
    expect(robot.sent.every((m) => m.from_role === "ROBOT-2" && m.to_role === "DEV-E1")).toBe(true);
    expect(robot.plans[0]).toMatchObject({ direction: "inbound", role: "ROBOT-2", lease_id: "lease-test" });
    expect(browser.actions).toContain("qa-e-owner dial ROBOT-2");
  });

  it("calls a send to an opted-out number critical", async () => {
    const world = stopWorld();
    world.app.onSend = (_send, id) => ({ ok: true, messageId: id });
    expect(await S24.run(world.ctx)).toMatchObject({ failure_class: "sent_after_stop" });
  });

  it("fails when the opt-out also blocks the call (D38)", async () => {
    const world = stopWorld();
    world.robot.outcome = () => ({ state: "failed", errors: ["no call arrived"] });
    expect(await S24.run(world.ctx)).toMatchObject({ failure_class: "call_blocked_by_opt_out" });
  });

  it("fails a plain-English request that opted the number out", async () => {
    const world = stopWorld();
    const handle = world.robot.onSms;
    world.robot.onSms = (message) => {
      handle(message);
      if (/stop texting/i.test(message.text)) world.app.optOuts.set(world.key, { active: true, source: "keyword" });
    };
    expect(await S24.run(world.ctx)).toMatchObject({ failure_class: "plain_english_opted_out" });
  });

  it("calls a STOP left in place after cleanup critical", async () => {
    const world = stopWorld();
    world.app.optOuts.set(world.key, { active: true, source: "keyword" });
    expect(await S24.afterRelease!(world.ctx)).toMatchObject({ failure_class: "stop_left_in_place", critical: true });
    world.app.optOuts.set(world.key, { active: false, source: "keyword" });
    expect(await S24.afterRelease!(world.ctx)).toBeUndefined();
  });
});

describe("S25, automated texts and quiet hours", () => {
  it("reads quiet hours on the destination's clock, from 20:00 to 08:00 as the app does", () => {
    expect(isQuietHour(Date.UTC(2026, 9, 31, 15))).toBe(false);
    expect(isQuietHour(Date.UTC(2026, 10, 1, 3))).toBe(true);
    expect(isQuietHour(Date.UTC(2026, 9, 31, 12, 30))).toBe(false);
    // Winter, UTC-5: 20:00 is quiet, 19:59 is not; 07:59 is quiet, 08:00 is not.
    expect(isQuietHour(Date.UTC(2026, 11, 3, 1, 0))).toBe(true);
    expect(isQuietHour(Date.UTC(2026, 11, 3, 0, 59))).toBe(false);
    expect(isQuietHour(Date.UTC(2026, 11, 3, 12, 59))).toBe(true);
    expect(isQuietHour(Date.UTC(2026, 11, 3, 13, 0))).toBe(false);
    // Summer, UTC-4: 20:30 local.
    expect(isQuietHour(Date.UTC(2026, 6, 2, 0, 30))).toBe(true);
  });

  it("passes by day when every automation arrives, and at night when the business's own are held", async () => {
    const day = textWorld("S25");
    day.app.automations = [
      { kind: "away_reply", body: "Away n0nce", state: "sent", reply: true },
      { kind: "scheduled_send", body: "Scheduled n0nce", state: "sent", reply: false },
    ];
    day.robot.deliver({ from_role: "DEV-W1", to_role: "ROBOT-1", text: "Away n0nce" });
    day.robot.deliver({ from_role: "DEV-W1", to_role: "ROBOT-1", text: "Scheduled n0nce" });
    expect((await S25.run(day.ctx)).outcome).toBe("pass");
    expect(day.undo).toEqual([{ kind: "app.disarm-automations", params: { tenant: "QA-W", nonce: "n0nce" } }]);
    expect(day.app.firedCrons).toEqual([{ cron: "* * * * *" }]);

    const night = textWorld("S25");
    night.time.now = Date.UTC(2026, 10, 1, 3);
    night.app.automations = [{ kind: "reminder", body: "Reminder n0nce", state: "held", reply: false }];
    expect((await S25.run(night.ctx)).outcome).toBe("pass");
    night.app.automations = [{ kind: "reminder", body: "Reminder n0nce", state: "sent", reply: false }];
    expect(await S25.run(night.ctx)).toMatchObject({ failure_class: "sent_in_quiet_hours" });
  });

  it("expects a reply to the customer's own text at night as well, which D4 exempts from quiet hours", async () => {
    const night = textWorld("S25");
    night.time.now = Date.UTC(2026, 10, 1, 3);
    night.app.automations = [
      { kind: "emergency_ack", body: "Emergency n0nce", state: "sent", reply: true },
      { kind: "reminder", body: "Reminder n0nce", state: "held", reply: false },
    ];
    night.robot.deliver({ from_role: "DEV-W1", to_role: "ROBOT-1", text: "Emergency n0nce" });
    expect((await S25.run(night.ctx)).outcome).toBe("pass");

    const held = textWorld("S25");
    held.time.now = Date.UTC(2026, 10, 1, 3);
    held.app.automations = [{ kind: "away_reply", body: "Away n0nce", state: "held", reply: true }];
    expect(await S25.run(held.ctx)).toMatchObject({ failure_class: "reply_held_at_night" });
  });

  it("reports the probe, not the product, when automations cannot be armed", async () => {
    const world = textWorld("S25");
    world.app.armAutomations = async () => {
      throw new Error("the app probe cannot seed S25's automations yet");
    };
    expect(await S25.run(world.ctx)).toMatchObject({ outcome: "infra", component: "app-probe" });
  });
});

describe("S01, the browser calls ROBOT-1", () => {
  it("passes with codes heard both ways, ringback, caller ID, a used token and a meter", async () => {
    const { ctx, robot, browser } = fakeContext("S01");
    expect((await S01.run(ctx)).outcome).toBe("pass");
    expect(robot.plans[0]).toMatchObject({ direction: "inbound", role: "ROBOT-1", answer_after_ms: 4_000, expect: "qa-w-owner" });
    expect(browser.actions).toEqual(["qa-w-owner dial ROBOT-1"]);
    expect(ctx.evidence.call).toMatchObject({ ids: { call_session_id: "session-1" } });
  });

  it("names a wrong caller ID, no ringback, a token left over and a deaf page", async () => {
    const wrong = fakeContext("S01");
    const outcome = wrong.robot.outcome;
    wrong.robot.outcome = (plan) => ({ ...outcome(plan), from_role: "DEV-W2" });
    expect(await S01.run(wrong.ctx)).toMatchObject({ failure_class: "wrong_caller_id" });

    const quiet = fakeContext("S01");
    quiet.browser.script.energyBeforeAnswer = 0;
    expect(await S01.run(quiet.ctx)).toMatchObject({ failure_class: "no_ringback" });

    const left = fakeContext("S01");
    left.app.tokenUse = { calls: 1, left: 1 };
    expect(await S01.run(left.ctx)).toMatchObject({ failure_class: "token_not_used_once" });

    // No token was ever minted: nothing is left over, and no consumed token made the row.
    const unauthorized = fakeContext("S01");
    unauthorized.app.tokenUse = { calls: 0, left: 0 };
    expect(await S01.run(unauthorized.ctx)).toMatchObject({ failure_class: "token_not_used_once" });

    const deaf = fakeContext("S01");
    deaf.browser.script.heard = null;
    expect(await S01.run(deaf.ctx)).toMatchObject({ failure_class: "member_did_not_hear_robot" });
  });
});

function s02World() {
  const world = fakeContext("S02");
  world.app.callRows.push({
    tenant: "QA-W",
    caller_role: "ROBOT-1",
    call_session_id: "inbound-session",
    outcome: "answered",
    forward_seconds: 25,
    started_at: "2026-10-31T15:00:01.000Z",
    ended_at: "2026-10-31T15:00:30.000Z",
    voicemail_path: null,
    voicemail_transcript: null,
    voicemail_intake: null,
  });
  return world;
}

describe("S02, ROBOT-1 calls DEV-W1", () => {
  it("passes when the owner rings within 6 s, answers, and both codes and the bill line up", async () => {
    const { ctx, robot, browser } = s02World();
    expect((await S02.run(ctx)).outcome).toBe("pass");
    expect(robot.plans[0]).toMatchObject({ direction: "outbound", role: "ROBOT-1", to: "DEV-W1", lease_id: "lease-test" });
    expect(browser.actions).toContain("qa-w-owner answer");
    expect(ctx.evidence.billing).toEqual({ row_seconds: 25, metered_seconds: 25 });
  });

  it("names a late ring, a robot that heard nobody, a guard refusal and a billing mismatch", async () => {
    const late = s02World();
    late.browser.script.ringsAfterMs = 7_000;
    expect(await S02.run(late.ctx)).toMatchObject({ failure_class: "no_ring_within_6s" });

    const deaf = s02World();
    const outcome = deaf.robot.outcome;
    deaf.robot.outcome = (plan) => {
      const record = outcome(plan);
      return { ...record, judgement: { ...record.judgement!, pass: false, heard: [], verdict: "silent", answered: null } };
    };
    expect(await S02.run(deaf.ctx)).toMatchObject({ failure_class: "robot_did_not_hear_member" });

    const refused = s02World();
    refused.robot.dial = async (plan) => ({
      plan_id: "plan-0",
      plan,
      state: "failed",
      ids: {},
      events: [],
      dtmf: "",
      errors: ["guard_refused:dial.window"],
    });
    expect(await S02.run(refused.ctx)).toMatchObject({ outcome: "infra", component: "guard" });

    const billed = s02World();
    billed.app.metered = 31;
    expect(await S02.run(billed.ctx)).toMatchObject({ failure_class: "billed_seconds_mismatch" });
  });
});

function s04World(transcript = VOICEMAIL_PHRASE.toLowerCase()) {
  const world = fakeContext("S04");
  world.app.callRows.push({
    tenant: "QA-W",
    caller_role: "ROBOT-1",
    call_session_id: "vm-session",
    outcome: "voicemail",
    forward_seconds: 0,
    started_at: "2026-10-31T15:00:01.000Z",
    ended_at: "",
    voicemail_path: "company/voicemail.wav",
    voicemail_transcript: transcript,
    voicemail_intake: { summary: "water heater" },
  });
  world.robot.sinkItems.push({ received_at: world.time.now + 1, headers: { "loonext-signature": "t=1,v1=abc" }, body: "{}", type: "voicemail.received" });
  world.robot.deliver({ from_role: "DEV-W1", to_role: "ROBOT-1", text: "Sorry we missed you" });
  return world;
}

describe("S04, voicemail", () => {
  it("passes with the voicemail stored, Telnyx's copy gone, a close transcript, intake, webhook and text-back", async () => {
    const { ctx, robot } = s04World();
    expect((await S04.run(ctx)).outcome).toBe("pass");
    expect(robot.plans[0]).toMatchObject({ play: null, record: false, voicemail: { phrase: VOICEMAIL_PHRASE } });
    expect(ctx.evidence.word_error_rate).toBe(0);
  });

  it("names a kept Telnyx copy, a poor transcript, an unsigned webhook and a missing text-back", async () => {
    const kept = s04World();
    kept.app.recordingsLeft = 1;
    expect(await S04.run(kept.ctx)).toMatchObject({ failure_class: "telnyx_copy_kept" });

    const garbled = s04World("hello this is a bot please call about the heater");
    expect(await S04.run(garbled.ctx)).toMatchObject({ failure_class: "transcript_wer" });

    const unsigned = s04World();
    unsigned.robot.sinkItems[0]!.headers = {};
    expect(await S04.run(unsigned.ctx)).toMatchObject({ failure_class: "webhook_unsigned" });

    const silent = s04World();
    silent.robot.inboxItems = [];
    expect(await S04.run(silent.ctx)).toMatchObject({ failure_class: "no_text_back" });
  });

  it("subscribes the robot's sink to voicemail.received before dialing, or blames the rig", async () => {
    const world = s04World();
    expect((await S04.run(world.ctx)).outcome).toBe("pass");
    expect(world.app.webhooks.get("qa-w-owner")).toEqual(["voicemail.received"]);
    const unnamed = s04World();
    unnamed.app.webhookRefusal = "the store has no robot-webhook-secret";
    expect(await S04.run(unnamed.ctx)).toMatchObject({ outcome: "infra", component: "webhook-endpoint" });
    expect(unnamed.robot.plans).toEqual([]);
  });
});

describe("wordErrorRate", () => {
  it("counts substitutions, insertions and deletions over the reference", () => {
    expect(wordErrorRate("the water heater", "the water heater")).toBe(0);
    expect(wordErrorRate("the water heater", "the hot water heater")).toBeCloseTo(1 / 3);
    expect(wordErrorRate("call me back on Tuesday", "call back Tuesday")).toBeCloseTo(2 / 5);
    expect(wordErrorRate("Hello, there!", "hello there")).toBe(0);
  });
});
