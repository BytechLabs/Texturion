import { describe, expect, it } from "vitest";
import { S01, S02, S04, VOICEMAIL_PHRASE } from "./calls.ts";
import { wordErrorRate } from "./context.ts";
import { fakeContext } from "./fakes.ts";
import { isQuietHour, S20, S21, S23, S24, S25 } from "./texts.ts";

const TENANT_OF_MEMBER: Record<string, string> = { "qa-w-owner": "QA-W", "qa-e-owner": "QA-E" };
const TENANT_OF_NUMBER: Record<string, string> = { "DEV-W1": "QA-W", "DEV-E1": "QA-E" };
const WEB_PUSH_ENDPOINT = "https://push.example.test/current-browser";

function textWorld(scenario: string) {
  const world = fakeContext(scenario);
  const { app, browser, robot, time } = world;
  browser.script.canPush = true;
  browser.script.pushEndpoint = WEB_PUSH_ENDPOINT;
  app.webPushEndpoints.set("qa-w-owner", WEB_PUSH_ENDPOINT);
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
    browser.script.notifications = [{ title: "A customer", body: message.text, tag: "conversation:1" }];
  };
  return world;
}

describe("S20, outbound text", () => {
  it("passes when the exact body arrives, is delivered, metered and announced", async () => {
    const { ctx, app } = textWorld("S20");
    await expect(S20.run(ctx)).resolves.toEqual({ outcome: "pass", detail: undefined });
    expect(app.sends[0]).toMatchObject({ member: "qa-w-owner", fromRole: "DEV-W1", toRole: "ROBOT-1" });
    expect(app.sends[0]!.body).toContain(ctx.nonce);
    expect(app.firedCrons).toEqual([{ cron: "0 * * * *" }, { cron: "*/5 * * * *" }]);
  });

  it("names each missing piece", async () => {
    const lost = textWorld("S20");
    lost.robot.deliver = () => undefined;
    await expect(S20.run(lost.ctx)).resolves.toMatchObject({ outcome: "fail", failure_class: "not_delivered" });

    const unmetered = textWorld("S20");
    const send = unmetered.app.onSend;
    unmetered.app.onSend = (args, id) => {
      const result = send(args, id);
      unmetered.app.usage.set(id, [{ type: "sms", quantity: 1, stripe_reported_at: null }]);
      return result;
    };
    await expect(S20.run(unmetered.ctx)).resolves.toMatchObject({ failure_class: "meter_not_reported" });

    const silent = textWorld("S20");
    silent.robot.sinkItems = [];
    const original = silent.app.onSend;
    silent.app.onSend = (args, id) => {
      const result = original(args, id);
      silent.robot.sinkItems = [];
      return result;
    };
    await expect(S20.run(silent.ctx)).resolves.toMatchObject({ failure_class: "webhook_missing" });

    const refused = textWorld("S20");
    refused.app.onSend = () => ({ ok: false, status: 402, code: "plan_required" });
    await expect(S20.run(refused.ctx)).resolves.toMatchObject({ failure_class: "send_refused" });
  });

  it("points the workspace's webhooks at the robot's sink first, and blames the rig when it cannot", async () => {
    const world = textWorld("S20");
    expect((await S20.run(world.ctx)).outcome).toBe("pass");
    expect(world.app.webhooks.get("qa-w-owner")).toEqual(["message.sent"]);

    const unnamed = textWorld("S20");
    unnamed.app.webhookRefusal = "the store has no robot-webhook-secret";
    await expect(S20.run(unnamed.ctx)).resolves.toMatchObject({ outcome: "infra", component: "webhook-endpoint" });
    expect(unnamed.app.sends).toEqual([]);
  });
});

