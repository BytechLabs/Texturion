/**
 * #387 — the checker half of the liveness primitive.
 *
 * Split from liveness.ts on purpose: the declarations and `recordHeartbeat`
 * have no business importing the email sender, and `email/resend.ts` records
 * its own heartbeat. Keeping the alert path in a separate module is what makes
 * that a straight line rather than an import cycle.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import { emailLayout, escapeHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { canaryConfig } from "./inbound-canary";
import {
  LIVENESS_EXPECTATIONS,
  type LivenessExpectation,
  recordHeartbeatBestEffort,
} from "./liveness";

/** How long an alerting key waits before it shouts again. */
const REALERT_AFTER_MINUTES = 360;

/**
 * How far back the outbound-text probe looks.
 *
 * The SMS channel is probed from the messages table rather than recorded on
 * the send path, because a heartbeat write per text would put a database
 * round-trip on the hot path of every inbound webhook to learn something one
 * query an hour answers just as well. Email is the other way round — it is
 * low volume and has no table to read, so `sendEmail` records its own.
 */
const SMS_PROBE_WINDOW_MINUTES = 60;

/**
 * #510 — how far back we look to decide the platform is normally BUSY.
 *
 * Reported by the founder: "I keep getting emails like this but what do I
 * do?? there is nothing actionable?" — about this exact expectation, whose own
 * text reads "Either nobody is texting, or sending is broken and every
 * workspace is silent."
 *
 * That sentence is the bug. An alarm that cannot tell the benign cause from the
 * emergency is not an alarm, and on a platform with a handful of workspaces the
 * benign cause is the ordinary state of a weekday evening. It fired every six
 * hours, forever, and taught its only reader to delete it — which is the
 * failure `activation-stall.ts` names in its own comments: "an alarm that fires
 * on the normal case is an alarm nobody reads".
 *
 * So silence is only news if the platform is usually noisy. If nothing has been
 * sent in a WEEK either, there is no anomaly to report: this is a quiet
 * platform, not a broken one, and the founder already knows how many customers
 * they have. The moment real traffic exists, an hour of silence becomes
 * meaningful again on its own — with no flag to remember to flip.
 */
const SMS_BASELINE_WINDOW_DAYS = 7;

interface OverdueRow {
  key: string;
  what: string;
  last_seen_at: string;
  due_by: string;
  first_alert: boolean;
}

/**
 * The checker. Compares every declared expectation against the ledger and
 * emails the founder about anything overdue.
 *
 * Runs on the 15-minute trigger rather than its own: a checker with its own
 * schedule is one more thing that can quietly stop, and the schedule it rides
 * on is itself watched by the very table it is reading.
 */
