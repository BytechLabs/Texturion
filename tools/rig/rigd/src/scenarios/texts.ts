/**
 * The text scenarios that need no hardware: S20, S21, S23,
 * S24 and S25. Every body carries the attempt's nonce, so a check never
 * matches a text from another run.
 */
import { fail, infra, pass, poll, type ScenarioContext, type ScenarioResult, type ScenarioRunner } from "./context.ts";

/** Every rig number has an Ontario area code, so the destination's clock is Toronto's. */
const DESTINATION_ZONE = "America/Toronto";

/** The robot's sink must be a webhook endpoint of the workspace before its events can arrive there. */
async function robotWebhook(ctx: ScenarioContext, member: string, events: string[]): Promise<ScenarioResult | undefined> {
  try {
    await ctx.app.ensureRobotWebhook({ member, events });
    return undefined;
  } catch (error) {
    return infra("webhook-endpoint", `the robot's webhook endpoint could not be set up: ${(error as Error).message}`);
  }
}

/** Outbound text: exact body within 30 s, sent then delivered, usage row, meter, `message.sent` webhook. */
export const S20: ScenarioRunner = {
  id: "S20",
  async run(ctx) {
    const unset = await robotWebhook(ctx, "qa-w-owner", ["message.sent"]);
    if (unset) return unset;
    const since = ctx.now();
    const body = `Rig S20 outbound ${ctx.nonce}`;
    const sent = await ctx.app.sendText({ member: "qa-w-owner", fromRole: "DEV-W1", toRole: "ROBOT-1", body });
    if (!sent.ok) return fail("send_refused", `the API refused the send with ${sent.status}${sent.code ? ` ${sent.code}` : ""}`);
    ctx.evidence.message_id = sent.messageId;

    const arrived = await poll(ctx, async () => {
      const inbox = await ctx.robot.inbox({ to_role: "ROBOT-1", since });
      return inbox.find((m) => m.event === "message.received" && m.text === body);
    }, 30_000);
    if (!arrived) return fail("not_delivered", "ROBOT-1 did not receive the exact body within 30 s");
    if (arrived.from_role !== "DEV-W1") return fail("wrong_sender", `arrived from ${arrived.from_role}, not DEV-W1`);

    const statuses: string[] = [];
    const final = await poll(ctx, async () => {
      const [row] = await ctx.app.messages({ tenant: "QA-W", body, since });
      if (row?.status && statuses.at(-1) !== row.status) statuses.push(row.status);
      return row?.status === "delivered" || row?.status === "failed" ? row : undefined;
    }, 60_000);
    ctx.evidence.statuses = statuses;
    if (!final) return fail("status_stuck", `status stopped at ${statuses.at(-1) ?? "nothing"}`);
    if (final.status !== "delivered") return fail("status_failed", `ended ${final.status} (${final.error_code ?? "no code"})`);
    if (statuses.some((s) => !["queued", "sending", "sent", "delivered"].includes(s))) {
      return fail("status_order", `went ${statuses.join(" > ")}`);
    }

    const usage = await poll(ctx, async () => {
      const rows = await ctx.app.usageFor(sent.messageId);
      return rows.length > 0 ? rows : undefined;
    }, 30_000);
    if (!usage) return fail("no_usage_row", "no usage row for the message");
    const metered = await poll(ctx, async () => {
      const rows = await ctx.app.usageFor(sent.messageId);
      return rows.find((r) => r.stripe_reported_at !== null);
    }, 120_000, 5_000);
    if (!metered) return fail("meter_not_reported", "the usage row was never reported to the sandbox meter");

    const webhook = await poll(ctx, async () => {
      const deliveries = await ctx.robot.sink({ since, type: "message.sent" });
      return deliveries.find((d) => d.body.includes(sent.messageId));
    }, 60_000, 2_000);
    if (!webhook) return fail("webhook_missing", "no message.sent webhook for the message at the robot's sink");
    return pass();
  },
};