describe("S21, inbound text", () => {
  it("passes when the text threads once, shows in the page and pushes", async () => {
    const { ctx, browser } = textWorld("S21");
    expect((await S21.run(ctx)).outcome).toBe("pass");
    expect(browser.opened[0]).toMatchObject({ member: "qa-w-owner" });
  });

  it("clears the recent alert timestamp before each send and records how to restore it", async () => {
    const { ctx, app, robot, undo } = textWorld("S21");
    const cooldown = { conversationId: "robot-thread", lastNotifiedAt: new Date(ctx.now()).toISOString() };
    const restore = { tenant: "QA-W", ...cooldown };
    app.inboundAlert = cooldown;
    const receive = robot.onSms;
    robot.onSms = (message) => {
      expect(app.inboundAlert).toBeNull();
      expect(undo.at(-1)).toEqual({ kind: "app.inbound-alert-time", params: restore });
      expect(message).toMatchObject({ from_role: "ROBOT-1", to_role: "DEV-W1" });
      receive(message);
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await S21.run(ctx)).outcome).toBe("pass");
      await app.setInboundAlertTime(restore);
    }
    expect(app.inboundAlert).toEqual(cooldown);
    expect(undo).toHaveLength(2);
  });

  it("leaves an expired cooldown untouched", async () => {
    const { ctx, app, undo } = textWorld("S21");
    const cooldown = { conversationId: "robot-thread", lastNotifiedAt: new Date(ctx.now() - 16 * 60_000).toISOString() };
    app.inboundAlert = cooldown;
    expect((await S21.run(ctx)).outcome).toBe("pass");
    expect(app.inboundAlert).toEqual(cooldown);
    expect(undo).toEqual([]);
  });

  it("fails a text threaded twice, and one the page never shows", async () => {
    const twice = textWorld("S21");
    const thread = twice.robot.onSms;
    twice.robot.onSms = (message) => {
      thread(message);
      thread(message);
    };
    await expect(S21.run(twice.ctx)).resolves.toMatchObject({ failure_class: "threaded_twice" });
    const stale = textWorld("S21");
    stale.browser.script.showsText = false;
    await expect(S21.run(stale.ctx)).resolves.toMatchObject({ failure_class: "no_realtime_update" });
  });

  it("subscribes the current browser even when the owner has other targets", async () => {
    const fresh = textWorld("S21");
    fresh.browser.script.pushEndpoint = undefined;
    fresh.app.webPushEndpoints.set("qa-w-owner", "https://push.example.test/old-browser");
    fresh.browser.script.onPush = (member) => {
      fresh.browser.script.pushEndpoint = WEB_PUSH_ENDPOINT;
      fresh.app.webPushEndpoints.set(member, WEB_PUSH_ENDPOINT);
    };
    expect((await S21.run(fresh.ctx)).outcome).toBe("pass");
    expect(fresh.browser.actions).toContain("qa-w-owner enable push");
  });

  it("requires the current endpoint to be saved before texting", async () => {
    const unsaved = textWorld("S21");
    unsaved.app.webPushEndpoints.set("qa-w-owner", "https://push.example.test/old-browser");
    await expect(S21.run(unsaved.ctx)).resolves.toMatchObject({ failure_class: "push_subscription_not_saved" });
    expect(unsaved.robot.sent).toEqual([]);

    const unable = textWorld("S21");
    unable.browser.script.canPush = false;
    await expect(S21.run(unable.ctx)).resolves.toMatchObject({ outcome: "infra", component: "push-target" });
    expect(unable.robot.sent).toEqual([]);
  });

  it.each(["transport_error", "transport_restricted"] as const)("reports %s as infrastructure", async (status) => {
    const { ctx, app, robot } = textWorld("S21");
    const receive = robot.onSms;
    robot.onSms = (message) => {
      receive(message);
      app.pushes[0]!.response_class = status;
    };
    await expect(S21.run(ctx)).resolves.toMatchObject({ outcome: "infra", component: "web-push-transport" });
  });

  it("requires Chrome to display the exact text even after the provider accepts it", async () => {
    const { ctx, browser, robot } = textWorld("S21");
    const receive = robot.onSms;
    robot.onSms = (message) => {
      receive(message);
      browser.script.notifications = [{ title: "A customer", body: "Another text", tag: "conversation:1" }];
    };
    await expect(S21.run(ctx)).resolves.toMatchObject({ failure_class: "web_push_not_shown" });
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
    await expect(S23.run(world.ctx)).resolves.toMatchObject({ failure_class: "loop_error_40007" });
  });
});