export async function runLivenessCheckJob(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<{ overdue: number; seeded: number }> {
  await probeOutboundSms(env, now, db);
  await probeInboundWebhooks(env, now, db);

  // #308: the canary's expectation exists only when the canary does. Declaring
  // it unconditionally would alert every six hours, forever, about a feature
  // nobody switched on — the same phantom-alert failure the "cron that no
  // longer exists" test guards against, arriving from the other direction.
  const canaryOff = canaryConfig(env) === null;
  // #375: same posture for the DO alert channel. Without the CALL_SESSIONS
  // binding there is no Durable Object runtime to answer for, so an
  // expectation about it would be an alert about something not deployed.
  const doCanaryOff = !env.CALL_SESSIONS;
  const expectations = Object.entries(LIVENESS_EXPECTATIONS)
    .filter(([key]) => !(canaryOff && key === "channel:inbound-canary"))
    .filter(([key]) => !(doCanaryOff && key === "channel:do-sentry"))
    .map(([key, spec]) => ({
      key,
      what: spec.what,
      every_minutes: spec.everyMinutes,
      grace_minutes: spec.graceMinutes,
    }));

  const { data, error } = await db.rpc("api_liveness_check", {
    p_expectations: expectations,
    p_now: now.toISOString(),
    p_realert_after_minutes: REALERT_AFTER_MINUTES,
  });
  if (error) throw new Error(`api_liveness_check failed: ${error.message}`);

  const result = (data ?? {}) as { overdue?: OverdueRow[]; seeded?: string[] };
  const overdue = result.overdue ?? [];
  const seeded = result.seeded ?? [];

  if (overdue.length > 0) {
    await sendOverdueAlert(env, overdue, now);
  }
  return { overdue: overdue.length, seeded: seeded.length };
}

/**
 * The remediation for an overdue key, read from the DECLARATION.
 *
 * Not from the alert row: `api_liveness_check` echoes back only the fields it
 * was passed for its own arithmetic, and widening that RPC would put a second
 * copy of this sentence in SQL — a copy that drifts, and the migration comment
 * on that function refuses exactly that ("the code declares expectations"). The
 * key is the join, and it is a compile-time table, so the lookup costs nothing.
 */
function doThisFor(key: string): string {
  // Narrowed to the one field this reads, and derived from the interface so a
  // rename over there breaks HERE rather than silently falling through to the
  // message below. `row.key` is a plain string off an RPC, so the lookup has to
  // tolerate a miss even though the checker only ever asks about what it sent.
  const declared = LIVENESS_EXPECTATIONS as Record<
    string,
    Partial<Pick<LivenessExpectation, "doThis">> | undefined
  >;
  return (
    declared[key]?.doThis ??
    // Unreachable in practice — the checker only asks about keys it declared —
    // and deliberately blames the alert rather than the reader if it ever is.
    `No action is declared for "${key}", so this alert is itself the bug: it is ` +
      `not in LIVENESS_EXPECTATIONS. Add it there or stop sending this.`
  );
}

async function sendOverdueAlert(
  env: Env,
  overdue: OverdueRow[],
  now: Date,
): Promise<void> {
  const items = overdue.map((row) => ({
    ...row,
    minutes: Math.round(
      (now.getTime() - new Date(row.last_seen_at).getTime()) / 60000,
    ),
    doThis: doThisFor(row.key),
  }));

  // #510: the remedy gets its OWN line and its own label, never a clause
  // appended to `what`. The founder's complaint was not that the sentence was
  // too short — it was that the email ended on the diagnosis, so the reader had
  // to supply the next step themselves at whatever hour it arrived. Last in the
  // block on purpose: the diagnosis is what you read, the remedy is what you
  // are left holding.
  const lines = items
    .map(
      (row) =>
        `• ${row.key}\n` +
        `  ${row.what}\n` +
        `  Last seen ${row.minutes} min ago (due by ${row.due_by}).\n` +
        `  → DO THIS: ${row.doThis}`,
    )
    .join("\n\n");

  const closing =
    `You will get one more of these in ${REALERT_AFTER_MINUTES / 60}h if it ` +
    `is still overdue, and nothing at all once it recovers.`;

  const text =
    `${overdue.length} expected thing(s) have not happened.\n\n${lines}\n\n` +
    `Nothing threw. These are absences, which is why Sentry is quiet: the ` +
    `carrier accepts and drops, the mailbox bounces after we were told 200, ` +
    `the cron simply does not fire. Silence and health look identical from ` +
    `here, which is the whole reason this check exists (#387).\n\n` +
    closing;

  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: `[ops] ${overdue.length} expected thing(s) did not happen`,
    text,
    html: emailLayout(
      `<p><strong>${overdue.length} expected thing(s) have not happened.</strong></p>` +
        items.map(overdueCardHtml).join("") +
        `<p style="font-size:13px;line-height:1.5;color:#6E7163;">${escapeHtml(closing)}</p>`,
    ),
  });
}

/**
 * One overdue key as a card, rather than a line of a <pre> dump.
 *
 * The old HTML body was the plain-text block verbatim inside a <pre>, which
 * gave the key, the diagnosis and the timestamp identical weight — and would
 * have given the remedy that same weight, i.e. made it read as a fourth
 * undifferentiated line, which is the one thing #510 says it must not do.
 *
 * So the two groups are separated visually as well as textually: the diagnosis
 * is tight (key, sentence, staleness, 4px apart — one semantic unit), and the
 * remedy sits in its own tinted, olive-ruled block after a real gap. Tables and
 * inline styles only, because Gmail and Outlook strip <style> blocks.
 */