/** Inbound text: threaded once within 15 s, realtime in the page, a push-attempt row. */
export const S21: ScenarioRunner = {
  id: "S21",
  async run(ctx) {
    const page = await ctx.browser.open("qa-w-owner", "qa-w-owner", "/inbox");
    // A push attempt needs somewhere to push to; the owner's browser
    // subscribes through the app's own control when nothing else has.
    if ((await ctx.app.pushTargets({ member: "qa-w-owner" })) === 0) {
      if (!(await page.enablePush())) {
        return infra("push-target", "qa-w-owner has no push subscription or device token, and the browser could not subscribe");
      }
      const saved = await poll(ctx, async () => (await ctx.app.pushTargets({ member: "qa-w-owner" })) > 0, 10_000);
      if (!saved) return fail("push_subscription_not_saved", "the page subscribed to push but the API kept no subscription");
    }
    const since = ctx.now();
    const body = `Rig S21 inbound ${ctx.nonce}`;
    await ctx.robot.sms({ from_role: "ROBOT-1", to_role: "DEV-W1", text: body, scenario: ctx.scenario });

    const shown = page.waitForText(body, 15_000);
    const threaded = await poll(ctx, async () => {
      const rows = await ctx.app.messages({ tenant: "QA-W", body, since });
      return rows.length > 0 ? rows : undefined;
    }, 15_000);
    if (!threaded) return fail("not_threaded", "the text was not threaded within 15 s");
    // A duplicate shows up as the webhook's retry, seconds later.
    await ctx.sleep(5_000);
    const rows = await ctx.app.messages({ tenant: "QA-W", body, since });
    ctx.evidence.rows = rows.length;
    if (rows.length !== 1) return fail("threaded_twice", `threaded ${rows.length} times`);
    if (rows[0]!.direction !== "inbound") return fail("wrong_direction", `threaded as ${rows[0]!.direction}`);
    if (!(await shown)) return fail("no_realtime_update", "the owner's page did not show the text within 15 s");

    const push = await poll(ctx, async () => {
      const attempts = await ctx.app.pushAttempts({ tenant: "QA-W", since });
      return attempts.length > 0 ? attempts : undefined;
    }, 30_000, 2_000);
    if (!push) return fail("no_push_attempt", "no push attempt was recorded for the inbound text");
    ctx.evidence.push = push.map((p) => ({ purpose: p.purpose, platform: p.platform, response: p.response_class }));
    return pass();
  },
};

/** Loonext texts Loonext: both workspaces thread it, both ways, with no 40007 loop error. */
export const S23: ScenarioRunner = {
  id: "S23",
  async run(ctx) {
    const legs = [
      { member: "qa-w-owner", from: "DEV-W1", to: "DEV-E1", sender: "QA-W", receiver: "QA-E" },
      { member: "qa-e-owner", from: "DEV-E1", to: "DEV-W1", sender: "QA-E", receiver: "QA-W" },
    ];
    for (const leg of legs) {
      const since = ctx.now();
      const body = `Rig S23 ${leg.from} to ${leg.to} ${ctx.nonce}`;
      const sent = await ctx.app.sendText({ member: leg.member, fromRole: leg.from, toRole: leg.to, body });
      if (!sent.ok) return fail("send_refused", `${leg.from} to ${leg.to} refused with ${sent.status}`);
      const received = await poll(ctx, async () => {
        const rows = await ctx.app.messages({ tenant: leg.receiver, body, since });
        return rows.find((r) => r.direction === "inbound");
      }, 30_000);
      if (!received) return fail("not_threaded", `${leg.receiver} never threaded the text from ${leg.from}`);
      const [outbound] = await ctx.app.messages({ tenant: leg.sender, body, since });
      if (outbound?.error_code === "40007") return fail("loop_error_40007", `${leg.from} to ${leg.to} failed with 40007`);
      if (outbound?.status === "failed") return fail("send_failed", `${leg.from} to ${leg.to} failed (${outbound.error_code ?? "no code"})`);
    }
    return pass();
  },
};

/**
 * STOP, START, HELP, ARRET, AIDE and a plain-English opt-out, from ROBOT-2 to
 * DEV-E1 only. Only ROBOT-2 ever sends STOP, and the undo that lifts it is
 * registered before the STOP is sent, so even a run killed mid-way leaves no
 * opt-out behind.
 */