function stopWorld() {
  const world = textWorld("S24");
  const { app, robot, undo } = world;
  const key = "QA-E/ROBOT-2";
  const undoBeforeStop: number[] = [];
  robot.onSms = ({ text }) => {
    const word = text.trim().toUpperCase();
    if (word === "STOP." || word === "ARRET") {
      undoBeforeStop.push(undo.length);
      app.optOuts.set(key, { active: true, source: "keyword" });
      if (word === "ARRET") {
        robot.deliver({ from_role: "DEV-E1", to_role: "ROBOT-2", text: "Vous ne recevrez plus de textos." });
      }
    } else if (word === "START") app.optOuts.set(key, { active: false, source: "keyword" });
    else if (word === "HELP" || word === "AIDE") {
      const reply = word === "HELP"
        ? "QA-E. For help, text +16135550100. Reply STOP to opt out."
        : "QA-E. Pour obtenir de l'aide, textez au +16135550100. Repondez STOP.";
      robot.deliver({ from_role: "DEV-E1", to_role: "ROBOT-2", text: reply });
    } else if (/stop texting/i.test(text)) {
      app.thread("QA-E", text, "inbound");
      app.hints.set(key, new Date(world.ctx.now()).toISOString());
    }
  };
  const refusal = { ok: false, status: 403, code: "recipient_opted_out" } as const;
  app.onSend = (_send, id) => (app.optOuts.get(key)?.active ? refusal : { ok: true, messageId: id });
  app.onPlaceCall = () => (app.optOuts.get(key)?.active ? refusal : { ok: true, sessionId: "session-1" });
  return { ...world, undoBeforeStop, key };
}

describe("S24, STOP and friends", () => {
  it("passes, with the START undo registered before any STOP was sent", async () => {
    const { ctx, robot, undo, undoBeforeStop } = stopWorld();
    expect((await S24.run(ctx)).outcome).toBe("pass");
    expect(undo).toEqual([{ kind: "robot.sms", params: { from_role: "ROBOT-2", to_role: "DEV-E1", text: "START" } }]);
    expect(undoBeforeStop.every((count) => count === 1)).toBe(true);
    expect(robot.sent.every((m) => m.from_role === "ROBOT-2" && m.to_role === "DEV-E1")).toBe(true);
    expect(ctx.evidence.callAfterStop).toEqual({ status: 403, code: "recipient_opted_out" });
    expect(ctx.evidence.verifiedKeywords).toEqual(["START", "HELP", "ARRET", "START", "AIDE"]);
  });

  it("calls a send to an opted-out number critical", async () => {
    const world = stopWorld();
    world.app.onSend = (_send, id) => ({ ok: true, messageId: id });
    await expect(S24.run(world.ctx)).resolves.toMatchObject({ failure_class: "sent_after_stop" });
  });

  it("fails when an opted-out call is placed", async () => {
    const world = stopWorld();
    world.app.onPlaceCall = () => ({ ok: true, sessionId: "session-1" });
    await expect(S24.run(world.ctx)).resolves.toMatchObject({ failure_class: "called_after_stop" });
  });

  it("fails a plain-English request that opted the number out", async () => {
    const world = stopWorld();
    const handle = world.robot.onSms;
    world.robot.onSms = (message) => {
      handle(message);
      if (/stop texting/i.test(message.text)) world.app.optOuts.set(world.key, { active: true, source: "keyword" });
    };
    await expect(S24.run(world.ctx)).resolves.toMatchObject({ failure_class: "plain_english_opted_out" });
  });

  it("calls a STOP left in place after cleanup critical", async () => {
    const world = stopWorld();
    world.app.optOuts.set(world.key, { active: true, source: "keyword" });
    await expect(S24.afterRelease!(world.ctx)).resolves.toMatchObject({ failure_class: "stop_left_in_place", critical: true });
    world.app.optOuts.set(world.key, { active: false, source: "keyword" });
    await expect(S24.afterRelease!(world.ctx)).resolves.toBeUndefined();
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
    day.time.now = Date.UTC(2026, 10, 1, 3);
    day.app.automations = [
      { kind: "away_reply", body: "Away n0nce", state: "sent", reply: true },
      { kind: "scheduled_send", body: "Scheduled n0nce", state: "sent", reply: false },
    ];
    day.robot.deliver({ from_role: "DEV-W1", to_role: "ROBOT-1", text: "Away n0nce" });
    day.robot.deliver({ from_role: "DEV-W1", to_role: "ROBOT-1", text: "Scheduled n0nce" });
    expect((await S25.run(day.ctx)).outcome).toBe("pass");
    expect(day.undo).toEqual([{ kind: "app.disarm-automations", params: { tenant: "QA-W", nonce: "n0nce" } }]);
    expect(day.app.firedCrons).toHaveLength(1);
    expect(day.app.firedCrons[0]?.cron).toBe("* * * * *");
    expect(isQuietHour(day.app.firedCrons[0]!.at!)).toBe(false);

    const night = textWorld("S25");
    night.ctx.slot.index = 1;
    night.app.automations = [{ kind: "reminder", body: "Reminder n0nce", state: "held", reason: "domain.scheduledHoldQuietHours", reply: false }];
    expect((await S25.run(night.ctx)).outcome).toBe("pass");
    expect(isQuietHour(night.app.firedCrons[0]!.at!)).toBe(true);
    night.app.automations[0] = { ...night.app.automations[0]!, reason: "domain.scheduledHoldCustomerReply" };
    await expect(S25.run(night.ctx)).resolves.toMatchObject({ failure_class: "quiet_hold_missing" });
    night.app.automations = [{ kind: "reminder", body: "Reminder n0nce", state: "sent", reply: false }];
    await expect(S25.run(night.ctx)).resolves.toMatchObject({ failure_class: "sent_in_quiet_hours" });
  });

  it("expects a reply to the customer's own text at night as well, which D4 exempts from quiet hours", async () => {
    const night = textWorld("S25");
    night.ctx.slot.index = 1;
    night.app.automations = [
      { kind: "emergency_ack", body: "Emergency n0nce", state: "sent", reply: true },
      { kind: "reminder", body: "Reminder n0nce", state: "held", reason: "domain.scheduledHoldQuietHours", reply: false },
    ];
    night.robot.deliver({ from_role: "DEV-W1", to_role: "ROBOT-1", text: "Emergency n0nce" });
    expect((await S25.run(night.ctx)).outcome).toBe("pass");

    const held = textWorld("S25");
    held.ctx.slot.index = 1;
    held.app.automations = [{ kind: "away_reply", body: "Away n0nce", state: "held", reply: true }];
    await expect(S25.run(held.ctx)).resolves.toMatchObject({ failure_class: "reply_held_at_night" });
  });

  it("reports the probe, not the product, when automations cannot be armed", async () => {
    const world = textWorld("S25");
    world.app.armAutomations = async () => {
      throw new Error("the app probe cannot seed S25's automations yet");
    };
    await expect(S25.run(world.ctx)).resolves.toMatchObject({ outcome: "infra", component: "app-probe" });
  });
});