const MONO_STACK = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/**
 * Render the `backticked` identifiers in a remedy as actual monospace.
 *
 * Every `doThis` names the specific thing to look at — a log line to search, a
 * column to read, an environment variable to compare — and marks it with
 * backticks so the plain-text body sets it apart. Left alone in the HTML those
 * become literal backticks, i.e. markdown that visibly failed to render, in the
 * body the founder actually opens. Worse than ugly: the identifier is the part
 * that has to be copied exactly, and it is the part the eye has to find.
 *
 * Runs AFTER escaping, which is safe in that order and only in that order:
 * `escapeHtml` neutralises `&<>` and leaves backticks alone, so nothing in the
 * text can forge the tags this adds. Unpaired backticks are left as-is rather
 * than swallowing the rest of the sentence into a code span.
 */
function withCodeSpans(escaped: string): string {
  return escaped.replaceAll(
    /`([^`]+)`/g,
    (_match, code: string) =>
      `<code style="font-family:${MONO_STACK};font-size:0.92em;background-color:#E7E8E0;padding:1px 4px;border-radius:3px;">${code}</code>`,
  );
}

function overdueCardHtml(row: {
  key: string;
  what: string;
  due_by: string;
  minutes: number;
  doThis: string;
}): string {
  const mono = MONO_STACK;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 22px 0;">` +
    `<tr><td style="padding:0 0 4px 0;font-family:${mono};font-size:13px;line-height:1.4;color:#6E7163;">${escapeHtml(row.key)}</td></tr>` +
    `<tr><td style="padding:0 0 4px 0;font-size:16px;line-height:1.5;color:#191B14;">${escapeHtml(row.what)}</td></tr>` +
    `<tr><td style="padding:0 0 10px 0;font-size:13px;line-height:1.4;color:#6E7163;">Last seen ${row.minutes} min ago — due by ${escapeHtml(row.due_by)}.</td></tr>` +
    // #3A430F on this tint, not the #66801F wordmark olive: the label is 11px,
    // where the bar is 4.5:1, and olive does not clear it (the same split
    // email/html.ts makes for links versus the wordmark).
    `<tr><td style="padding:10px 14px;background-color:#F3F3EE;border-left:3px solid #66801F;">` +
    `<div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#3A430F;padding:0 0 3px 0;">Do this</div>` +
    `<div style="font-size:15px;line-height:1.5;color:#191B14;">${withCodeSpans(escapeHtml(row.doThis))}</div>` +
    `</td></tr></table>`
  );
}

/**
 * Did any workspace successfully send a text in the window?
 *
 * Platform-wide and deliberately not per-tenant: one plumber having a quiet
 * afternoon is not a signal, and alerting per workspace would turn a real
 * outage into a hundred emails. What this catches is the case where sending is
 * broken for EVERYBODY and every inbox is silent — the failure that looks
 * exactly like a slow week from the inside.
 *
 * Reads `status`, not merely the row: a message we queued and never handed to
 * the carrier is not evidence that sending works. It is the opposite.
 */
async function probeOutboundSms(
  env: Env,
  now: Date,
  db: SupabaseClient,
): Promise<void> {
  const since = new Date(now.getTime() - SMS_PROBE_WINDOW_MINUTES * 60_000);
  const { data, error } = await db
    .from("messages")
    .select("id")
    .eq("direction", "outbound")
    .in("status", ["sent", "delivered"])
    .gte("created_at", since.toISOString())
    .limit(1);
  if (error) {
    // The probe itself failing is not proof the channel is down, so it must
    // not record a heartbeat AND must not claim an outage. Leaving the ledger
    // untouched lets the absence speak for itself one cadence later.
    console.error(`liveness: outbound SMS probe failed: ${error.message}`);
    return;
  }
  if ((data ?? []).length > 0) {
    await recordHeartbeatBestEffort(env, "channel:sms-outbound", now, db);
    return;
  }

  // #510: nothing in the last hour. Before calling that an outage, ask whether
  // this platform sends anything at all.
  const baselineSince = new Date(
    now.getTime() - SMS_BASELINE_WINDOW_DAYS * 24 * 60 * 60_000,
  );
  const baseline = await db
    .from("messages")
    .select("id")
    .eq("direction", "outbound")
    .in("status", ["sent", "delivered"])
    .gte("created_at", baselineSince.toISOString())
    .limit(1);
  if (baseline.error) {
    // Same posture as the probe above: a failed read is not proof of anything,
    // so leave the ledger alone and let the next cadence decide.
    console.error(
      `liveness: outbound SMS baseline failed: ${baseline.error.message}`,
    );
    return;
  }
  if ((baseline.data ?? []).length === 0) {
    // A week of silence means the platform is quiet, not broken. Heartbeat it
    // so the expectation stays satisfied — the alert exists to catch sending
    // STOPPING, and nothing has stopped that ever started.
    //
    // This is not a snooze. The instant one text goes out, the hourly window
    // becomes meaningful again by itself.
    await recordHeartbeatBestEffort(env, "channel:sms-outbound", now, db);
  }
}