export const S24: ScenarioRunner = {
  id: "S24",
  async run(ctx) {
    ctx.lease.registerUndo({ kind: "robot.sms", params: { from_role: "ROBOT-2", to_role: "DEV-E1", text: "START" } });
    const send = (text: string) => ctx.robot.sms({ from_role: "ROBOT-2", to_role: "DEV-E1", text, scenario: ctx.scenario, lease_id: ctx.lease.id });
    const optedOut = (active: boolean) =>
      poll(ctx, async () => {
        const row = await ctx.app.optOut({ tenant: "QA-E", role: "ROBOT-2" });
        return (row?.active ?? false) === active ? true : undefined;
      }, 30_000);
    const helpReply = async (since: number) =>
      poll(ctx, async () => {
        const inbox = await ctx.robot.inbox({ to_role: "ROBOT-2", since });
        return inbox.find((m) => m.event === "message.received" && m.from_role === "DEV-E1");
      }, 30_000);

    await send("STOP");
    if (!(await optedOut(true))) return fail("stop_not_recorded", "STOP did not record an opt-out within 30 s");

    const afterStop = ctx.now();
    const refused = await ctx.app.sendText({
      member: "qa-e-owner",
      fromRole: "DEV-E1",
      toRole: "ROBOT-2",
      body: `Rig S24 after STOP ${ctx.nonce}`,
    });
    if (refused.ok) return fail("sent_after_stop", "the API sent a text to an opted-out number");
    await ctx.sleep(10_000);
    if ((await ctx.robot.inbox({ to_role: "ROBOT-2", since: afterStop })).length > 0) {
      return fail("sent_after_stop", "ROBOT-2 received a text while opted out");
    }

    // D38: an opt-out stops texts, never calls.
    const page = await ctx.browser.open("qa-e-owner", "emulator", "/calls");
    const expected = await ctx.robot.expect({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "inbound",
      role: "ROBOT-2",
      answer_after_ms: 3_000,
      expect_within_ms: 60_000,
      record: false,
      hangup_after_ms: 20_000,
    });
    await page.dial("ROBOT-2");
    const call = await ctx.robot.wait(expected.plan_id, 120_000);
    ctx.evidence.call = { ids: call.ids, state: call.state, answered_at: call.answered_at, rtp: call.rtp };
    if (!call.answered_at) return fail("call_blocked_by_opt_out", `the call to ROBOT-2 never connected (${call.errors.join("; ") || call.state})`);

    const steps: [string, (sentAt: number) => Promise<string | undefined>][] = [
      ["START", async () => ((await optedOut(false)) ? undefined : "start_not_recorded")],
      ["HELP", async (sentAt) => ((await helpReply(sentAt)) ? undefined : "no_help_reply")],
      ["ARRET", async () => ((await optedOut(true)) ? undefined : "arret_not_recorded")],
      ["START", async () => ((await optedOut(false)) ? undefined : "start_not_recorded")],
      ["AIDE", async (sentAt) => ((await helpReply(sentAt)) ? undefined : "no_aide_reply")],
    ];
    for (const [keyword, check] of steps) {
      const sentAt = ctx.now();
      await send(keyword);
      const failure = await check(sentAt);
      if (failure) return fail(failure, `after ${keyword}`);
    }

    await send(`Please stop texting me ${ctx.nonce}`);
    const hinted = await poll(ctx, () => ctx.app.optOutHint({ tenant: "QA-E", role: "ROBOT-2" }), 30_000);
    if (!hinted) return fail("plain_english_not_flagged", "the plain-English opt-out was not flagged on the thread");
    if ((await ctx.app.optOut({ tenant: "QA-E", role: "ROBOT-2" }))?.active) {
      return fail("plain_english_opted_out", "a plain-English request opted the number out; only a keyword may");
    }
    return pass();
  },

  /** After the undo has run, whatever the run came to: a STOP left in place is critical. */
  async afterRelease(ctx) {
    const lifted = await poll(ctx, async () => {
      const current = await ctx.app.optOut({ tenant: "QA-E", role: "ROBOT-2" });
      return !current?.active;
    }, 60_000, 2_000);
    return lifted ? undefined : fail("stop_left_in_place", "ROBOT-2 is still opted out of DEV-E1 after cleanup", { critical: true });
  },
};

/**
 * Automated texts and quiet hours: by day they arrive, at night they are held
 * (the destination's clock, Ontario). The registry runs it twice a week, a
 * daytime run and a night run, so both halves are exercised. Not in RUNNERS
 * until the app probe can arm the automations.
 */
export const S25: ScenarioRunner = {
  id: "S25",
  async run(ctx) {
    const night = isQuietHour(ctx.now());
    ctx.evidence.mode = night ? "night" : "day";
    ctx.lease.registerUndo({ kind: "app.disarm-automations", params: { tenant: "QA-W", nonce: ctx.nonce } });
    try {
      await ctx.app.armAutomations({ tenant: "QA-W", toRole: "ROBOT-1", nonce: ctx.nonce });
    } catch (error) {
      return infra("app-probe", `arming the automations failed: ${(error as Error).message}`);
    }
    const since = ctx.now();
    await ctx.robot.sms({ from_role: "ROBOT-1", to_role: "DEV-W1", text: `Rig S25 ${ctx.nonce}`, scenario: ctx.scenario });
    await ctx.sleep(60_000);

    const texts = await ctx.app.automatedTexts({ tenant: "QA-W", nonce: ctx.nonce });
    const inbox = await ctx.robot.inbox({ to_role: "ROBOT-1", since });
    const arrived = (body: string) => inbox.some((m) => m.text === body);
    ctx.evidence.texts = texts.map((t) => ({ kind: t.kind, state: t.state, arrived: arrived(t.body) }));
    if (texts.length === 0) return infra("app-probe", "no automated texts were armed");
    if (night) {
      const leaked = texts.filter((t) => t.state !== "held" || arrived(t.body));
      if (leaked.length) return fail("sent_in_quiet_hours", `sent at night: ${leaked.map((t) => t.kind).join(", ")}`);
    } else {
      const missing = texts.filter((t) => t.state !== "sent" || !arrived(t.body));
      if (missing.length) return fail("not_sent_by_day", `did not arrive by day: ${missing.map((t) => t.kind).join(", ")}`);
    }
    return pass();
  },
};

/** D4, as apps/api/src/messaging/destination-clock.ts holds them: 20:00 is quiet, 08:00 is not. */
export const QUIET_HOURS_START = 20;
export const QUIET_HOURS_END = 8;

/** Whether the destination's clock is in quiet hours. */
export function isQuietHour(at: number): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: DESTINATION_ZONE, hour: "numeric", hourCycle: "h23" }).format(at));
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}