describe("S01, the browser calls ROBOT-1", () => {
  it("passes with codes heard both ways, ringback, caller ID, a used token and a meter", async () => {
    const { ctx, robot, browser } = fakeContext("S01");
    expect((await S01.run(ctx)).outcome).toBe("pass");
    expect(robot.plans[0]).toMatchObject({ direction: "inbound", role: "ROBOT-1", answer_after_ms: 4000, expect: "qa-w-owner" });
    expect(browser.actions).toEqual(["qa-w-owner dial ROBOT-1 from DEV-W1"]);
    expect(ctx.evidence.call).toMatchObject({ ids: { call_session_id: "session-1" } });
    expect(browser.hearingOptions).toEqual([
      { answeredAt: expect.any(Number), windowStartMs: 2000, windowEndMs: 25_000 },
    ]);
  });

  it("starts the hearing window at late robot playback and keeps the answer stamp for ringback", async () => {
    const { ctx, robot, browser } = fakeContext("S01");
    const {outcome} = robot;
    const answeredAt = "2026-10-31T15:00:00.000Z";
    robot.outcome = (plan) => ({
      ...outcome(plan),
      answered_at: answeredAt,
      events: [{ type: "call.playback.started", at: "2026-10-31T15:00:06.960Z" }],
    });

    await expect(S01.run(ctx)).resolves.toMatchObject({ outcome: "pass" });
    expect(browser.hearingOptions).toEqual([
      { answeredAt: Date.parse(answeredAt), windowStartMs: 6960, windowEndMs: 25_000 },
    ]);
    expect(ctx.evidence.robot_playback_delay_ms).toBe(6960);
  });

  it("names a wrong caller ID, no ringback, a token left over and a deaf page", async () => {
    const wrong = fakeContext("S01");
    const {outcome} = wrong.robot;
    wrong.robot.outcome = (plan) => ({ ...outcome(plan), from_role: "DEV-W2" });
    await expect(S01.run(wrong.ctx)).resolves.toMatchObject({ failure_class: "wrong_caller_id" });

    const quiet = fakeContext("S01");
    quiet.browser.script.energyBeforeAnswer = 0;
    await expect(S01.run(quiet.ctx)).resolves.toMatchObject({ failure_class: "no_ringback" });

    const left = fakeContext("S01");
    left.app.tokenUse = { calls: 1, left: 1 };
    await expect(S01.run(left.ctx)).resolves.toMatchObject({ failure_class: "token_not_used_once" });

    // No token was ever minted: nothing is left over, and no consumed token made the row.
    const unauthorized = fakeContext("S01");
    unauthorized.app.tokenUse = { calls: 0, left: 0 };
    await expect(S01.run(unauthorized.ctx)).resolves.toMatchObject({ failure_class: "token_not_used_once" });

    const deaf = fakeContext("S01");
    deaf.browser.script.heard = null;
    await expect(S01.run(deaf.ctx)).resolves.toMatchObject({ failure_class: "member_did_not_hear_robot" });
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
    expect(browser.opened).toEqual([{ member: "qa-w-owner", surface: "qa-w-owner", path: "/calls" }]);
    expect(robot.plans[0]).toMatchObject({ direction: "outbound", role: "ROBOT-1", to: "DEV-W1", lease_id: "lease-test" });
    expect(browser.actions).toContain("qa-w-owner answer");
    expect(ctx.evidence.billing).toEqual({ row_seconds: 25, metered_seconds: 25 });
  });

  it("names a late ring, a robot that heard nobody, a guard refusal and a billing mismatch", async () => {
    const late = s02World();
    late.browser.script.ringsAfterMs = 7000;
    await expect(S02.run(late.ctx)).resolves.toMatchObject({ failure_class: "no_ring_within_6s" });

    const deaf = s02World();
    const {outcome} = deaf.robot;
    deaf.robot.outcome = (plan) => {
      const record = outcome(plan);
      return { ...record, judgement: { ...record.judgement!, pass: false, heard: [], verdict: "silent", answered: null } };
    };
    await expect(S02.run(deaf.ctx)).resolves.toMatchObject({ failure_class: "robot_did_not_hear_member" });

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
    await expect(S02.run(refused.ctx)).resolves.toMatchObject({ outcome: "infra", component: "guard" });

    const billed = s02World();
    billed.app.metered = 31;
    await expect(S02.run(billed.ctx)).resolves.toMatchObject({ failure_class: "billed_seconds_mismatch" });
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
  world.robot.sinkItems.push({
    received_at: world.time.now + 1,
    headers: { "loonext-signature": "t=1,v1=abc" },
    body: JSON.stringify({ data: { call_session_id: "vm-session" } }),
    type: "voicemail.received",
  });
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

  it("declines a live browser ring and checks time to voicemail", async () => {
    const { ctx, browser, robot, time } = s04World();
    ctx.slot.label = "decline";
    const {outcome} = robot;
    robot.outcome = (plan) => ({ ...outcome(plan), answered_at: new Date(time.now + 1000).toISOString() });

    expect((await S04.run(ctx)).outcome).toBe("pass");
    expect(browser.actions).toContain("qa-w-owner decline");
    expect(ctx.evidence.decline_to_voicemail_ms).toBe(1000);
  });

  it("names a kept Telnyx copy, a poor transcript, an unsigned webhook and a missing text-back", async () => {
    const kept = s04World();
    kept.app.recordingsLeft = 1;
    await expect(S04.run(kept.ctx)).resolves.toMatchObject({ failure_class: "telnyx_copy_kept" });

    const garbled = s04World("hello this is a bot please call about the heater");
    await expect(S04.run(garbled.ctx)).resolves.toMatchObject({ failure_class: "transcript_wer" });

    const unsigned = s04World();
    unsigned.robot.sinkItems[0]!.headers = {};
    await expect(S04.run(unsigned.ctx)).resolves.toMatchObject({ failure_class: "webhook_unsigned" });

    const silent = s04World();
    silent.robot.inboxItems = [];
    await expect(S04.run(silent.ctx)).resolves.toMatchObject({ failure_class: "no_text_back" });
  });

  it("subscribes the robot's sink to voicemail.received before dialing, or blames the rig", async () => {
    const world = s04World();
    expect((await S04.run(world.ctx)).outcome).toBe("pass");
    expect(world.app.webhooks.get("qa-w-owner")).toEqual(["voicemail.received"]);
    const unnamed = s04World();
    unnamed.app.webhookRefusal = "the store has no robot-webhook-secret";
    await expect(S04.run(unnamed.ctx)).resolves.toMatchObject({ outcome: "infra", component: "webhook-endpoint" });
    expect(unnamed.robot.plans).toEqual([]);
  });
});

describe(wordErrorRate, () => {
  it("counts substitutions, insertions and deletions over the reference", () => {
    expect(wordErrorRate("the water heater", "the water heater")).toBe(0);
    expect(wordErrorRate("the water heater", "the hot water heater")).toBeCloseTo(1 / 3);
    expect(wordErrorRate("call me back on Tuesday", "call back Tuesday")).toBeCloseTo(2 / 5);
    expect(wordErrorRate("Hello, there!", "hello there")).toBe(0);
  });
});