/**
 * How far back the inbound probe looks.
 *
 * Wider than the outbound window because it feeds keys with much wider graces
 * (see the #308 block in `liveness.ts`) — the window only has to be long
 * enough that an ordinary lull does not read as an absence; the grace is what
 * decides when we actually shout.
 */
const INBOUND_PROBE_WINDOW_MINUTES = 180;

interface InboundProbe {
  inbound_message?: number;
  message_status?: number;
  call_event?: number;
  telnyx_accepted?: number;
  rejections?: Record<string, number>;
}

/**
 * #308 — the inbound half. One RPC, four heartbeats.
 *
 * Probed from `webhook_events` rather than heartbeat-written per delivery, for
 * the reason the outbound probe gives: a liveness write on the hottest path in
 * the product to learn something one query per cadence answers just as well.
 *
 * Per event class, because messages, statuses and call events are separate
 * paths that fail independently — "message webhooks fine, call webhooks dead"
 * is a real shape, and nobody would notice until somebody missed a call.
 *
 * The fourth heartbeat is the signature conjunction, and it is the sharp one:
 * rejections alone are noise, rejections with zero acceptances is a rotated
 * secret. Recorded while HEALTHY so its ABSENCE is the alarm, which is the
 * only formulation that stays quiet on a platform with no traffic at all.
 */
async function probeInboundWebhooks(
  env: Env,
  now: Date,
  db: SupabaseClient,
): Promise<void> {
  const since = new Date(now.getTime() - INBOUND_PROBE_WINDOW_MINUTES * 60_000);
  const { data, error } = await db.rpc("api_webhook_inbound_probe", {
    p_since: since.toISOString(),
    p_now: now.toISOString(),
  });
  if (error) {
    // The probe failing is not proof the channel is down, so it records
    // nothing and claims nothing — the absence speaks for itself one cadence
    // later. Same posture as the outbound probe above.
    console.error(`liveness: inbound webhook probe failed: ${error.message}`);
    return;
  }
  const probe = (data ?? {}) as InboundProbe;

  if ((probe.inbound_message ?? 0) > 0) {
    await recordHeartbeatBestEffort(env, "channel:telnyx-inbound-message", now, db);
  }
  if ((probe.message_status ?? 0) > 0) {
    await recordHeartbeatBestEffort(env, "channel:telnyx-message-status", now, db);
  }
  if ((probe.call_event ?? 0) > 0) {
    await recordHeartbeatBestEffort(env, "channel:telnyx-call-events", now, db);
  }

  // The conjunction. Healthy is everything EXCEPT "we rejected signed
  // deliveries and accepted none of them", so a quiet window with no
  // rejections at all is healthy — it has to be, or this alerts on every
  // platform that is simply idle.
  const rejected = Object.values(probe.rejections ?? {}).reduce(
    (total, n) => total + (Number(n) || 0),
    0,
  );
  const discardingEverything = rejected > 0 && (probe.telnyx_accepted ?? 0) === 0;
  if (!discardingEverything) {
    await recordHeartbeatBestEffort(env, "channel:webhook-signature", now, db);
  }
}
