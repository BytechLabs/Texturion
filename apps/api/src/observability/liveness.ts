/**
 * #387 — the capability to notice that an expected thing did NOT happen.
 *
 * Sentry answers "what threw?". Nine open issues share a different shape: the
 * carrier accepted the message and dropped it, Resend accepted the request and
 * the mailbox bounced it, the cron simply did not fire. Nothing throws, because
 * the defining characteristic is that nothing occurred — and silence reads
 * exactly like health.
 *
 * ONE mechanism, not nine detectors. Everything here is a heartbeat:
 *
 *   - a CRON records its heartbeat by firing. `scheduled()` in index.ts is the
 *     single choke point every trigger passes through, so this cannot be
 *     forgotten per-job the way a convention would be.
 *   - a DELIVERY CHANNEL gets its heartbeat either from a probe the checker
 *     runs or from the send path itself. Same ledger, same alert path — a
 *     probe is just a heartbeat somebody else observes.
 *
 * DECLARATION IS MANDATORY AT THE POINT OF DEFINITION, and the compiler is
 * what enforces it: `CronSchedule` below is derived from the `cron:` keys of
 * this table, and `CRON_JOBS` in index.ts is typed by it. A schedule added to
 * wrangler.jsonc without an expectation here does not typecheck. That is the
 * same structural move as `AiFeatureSpec.key` being typed to priced keys — the
 * guard lives where the thing is declared, never in a doc somebody must
 * remember (#377, #380, #385).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";

export interface LivenessExpectation {
  /** One sentence, in the alert's voice: what did not happen. */
  what: string;
  /**
   * One or two sentences, in the reader's voice: what to DO about it.
   *
   * #510, reported by the founder about three of these emails at once: "I keep
   * getting emails like this but what do I do?? there is nothing actionable?"
   * Every key said what had not happened and not one said what came next, so
   * the only move this mailbox ever taught was to delete it — and an alert
   * channel nobody opens is worse than no channel, because it is still
   * believed to be working.
   *
   * The reader is ONE person, on a phone, possibly at 3am, who did not write
   * this alert today. So it must name a CONCRETE first move: a URL to open, a
   * dashboard path, a log line to search, a query to run, a specific thing
   * whose state answers the question. "Investigate the issue" and "check the
   * logs" are the complaint restated — they fit all ~76 keys here, and that is
   * exactly what makes them worthless.
   *
   * If a key genuinely has no action — informational, or self-clearing — SAY
   * SO ("Nothing to do; it clears when X"). That is actionable: it tells the
   * reader to close the email, which is the decision they were trying to make.
   *
   * REQUIRED, not optional, and the requiredness is the whole mechanism. An
   * optional field is how the next alert ships unactionable: it would be
   * skipped by exactly the person in a hurry whose key most needs it. Declaring
   * an expectation without an answer to "what do I do??" does not compile — the
   * same point-of-definition guard `CronSchedule` already applies to the
   * schedules themselves.
   */
  doThis: string;
  /** How often this is supposed to occur, at minimum. */
  everyMinutes: number;
  /**
   * How long past the cadence before we shout.
   *
   * Per-expectation because a once-a-minute sweeper and a once-a-day reconcile
   * do not deserve the same patience, and because a grace that is too tight
   * produces false alarms — which cost more than the outage, since they are
   * how a founder learns to ignore this mailbox.
   */
  graceMinutes: number;
}

/**
 * Every liveness key in the product.
 *
 * `cron:` keys mirror wrangler.jsonc exactly. `channel:` keys are the two
 * delivery paths #387 names, and they are observed differently on purpose:
 *
 *   - SMS is PROBED from the messages table by the checker. A heartbeat write
 *     per text would put a database round-trip on the hot path of every
 *     inbound webhook, to learn something one query an hour answers just as
 *     well.
 *   - EMAIL is RECORDED by `sendEmail` itself, because it is low volume and
 *     there is no table to read — nothing anywhere records that an email was
 *     sent, which is half of why #386 can happen at all.
 *
 * Both land in the same ledger and the same alert path. The asymmetry is in
 * how the occurrence is observed, never in what it means.
 */
export const LIVENESS_EXPECTATIONS = {
  // -------------------------------------------------------------------------
  // A NOTE ON EVERY `cron:` doThis BELOW, so none of them has to repeat it.
  //
  // `scheduled()` records these BEFORE running a single job and regardless of
  // whether any of them throws (index.ts). So an overdue `cron:` key never
  // means "a job is broken" — that is what the `job:` keys are for. It means
  // exactly one of: the trigger did not fire, env validation threw before the
  // heartbeat (which `GET https://api.loonext.com/health` reproduces and names
  // the missing secret for), or the heartbeat write itself failed.
  //
  // Triggers are registered by `wrangler deploy` alone — there is no dashboard
  // schedule step (docs/deploy/vendor-cron-triggers.md) — and Cloudflare →
  // loonext-api → Triggers → Cron Triggers lists every expression with its
  // last-run status. That pair is the first move for most of these.
  // -------------------------------------------------------------------------
  "cron:* * * * *": {
    what: "The unanswered-lead escalation scan (#388) has not run.",
    doThis:
      "Count the other `cron:` lines in this email before anything else. This " +
      "is the finest trigger in the product, so if its siblings are here too " +
      "the Worker is the fault and not one expression — open " +
      "https://api.loonext.com/health, which re-runs env validation and names " +
      "the secret if one went missing. Alone, it is a single unregistered " +
      "trigger: check Cloudflare → loonext-api → Triggers → Cron Triggers, and " +
      "redeploy the API, which re-registers the whole set.",
    everyMinutes: 1,
    graceMinutes: 20,
  },
  "cron:*/5 * * * *": {
    what: "The webhook sweeper has not run — unprocessed provider webhooks are not being replayed.",
    doThis:
      "Do not replay anything by hand: every job on this trigger selects its " +
      "work by STATE (webhook_events still unprocessed, outbound rows queued " +
      "with no telnyx_message_id), so the whole backlog drains on the first " +
      "run after it comes back. Just get it firing — Cloudflare → loonext-api " +
      "→ Triggers → Cron Triggers. If it IS firing there, the schedule is fine " +
      "and the heartbeat write is what failed: search Workers Logs for " +
      "`liveness: heartbeat cron:*/5`.",
    everyMinutes: 5,
    graceMinutes: 25,
  },
  "cron:*/15 * * * *": {
    what: "Provisioning retry, reconcile and due-task reminders have not run.",
    doThis:
      "This one is self-answering: the email you are reading was sent by a job " +
      "riding this very trigger, so the schedule IS firing and only its " +
      "heartbeat write failed. Search Workers Logs for `liveness: heartbeat " +
      "cron:*/15 * * * * failed to record` and treat it as a Supabase / " +
      "record_heartbeat fault, not a cron one. If it does not repeat on the " +
      "next run, nothing to do.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "cron:0 * * * *": {
    what: "The hourly usage re-reporter has not run — usage is not reaching Stripe.",
    doThis:
      "Revenue, but nothing is lost yet and nothing should be sent to Stripe " +
      "by hand: the re-reporters select usage_events with stripe_reported_at " +
      "IS NULL and catch up 200 rows a run, so the backlog bills itself once " +
      "the trigger returns. Restore it (Cloudflare → loonext-api → Triggers → " +
      "Cron Triggers), then watch that unreported count fall over the next few " +
      "hours — if it does not fall, the fault is Stripe rather than the cron, " +
      "and `job:report-usage:work` will say so in its own alert.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "cron:30 * * * *": {
    what: "The sole-proprietor OTP nudge has not run.",
    doThis:
      "This one has somebody else's deadline on it: the sole-prop OTP window " +
      "is 24h and the nudge fires at +12h, so half a day of silence here means " +
      "the window closes and the customer must resubmit their brand from " +
      "scratch. Restore the trigger (Cloudflare → loonext-api → Triggers → " +
      "Cron Triggers), then query `messaging_registrations` for sole-prop " +
      "brands still 'submitted' with `otp_nudged_at` null and chase " +
      "those people yourself — the job will still send its nudge when it " +
      "returns, but a nudge after the window closed is worse than none.",
    everyMinutes: 60,
    graceMinutes: 90,
  },
  "cron:20 * * * *": {
    what: "The contact geocoding backfill has not run.",
    doThis:
      "Rank this below every other line in the email: nothing is lost, rows " +
      "simply stay geocode_status 'pending' and the queue drains at 120/hour " +
      "once it is back, so map pins arrive late rather than never. If it is " +
      "the ONLY line here, it is one unregistered expression — Cloudflare → " +
      "loonext-api → Triggers → Cron Triggers, then redeploy the API.",
    everyMinutes: 60,
    graceMinutes: 120,
  },
  "cron:40 * * * *": {
    what: "The task-address geocoding backfill has not run.",
    doThis:
      "First look for `cron:20 * * * *` in this same email. The two geocoders " +
      "are deliberately half an hour apart so they never share a Nominatim " +
      "second, so both being down at once rules the geocoding service out " +
      "entirely and points at the trigger layer (Cloudflare → loonext-api → " +
      "Triggers → Cron Triggers). Alone it is the low-stakes one: tasks pin at " +
      "their contact's address until it runs, and no data is lost.",
    everyMinutes: 60,
    graceMinutes: 120,
  },
  "cron:25 * * * *": {
    what: "The carrier daily-ceiling warning has not run (#457).",
    doThis:
      "The one hourly job whose output EXPIRES, so this is the hourly line to " +
      "act on first. Its advice is 'spread the rest over tomorrow', which is " +
      "worthless once a crew has already hit the ceiling, and the usage_alerts " +
      "ledger is keyed on the UTC day so nobody is warned retroactively. " +
      "Restore the trigger; then, if it was down across a business day, run " +
      "api_daily_outbound for today yourself and phone any crew close to their " +
      "registration's daily limit.",
    everyMinutes: 60,
    graceMinutes: 120,
  },
  "cron:0 13 * * *": {
    what: "The daily registration poller has not run — 10DLC/A2P status is not being reconciled.",
    doThis:
      "Six jobs ride this trigger and it gets one attempt a day — nothing can " +
      "force an extra run, so a fix now still means the next attempt is 13:00 " +
      "UTC tomorrow. The registration poll itself is only the webhook fallback " +
      "and rarely matters; what actually stopped is the five daily watchers " +
      "that run nowhere else (carrier filtering by country, per-number " +
      "reputation, stalled registrations, a workspace's calls going quiet, " +
      "activation stalls) — nobody is watching any of those until it fires " +
      "again. Confirm `0 13 * * *` is listed under Cloudflare → loonext-api → " +
      "Triggers → Cron Triggers and redeploy the API if it is missing.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "cron:10 13 * * *": {
    what: "The daily port reconcile has not run — in-flight number ports are unattended.",
    doThis:
      "Ports run on somebody else's clock — the FOC date the losing carrier " +
      "sets — and this job is only the PORTING.md §5.2 fallback, so a missed " +
      "day costs nothing unless a Telnyx webhook was missed on the same day. " +
      "Rather than waiting for tomorrow's 13:10 UTC run, open any port_requests " +
      "row with an FOC date inside the next two days and compare it against " +
      "the order's real status in the Telnyx portal; then confirm the trigger " +
      "under Cloudflare → loonext-api → Triggers → Cron Triggers.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "cron:0 14 * * *": {
    what: "The daily grace-and-release job has not run.",
    doThis:
      "Nothing here recovers by itself, because this trigger gets one " +
      "attempt a day: the grace ladder warns at day 1, 15 and 27 and " +
      "releases at day 30, and a warning delivered after the release has " +
      "already happened is not a warning. Confirm `0 14 * * *` under " +
      "Cloudflare → loonext-api → Triggers → Cron Triggers and redeploy " +
      "the API if it is missing. Then, before tomorrow's 14:00 UTC run, " +
      "read `companies` in grace and phone anyone whose day-27 or day-30 " +
      "mark fell inside the gap — those are the ones about to lose a " +
      "number without ever being told.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "cron:0 15 * * *": {
    what: "The daily subscription reconcile has not run — billing state may be drifting from Stripe.",
    doThis:
      "Billing drift, and it does self-correct: the reconcile re-mirrors " +
      "every non-active company from Stripe, so one good run fixes " +
      "however many days it missed. Restore the trigger (Cloudflare → " +
      "loonext-api → Triggers → Cron Triggers, then redeploy the API, " +
      "which re-registers the whole set). Until it runs, treat " +
      "subscription state in our database as possibly stale and check " +
      "Stripe directly before acting on it.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "cron:45 15 * * *": {
    what: "The daily opt-out reconciliation against the carrier list has not run (#331).",
    doThis:
      "This is the compliance one on this trigger. Opt-out is carrier " +
      "truth: a STOP whose webhook we missed leaves the composer open and " +
      "every send to that number comes back 40300, so we look broken to " +
      "the crew and non-compliant to the carrier. Restore the trigger " +
      "(Cloudflare → loonext-api → Triggers → Cron Triggers, then " +
      "redeploy). The comparison is state-driven, so the first run after " +
      "it returns finds every STOP missed during the gap — nothing needs " +
      "replaying by hand.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "cron:30 15 * * *": {
    what: "The daily webhook_events retention sweep has not run.",
    doThis:
      "Eleven retention and export jobs ride this one trigger, so its " +
      "silence is the widest on the platform: for every day it does not " +
      "fire we hold contact-form IPs, unsubscribed prospect emails, " +
      "SSN/SIN fragments from signups that never paid, and expired data " +
      "exports past the windows our own privacy policy states. None of " +
      "that is lost data — it is data we promised to delete and did not — " +
      "and every sweep is state-driven, so one good run at 15:30 UTC " +
      "clears the whole accumulation. Restore it under Cloudflare → " +
      "loonext-api → Triggers → Cron Triggers and redeploy the API.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "cron:15 */6 * * *": {
    what:
      "The six-hourly trigger has not fired — the Durable Object alert-channel " +
      "canary (#375) rides it.",
    doThis:
      "Only the Durable Object alert-channel canary (#375) rides this " +
      "trigger, so nothing customer-facing is broken — but until it " +
      "fires, nothing is confirming that the calls system can still " +
      "complain. Check `15 */6 * * *` under Cloudflare → loonext-api → " +
      "Triggers → Cron Triggers and redeploy the API to re-register it. " +
      "If the trigger IS listed there, the schedule is fine and only the " +
      "heartbeat write failed: search Workers Logs for `liveness: " +
      "heartbeat cron:15 */6` and treat it as a Supabase fault.",
    everyMinutes: 360,
    graceMinutes: 180,
  },
  "cron:50 13 * * 1": {
    what: "The weekly founder cost digest has not run (#447).",
    doThis:
      "Rank this last in the email. It carries one weekly digest, nobody " +
      "is affected by it being late, and the per-tenant overage warnings " +
      "that actually protect margin go out hourly on their own trigger. " +
      "Confirm `50 13 * * 1` under Cloudflare → loonext-api → Triggers → " +
      "Cron Triggers, redeploy the API, and the next Monday run covers " +
      "the missed week.",
    everyMinutes: 10080,
    graceMinutes: 1440,
  },
  "cron:5 */2 * * *": {
    what: "The synthetic probes have not run — /status has no fresh evidence (#477).",
    doThis:
      "The synthetic probes (#477) ride this alone, so what stopped is " +
      "our ability to answer \"does the product work right now\" — /status " +
      "is serving stale evidence and will keep doing so silently. Restore " +
      "the trigger under Cloudflare → loonext-api → Triggers → Cron " +
      "Triggers, then reload https://loonext.com/status and confirm the " +
      "timestamps move. Until they do, treat a green /status as unproven " +
      "rather than reassuring.",
    everyMinutes: 120,
    graceMinutes: 60,
  },
  "cron:35 14 1 * *": {
    what: "The monthly response-time recap has not run (#482).",
    doThis:
      "This trigger fires once a month, on the 1st, so there is nothing " +
      "to catch up and no second attempt — if it did not fire, that " +
      "month's response-time recap simply did not happen and next month's " +
      "is a full month away. Check `35 14 1 * *` under Cloudflare → " +
      "loonext-api → Triggers → Cron Triggers and redeploy the API so the " +
      "next 1st is covered. No customer is broken by this; they are only " +
      "missing a courtesy email.",
    // A month at its longest, so February never reads as an outage. The grace
    // is two days rather than the usual hours: this fires once a month, so a
    // false alarm here costs more attention than a real one saves — nothing is
    // broken for a customer if a courtesy email is a day late.
    everyMinutes: 44_640,
    graceMinutes: 2880,
  },
  // ---------------------------------------------------------------------
  // Per-JOB expectations (#333).
  //
  // A schedule firing is not the same as its jobs working. The 15-minute
  // trigger carries seven of them; if one threw on its first statement every
  // single run, the schedule still fired and the `cron:` heartbeat above
  // still beat. So each job records its own heartbeat, and ONLY ON SUCCESS —
  // which makes "this job has been broken every run since Tuesday" and "this
  // job has not run" the same alert, arriving on the same path.
  //
  // A transient failure that recovers on the next run never reaches its grace
  // window, so this adds no noise. Only the persistently-broken job speaks up.
  //
  // Cadence and grace mirror the schedule each job rides, because a job
  // cannot run more often than its trigger fires.
  // ---------------------------------------------------------------------
  "job:lead-chase": {
    what: "Unanswered new leads are no longer being chased — the five-minute first-response promise (#388) is unenforced.",
    doThis:
      "Workers Logs, search `cron job job:lead-chase failed` — the full " +
      "stack is on that line, and the run also reaches Sentry as an " +
      "AggregateError naming this key. Fix it fast, because this is the " +
      "one job whose output expires completely: the ladder's rungs are at " +
      "two and five minutes, so a reminder that arrives an hour late is " +
      "not a late reminder, it is a missed lead. Once it is running, open " +
      "the inbox and answer anything from the outage window yourself — " +
      "the ladder will not chase a lead whose window has already closed.",
    everyMinutes: 1,
    graceMinutes: 20,
  },
  "job:scheduled-send": {
    what: "Scheduled texts (#233) are not going out — every send somebody queued for a specific moment is silently sitting still.",
    doThis:
      "Workers Logs, search `cron job job:scheduled-send failed` for the " +
      "stack; the run also reaches Sentry as an AggregateError naming this " +
      "key. Nothing is lost while it is down — the rows stay claimable and " +
      "go out on the first successful run — but what IS lost is the timing, " +
      "which is the entire feature: a follow-up written for Monday 8am that " +
      "lands Monday afternoon has missed the moment it was written for. " +
      "Check the horizon before celebrating a fix: anything past its " +
      "`expires_at` will expire rather than send late, which is deliberate " +
      "(docs/DECISIONS.md, rule 3), so a long outage means telling those " +
      "workspaces rather than assuming the backlog drained.",
    everyMinutes: 1,
    graceMinutes: 20,
  },
  "job:escalation-sweep": {
    what:
      "After-hours pages (#244) are not widening — an alert sent to the " +
      "on-call member who slept through it now reaches nobody else, ever.",
    doThis:
      "Workers Logs, search `cron job job:escalation-sweep failed`. THIS ONE " +
      "IS WORSE THAN IT LOOKS, because the routing that depends on it keeps " +
      "working: after-hours alerts are still being NARROWED to one person, " +
      "and the safety net that made narrowing defensible is the part that is " +
      "down. A crew whose on-call member misses a 2am emergency will never " +
      "hear about it. If this cannot be fixed quickly, set every affected " +
      "workspace's `on_call_escalate_after_minutes` to 0 — that is the " +
      "documented 'tell everybody at once' setting and it bypasses this job " +
      "entirely. Rows already claimed are NOT retried, so check " +
      "`alert_escalations` for unacknowledged rows with `escalated_at` set " +
      "during the outage and tell those crews rather than assuming the " +
      "backlog drained.",
    everyMinutes: 1,
    graceMinutes: 20,
  },
  "job:daily-summary": {
    what:
      "The daily summary (#297) is not going out — every member who asked "
      + "for one is getting nothing, on the notification they read most.",
    doThis:
      "Workers Logs, search `cron job job:daily-summary failed`. Nothing is "
      + "lost: the summary is a view over `api_for_you`, so a missed morning "
      + "is a missed morning rather than missing data, and everything it "
      + "would have said is on the For You screen. Do NOT try to backfill by "
      + "clearing `summary_sent_on` — that is the per-member idempotency for "
      + "the day, and clearing it mid-morning sends a second summary to "
      + "anybody who already had theirs.",
    everyMinutes: 15,
    graceMinutes: 60,
  },
  "job:batch-flush": {
    what:
      "Grouped notifications (#297) are not going out — every member who "
      + "chose grouping is now receiving NOTHING, and their queue is growing.",
    doThis:
      "Workers Logs, search `cron job job:batch-flush failed`. Nothing is "
      + "lost while it is down: the rows sit in `pending_notifications` and "
      + "go out on the first successful run, and every message is still in "
      + "the inbox. What IS lost is the promise — somebody who asked for a "
      + "digest every 15 minutes is getting silence instead, and will "
      + "reasonably conclude the feature does not work. Urgent alerts are "
      + "unaffected by design: they never enter this queue. If it cannot be "
      + "fixed quickly, clearing `delivery` on the affected prefs rows puts "
      + "those members back on immediate delivery, which is the pre-#297 "
      + "behaviour.",
    everyMinutes: 1,
    graceMinutes: 20,
  },
  "job:sweep-webhooks": {
    what: "Failed provider webhooks are not being replayed — the backstop for the entire inbound path has stopped backstopping.",
    doThis:
      "Workers Logs, search `cron job job:sweep-webhooks failed` for the " +
      "stack (the run also lands in Sentry as an AggregateError naming " +
      "this key). Nothing is lost while it is down: the sweeper selects " +
      "`webhook_events` rows that are still unprocessed, and the 30-day " +
      "retention prune only ever drops PROCESSED rows, so the whole " +
      "backlog replays on the first successful run. What you do lose is " +
      "the backstop — while this is broken, a dropped provider webhook " +
      "has nothing behind it.",
    everyMinutes: 5,
    graceMinutes: 25,
  },
  "job:fail-stuck-sends": {
    what: "Sends that crashed before reaching Telnyx are not being failed out, so they never surface as retryable.",
    doThis:
      "Workers Logs, search `cron job job:fail-stuck-sends failed` for " +
      "the stack. Low stakes and self-draining: it selects outbound " +
      "`messages` still 'queued' with no `telnyx_message_id`, so " +
      "everything stranded during the outage gets failed out on the first " +
      "good run and becomes retryable in the UI. The cost until then is " +
      "honesty — a send that died before the carrier still shows as " +
      "in-flight to the crew.",
    everyMinutes: 5,
    graceMinutes: 25,
  },
  "job:sweep-stuck-provisioning": {
    what: "Numbers wedged in 'provisioning' are not being flipped to failed, so a paying customer sits on a hopeful status forever.",
    doThis:
      "Workers Logs, search `cron job job:sweep-stuck-provisioning " +
      "failed` for the stack. A paying customer is looking at a hopeful " +
      "'provisioning' status for a number that is never coming, which is " +
      "the exact dishonesty §4.3 exists to prevent — but " +
      "`job:reconcile-numbers` on the 15-minute trigger is the slower " +
      "backstop, so unless that key is in this email too, they reach " +
      "remediation in fifteen minutes instead of five. Everything is " +
      "selected by state, so nothing needs unwedging by hand.",
    everyMinutes: 5,
    graceMinutes: 25,
  },
  "job:liveness-check": {
    what: "The liveness checker itself has stopped completing — every other alert here is now unreliable.",
    doThis:
      "Read this one first, because it is self-referential: the email in " +
      "your hand was sent BY this job, so it ran, and the throw is " +
      "therefore somewhere after the send. Workers Logs, search `cron job " +
      "job:liveness-check failed` — the stack names the line, and it will " +
      "be in the heartbeat-seeding or bookkeeping tail rather than the " +
      "alerting path. Until it is fixed, every other key in this email is " +
      "still trustworthy (the send clearly works), but recoveries may not " +
      "clear.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:notify-due-tasks": {
    what: "Task due-date reminders are not going out.",
    doThis:
      "Workers Logs, search `cron job job:notify-due-tasks failed` for " +
      "the stack. Then open the task list filtered to due dates inside " +
      "the outage window and tell those assignees yourself: the reminder " +
      "is sent at most once per due date and is meant to arrive as the " +
      "task comes due, so one that fires after the crew was supposed to " +
      "be on site is noise rather than help. Everything due from here on " +
      "is covered again as soon as the job runs.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:reconcile-numbers": {
    what: "Provisioning is not being retried or reconciled — crash-after-buy orphans are unadopted and we pay Telnyx for numbers nobody holds.",
    doThis:
      "Workers Logs, search `cron job job:reconcile-numbers failed` for " +
      "the stack. This is the money one on the 15-minute trigger: it is " +
      "what adopts crash-after-buy orphans, so while it is broken we are " +
      "paying Telnyx for numbers that no workspace holds and no invoice " +
      "covers. It selects by state and nothing is lost, but after it " +
      "recovers compare the Telnyx portal's number list against our " +
      "`phone_numbers` rows once — an orphan bought during the gap is " +
      "billable the whole time it sits there.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:retry-campaign-assignments": {
    what: "Failed 10DLC campaign number-assignments are not being retried.",
    doThis:
      "Workers Logs, search `cron job job:retry-campaign-assignments " +
      "failed` for the stack. Customer-visible: a number that never gets " +
      "assigned to its 10DLC campaign cannot send A2P traffic, so that " +
      "workspace's texts fail at the carrier while their registration " +
      "reads approved. Self-draining once it runs — but if a specific " +
      "crew is complaining that sends fail, check their number's campaign " +
      "assignment in the Telnyx portal directly rather than waiting for " +
      "the retry.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:credit-converted-prepayments": {
    what:
      "A prepaid year was ended on a plan change and the money owed back has not " +
      "reached the customer's account. They are paying full price and are owed a " +
      "recorded amount.",
    doThis:
      "Workers Logs, search `cron job job:credit-converted-prepayments failed` " +
      "and `[prepay] could not credit conversion` — the second names the row and " +
      "the amount. Rank it ABOVE the storage sweeps: this is money we took and " +
      "have not given back, on a customer who upgraded. Self-draining once the " +
      "cause is fixed; the sweep re-reads every outstanding row each pass and the " +
      "Stripe key is per-row, so a replay cannot pay twice. If a company has no " +
      "Stripe customer the row will never drain by itself and needs a hand.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:sweep-deleted-attachments": {
    what: "Soft-deleted attachments are not being reclaimed, so storage bills grow for data nobody can reach.",
    doThis:
      "Workers Logs, search `cron job job:sweep-deleted-attachments " +
      "failed` for the stack. Rank it below every other line here: " +
      "nothing is broken for a customer, and the only cost is storage we " +
      "pay for objects nobody can reach. Fully self-draining — the sweep " +
      "selects soft-deleted rows past the signed-URL grace window, so one " +
      "good run reclaims the whole accumulation.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:reconcile-text-enablement": {
    what: "Hosted text-enablement orders are not being polled — a kept number never goes live.",
    doThis:
      "Workers Logs, search `cron job job:reconcile-text-enablement " +
      "failed` for the stack. Somebody is waiting on this: a customer who " +
      "kept their own number sees it stuck short of active until the poll " +
      "flips it, and this job is the fallback for exactly the webhook " +
      "that already failed to arrive. If one crew is blocked right now, " +
      "open their order in the Telnyx portal and confirm its real state " +
      "rather than waiting — the poll catches up on its own for everyone " +
      "else.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:reconcile-voice-enablement": {
    what: "Voice is not being bound to active numbers, so missed-call text-back silently never fires.",
    doThis:
      "Workers Logs, search `cron job job:reconcile-voice-enablement " +
      "failed` for the stack. The failure is silent by construction: a " +
      "number without voice bound simply never fires missed-call " +
      "text-back, and nothing anywhere errors, so the crew concludes the " +
      "feature does not work. Self-draining — it selects active numbers " +
      "that are un-bound whose company has MCTB on — so one good run " +
      "rebinds every number stranded during the gap.",
    everyMinutes: 15,
    graceMinutes: 45,
  },
  "job:report-usage": {
    what: "Metered message usage is not reaching Stripe — we deliver the service and do not bill for it.",
    doThis:
      "Workers Logs, search `cron job job:report-usage failed` for the " +
      "stack. Revenue, but nothing is lost yet and nothing should be " +
      "pushed to Stripe by hand: it selects `usage_events` with " +
      "`stripe_reported_at` IS NULL and catches up 200 rows an hour, so " +
      "the backlog bills itself once the job runs again. If the stack " +
      "points at Stripe rather than at us, expect `job:report-usage:work` " +
      "in a later email — that key is the one that means the reporting is " +
      "failing rather than merely absent.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:report-voice-usage": {
    what: "Metered voice minutes are not reaching Stripe — same revenue leak as the segment reporter.",
    doThis:
      "Workers Logs, search `cron job job:report-voice-usage failed` for " +
      "the stack. Same revenue leak and same shape as the segment " +
      "reporter: unreported voice minutes are selected by " +
      "`stripe_reported_at` IS NULL and drain automatically once it runs, " +
      "so do not send anything to Stripe manually. Check whether " +
      "`job:report-usage` is in this email too — both together points at " +
      "Stripe or at the shared metering path, not at voice.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:usage-alerts": {
    what: "The 80%/100% usage alerts have stopped, so a customer's first warning is their overage.",
    doThis:
      "Workers Logs, search `cron job job:usage-alerts failed` for the " +
      "stack. Treat this as time-critical rather than routine: the 80% " +
      "alert only helps before the 100% is reached, and the " +
      "`usage_alerts` ledger means nobody gets warned retroactively — a " +
      "crew that crossed their allowance during the outage learns about " +
      "it from the overage. Once it is running, look at this period's " +
      "heaviest workspaces and call anyone already past 80% yourself.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:overage-warning": {
    what: "The projected-cost warning has stopped — a tenant costing more than they pay goes unnoticed.",
    doThis:
      "Workers Logs, search `cron job job:overage-warning failed` for the " +
      "stack. This is the #85 margin guard: while it is down, a tenant " +
      "projected to cost us more than they pay goes unnoticed, and the " +
      "static 80%/100% alerts that remain will not catch it because the " +
      "shape is cost, not volume. It warns once per period, so nothing " +
      "double-sends when it recovers — but a tenant who crossed the " +
      "projection during the gap will not be re-evaluated until the next " +
      "period, so check the cost dashboard for this period by hand.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:inbound-canary": {
    what:
      "The synthetic inbound canary job has stopped running, so nothing is " +
      "generating the traffic that proves the inbound path works.",
    doThis:
      "Workers Logs, search `cron job job:inbound-canary failed` for the " +
      "stack. This means the canary JOB stopped executing, which is " +
      "different from the canary failing its round trip — so while it is " +
      "down, `channel:inbound-canary` cannot alert either and the fast " +
      "half of inbound detection is simply gone, leaving only the 12-hour " +
      "traffic backstop. If the stack is a send error, check the Telnyx " +
      "balance and that CANARY_FROM_E164 is still on a messaging profile; " +
      "six unanswered round trips in a day also deliberately stops the " +
      "sending, and that is the cost cap working.",
    // Unconditional, unlike `channel:inbound-canary` above: this key means
    // "the job ran", which is true and worth knowing whether or not the number
    // pair is configured — an unconfigured canary still returns cleanly, and a
    // job that stopped executing is a different fault from one that is off.
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:do-sentry-canary": {
    what:
      "The Durable Object alert-channel canary (#375) has stopped running, so " +
      "nothing is checking whether the calls alarms can still reach anyone.",
    doThis:
      "Workers Logs, search `cron job job:do-sentry-canary failed` for " +
      "the stack. It means the canary job itself threw, which is a " +
      "different fault from the channel being down — if " +
      "`channel:do-sentry` is NOT also in this email, the alert channel " +
      "was healthy the last time anyone checked and only the checker " +
      "broke. Rank it above the routine jobs anyway: until it runs, " +
      "nothing is confirming that the CALLS-V3 §13 cost-cap warnings and " +
      "the §17 drift alarm can still reach a human.",
    // Unconditional, for the same reason as job:inbound-canary: "the job ran"
    // is worth knowing whether or not a DO binding exists, and a job that
    // stopped executing is a different fault from a channel that is down.
    everyMinutes: 360,
    graceMinutes: 720,
  },
  "job:email-health": {
    what:
      "The email bounce/complaint rate check has stopped. The domain reputation " +
      "cliff is one-way, so nobody would learn we were approaching it (#386).",
    doThis:
      "Skip the logs for once and open the Resend dashboard — bounce and " +
      "complaint rates are right there, and they are the actual question " +
      "this job asks. Then Workers Logs, search `cron job " +
      "job:email-health failed` for the stack. The reason to do it in " +
      "that order is that the domain-reputation cliff is one-way (#386): " +
      "if we crossed it during the outage, no fix to this job un-crosses " +
      "it, and the only useful minute is the one spent looking at the " +
      "real numbers.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:sweep-stale-calls": {
    what: "Calls wedged in-flight are not being closed, so /calls lies and the per-conversation dial guard stays shut.",
    doThis:
      "Workers Logs, search `cron job job:sweep-stale-calls failed` for " +
      "the stack. Customer-visible in a confusing way: a call wedged " +
      "in-flight keeps the per-conversation dial guard shut, so the crew " +
      "presses call and nothing happens, with no error to explain it. " +
      "Self-draining — it flips sessions in-flight past four hours to " +
      "'missed' — so one good run reopens every stuck conversation; if " +
      "somebody is blocked right now, that is the explanation to give " +
      "them.",
    everyMinutes: 60,
    graceMinutes: 60,
  },
  "job:nudge-sole-prop-otp": {
    what: "Sole-proprietor OTP nudges have stopped, so a stalled registration is never chased.",
    doThis:
      "Workers Logs, search `cron job job:nudge-sole-prop-otp failed` for " +
      "the stack, then treat the rest as a deadline rather than a " +
      "backlog. The sole-prop OTP window is 24 hours and this nudge fires " +
      "at the 12-hour mark, so anyone whose window closed during the " +
      "outage must resubmit their brand from scratch. Pull " +
      "`messaging_registrations` for sole-prop brands still 'submitted' " +
      "with no nudge recorded and chase those people directly — the job " +
      "will still send when it recovers, and a nudge after the window " +
      "closed is worse than none.",
    everyMinutes: 60,
    graceMinutes: 90,
  },
  "job:geocode-contacts": {
    what: "Contact geocoding has stopped and the map stops gaining pins.",
    doThis:
      "Workers Logs, search `cron job job:geocode-contacts failed` for " +
      "the stack. Lowest stakes in the email: nothing is lost, rows just " +
      "stay `geocode_status` 'pending' and the map gains pins late rather " +
      "than never, at 120 an hour once it is back. If the stack is a " +
      "Nominatim error rather than ours, check whether " +
      "`job:geocode-tasks` is here too — the two are half an hour apart " +
      "precisely so they never share a Nominatim second, so both failing " +
      "points at the service and not at us.",
    everyMinutes: 60,
    graceMinutes: 120,
  },
  "job:geocode-tasks": {
    what: "Task geocoding has stopped, so tasks pin at their contact's address rather than their own.",
    doThis:
      "Workers Logs, search `cron job job:geocode-tasks failed` for the " +
      "stack. Nothing is lost and nothing is broken: a task without its " +
      "own coordinates simply pins at its contact's address, which is " +
      "usually the right place anyway. Look for `job:geocode-contacts` in " +
      "this same email first — both geocoders failing together means " +
      "Nominatim, one alone means our code.",
    everyMinutes: 60,
    graceMinutes: 120,
  },
  "job:poll-registrations": {
    what: "10DLC/A2P registration transitions are not being polled — an approved customer is never let out of the waiting room.",
    doThis:
      "Workers Logs, search `cron job job:poll-registrations failed` for " +
      "the stack. This is only the webhook fallback, so an approved " +
      "customer is normally let out of the waiting room by the webhook " +
      "regardless — but this trigger gets one attempt a day, and a fix " +
      "now means the next attempt is 13:00 UTC tomorrow. If a specific " +
      "workspace is stuck waiting, open their brand and campaign in the " +
      "Telnyx portal and reconcile that one by hand rather than waiting " +
      "for the poll.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:number-health": {
    what:
      "Per-number reputation is no longer being assessed (#235). A carrier "
      + "labelling one of our numbers would now be invisible until the "
      + "customer churns over it.",
    doThis:
      "Workers Logs, search `cron job job:number-health failed` for the " +
      "stack. Slow signal, low urgency: it compares 7-day and 28-day " +
      "windows, so a day or two of silence changes nothing it would have " +
      "told you. What it costs is the only warning we have that a carrier " +
      "is quietly labelling one of our numbers (#235) — the customer's " +
      "next signal after that is churn, so do not let this one sit for a " +
      "week.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:registration-stalls": {
    what:
      "Nothing is watching for a registration stuck past the wait we quoted "
      + "(#310). A workspace paying for a number that cannot text, with no way "
      + "to tell whether the wait is working, is recoverable today and gone in "
      + "a week.",
    doThis:
      "Workers Logs, search `cron job job:registration-stalls failed` for " +
      "the stack. The registration poller advances what changed; this is " +
      "the job that notices what did NOT, and a workspace paying for a " +
      "number that cannot text is recoverable today and gone in a week " +
      "(#310). Daily trigger, one attempt — so rather than waiting for " +
      "13:00 UTC tomorrow, read `messaging_registrations` for anything " +
      "still pending past the wait we quoted and reach out to those " +
      "workspaces yourself.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:delivery-by-country": {
    what: "The delivery-rate-by-country split has stopped, which is the only signal that would show a carrier silently filtering us (#379, #235).",
    doThis:
      "Workers Logs, search `cron job job:delivery-by-country failed` for " +
      "the stack. A carrier filtering our unregistered A2P traffic " +
      "returns no error at all — the message is accepted, billed, marked " +
      "sent and never arrives (#379) — so this split is the only place " +
      "that failure is visible, and while it is broken the failure mode " +
      "is invisible everywhere. Nothing is lost; the split is computed " +
      "from stored delivery statuses, so one good run reports the missed " +
      "days too.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:poll-port-requests": {
    what: "In-flight number ports are unattended — a stalled saga never resumes.",
    doThis:
      "Workers Logs, search `cron job job:poll-port-requests failed` for " +
      "the stack. Ports run on the losing carrier's clock and this job is " +
      "only the PORTING.md §5.2 fallback, so a missed day costs nothing " +
      "unless a Telnyx webhook was missed on the same day. Because the " +
      "next attempt is 13:10 UTC tomorrow, check `port_requests` rows " +
      "with an FOC date inside the next two days against their real " +
      "status in the Telnyx portal now — a port that completed while this " +
      "was down leaves a customer's number live at the carrier and " +
      "inactive here.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:grace-and-release": {
    what: "Grace warnings and releases have stopped: a customer loses their number with no warning, or we keep paying for numbers past cancellation.",
    doThis:
      "Workers Logs, search `cron job job:grace-and-release failed` for " +
      "the stack, then treat this as a deadline. The ladder warns at day " +
      "1, 15 and 27 and releases at day 30, it gets one attempt a day, " +
      "and a warning delivered after the release is not a warning — so " +
      "anyone whose day-27 mark fell inside the outage is about to lose " +
      "their number having never been told. Read the companies currently " +
      "in grace, phone anyone past day 25 today, and check whether " +
      "anything past day 30 is still costing us at Telnyx.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:subscription-reconcile": {
    what: "Missed Stripe webhooks are not being corrected and billing state drifts from reality.",
    doThis:
      "Workers Logs, search `cron job job:subscription-reconcile failed` " +
      "for the stack. Self-correcting: it re-mirrors every non-active " +
      "company from Stripe, so one good run fixes however many days of " +
      "drift it missed. Until then, treat our subscription state as " +
      "possibly stale — if you are about to act on a company's plan or " +
      "status, read it from Stripe rather than from the admin view.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:opt-out-reconcile": {
    what: "We are no longer comparing our opt-out list to the carrier's — a missed STOP leaves the composer open and every send failing (#331).",
    doThis:
      "Workers Logs, search `cron job job:opt-out-reconcile failed` for " +
      "the stack. This is the compliance line: a number the carrier is " +
      "blocking that we have no opt-out record for is an inbound STOP " +
      "whose webhook we missed, which leaves the composer open, every " +
      "send failing 40300, and us sending to somebody who told us to " +
      "stop. Nothing needs replaying — the comparison is state-driven and " +
      "the first good run finds every STOP missed during the gap — but if " +
      "a run of these appears afterwards, the real fault is webhook " +
      "delivery, not this job.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:overage-digest": {
    what: "The weekly founder cost digest has stopped.",
    doThis:
      "Workers Logs, search `cron job job:overage-digest failed` for the " +
      "stack. Lowest urgency in the email: this is a weekly summary of a " +
      "pattern, and the per-tenant warnings that actually protect margin " +
      "go out hourly on a different trigger and are unaffected. It runs " +
      "Mondays, so a fix any time this week is in time for the next one.",
    everyMinutes: 10080,
    graceMinutes: 1440,
  },
  "job:probes": {
    what:
      "The synthetic probes have stopped — nothing is checking that auth works " +
      "or that carrier callbacks are still arriving (#477).",
    doThis:
      "Workers Logs, search `cron job job:probes failed` for the stack — " +
      "and read that stack carefully rather than just restarting, because " +
      "a probe failing is itself a finding: these check that auth works " +
      "and that carrier callbacks still arrive (#477), so the throw may " +
      "be the product breaking rather than the job. Meanwhile /status is " +
      "serving stale evidence, so treat it as unproven rather than green " +
      "until the timestamps move again.",
    everyMinutes: 120,
    graceMinutes: 60,
  },
  "job:response-time-recap": {
    what:
      "The monthly response-time recap has stopped — owners are no longer " +
      "being told how fast they answered, or whether it moved (#482).",
    doThis:
      "Workers Logs, search `cron job job:response-time-recap failed` for " +
      "the stack. Monthly, on the 1st, so there is no catch-up and no " +
      "second attempt — this month's recap did not go out and fixing the " +
      "job now only helps next month. Nothing is broken for a customer; " +
      "they are missing a courtesy email, which is worth exactly one look " +
      "at the stack and no more.",
    everyMinutes: 44_640,
    graceMinutes: 2880,
  },
  "job:prune-webhook-deliveries": {
    what:
      "The OUTBOUND webhook log is no longer pruned, so we are holding " +
      "copies of customers' message content past the 30 days we publish.",
    doThis:
      "Workers Logs, search `cron job job:prune-webhook-deliveries failed` " +
      "for the stack. This is not an outage — every integration keeps " +
      "working. What breaks is a promise: `docs/PERSONAL-DATA-INVENTORY.md` " +
      "§5 says these payloads are deleted at 30 days, and each payload is a " +
      "copy of a real message body or contact name. A published window " +
      "nothing enforces is a claim, so treat this as a this-week problem " +
      "rather than a background one. Fully self-draining — one good run " +
      "clears the whole accumulation. If several other `job:prune-*` keys " +
      "are in this email, look at the shared 15:30 UTC trigger instead.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:deliver-outbound-webhooks": {
    what: "Outbound webhooks have stopped going out to customers' own systems.",
    doThis:
      "Workers Logs, search `cron job job:deliver-outbound-webhooks failed` " +
      "for the stack. Nothing is LOST — a delivery that was claimed and not " +
      "finished stays past-due and the next tick re-claims it, so the queue " +
      "drains itself once the job runs again. What a customer sees " +
      "meanwhile is their scheduling tool or CRM silently falling behind, " +
      "which they will notice as our bug rather than a stalled cron. If the " +
      "stack points at `fetch`, look at ONE endpoint before suspecting the " +
      "job: a single slow receiver can eat the tick, and the per-endpoint " +
      "auto-disable is what is supposed to stop that.",
    everyMinutes: 5,
    graceMinutes: 30,
  },
  "job:prune-webhook-events": {
    what: "The webhook ledger is no longer pruned and grows without bound.",
    doThis:
      "Workers Logs, search `cron job job:prune-webhook-events failed` " +
      "for the stack. Nothing is broken and nothing is lost — the ledger " +
      "simply keeps rows past the 30-day dedupe window and grows, which " +
      "costs storage and eventually query time. One good run drops the " +
      "whole accumulation, so this is a this-week problem rather than a " +
      "tonight problem. If several other `job:prune-*` keys are in this " +
      "email, look at the shared 15:30 UTC trigger instead of at any one " +
      "job.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:prune-widget-verifications": {
    what:
      "Strangers' phone numbers and IPs from the website widget are kept " +
      "past their 30-day window.",
    doThis:
      "Workers Logs, search `cron job job:prune-widget-verifications " +
      "failed` for the stack. Nothing customer-facing breaks — the widget " +
      "keeps working and no workspace notices. What accumulates is personal " +
      "data about people who are not our customers: somebody typed a number " +
      "into a form on a plumber's website, never became a contact, and has " +
      "no account through which to ask us to forget them. That makes this a " +
      "data-protection obligation rather than a storage one, and it is the " +
      "reason the row is on the personal-data inventory. One good run clears " +
      "the whole backlog. If several other `job:prune-*` keys are in this " +
      "email, look at the shared 15:30 UTC trigger instead of at any one job.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:prune-audit-log": {
    what: "The audit log is no longer pruned past its 12-month window.",
    doThis:
      "Workers Logs, search `cron job job:prune-audit-log failed` for the " +
      "stack. We are holding audit rows past the 12-month window we " +
      "committed to (#231), which is a promise we are quietly not keeping " +
      "rather than an outage. Fully self-draining — one good run trims " +
      "everything past the window. Check whether the other `job:prune-*` " +
      "keys are here too; all of them together means the 15:30 UTC " +
      "trigger, not the jobs.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:purge-closed-workspaces": {
    what: "Closed workspaces are not being purged — data we promised to delete is still here.",
    doThis:
      "Workers Logs, search `cron job job:purge-closed-workspaces failed` " +
      "for the stack, and rank this above the other retention sweeps. " +
      "Every day it does not run, we are holding the messages, contacts " +
      "and call records of workspaces we told we had deleted them — that " +
      "is a broken promise accruing, not a delayed chore. Self-draining " +
      "once it runs; if the other `job:prune-*` keys are in this email " +
      "too, fix the 15:30 UTC trigger and all of them clear at once.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:aup-watch": {
    what:
      "Nothing is watching for a workspace sending in the shape the AUP "
      + "exists to catch (#303). Carrier action lands on the whole sending "
      + "pool rather than on the offender, so one abusive tenant is billed to "
      + "every other customer's deliverability — and the first sign would be a "
      + "carrier complaint rather than an alert.",
    doThis:
      "Workers Logs, search `cron job job:aup-watch failed` for the stack. "
      + "Nothing is lost and nothing is over-enforced while it is down — the "
      + "job only ever emails, never suspends, so its silence costs detection "
      + "rather than a customer. Run it by hand from the Supabase SQL editor "
      + "if you want the answer today: `select * from api_aup_signals(14)` "
      + "returns the same rows the job reads, and a workspace far above its own "
      + "`baseline_daily` with a `fresh_ratio` near 1 is the shape worth "
      + "opening. Everything it reads is a count or a ratio, so a stack trace "
      + "here can never involve message content.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:call-silence": {
    what:
      "Nothing is watching for a single workspace's calls stopping (#397). "
      + "That is the quiet signal a customer pointed their number at somebody "
      + "else; the fleet-wide call-event key would never notice one of them.",
    doThis:
      "Workers Logs, search `cron job job:call-silence failed` for the " +
      "stack. This is the per-workspace watcher (#397), and its blind " +
      "spot while down is the quiet one: the fleet-wide call-event key " +
      "notices a Telnyx outage, but only this notices ONE customer " +
      "pointing their number somewhere else, which is churn already in " +
      "progress. Daily and self-draining, so one good run re-checks every " +
      "workspace — but a customer who left during the gap is best caught " +
      "by hand today.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:activation-stall": {
    what:
      "Nothing is watching for a workspace stalling on the way to its first "
      + "conversation (#281). Every one of those is recoverable with one "
      + "message while it is happening and a churn statistic a week later, and "
      + "the absence of an event is the only signal there is.",
    doThis:
      "Workers Logs, search `cron job job:activation-stall failed` for " +
      "the stack. What it watches is the absence of an event (#281): a " +
      "workspace that signed up and never reached its first conversation, " +
      "which is recoverable with one message while it is happening and a " +
      "churn statistic a week later. It compares 3, 7 and 10-day windows, " +
      "so one good run still catches anyone who stalled during the outage " +
      "— the loss is only the days of head start.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:retry-interrupted-sends": {
    what:
      "Sends that crashed before reaching the carrier are no longer being "
      + "re-dispatched (#411). They are not lost — the fail-out sweeper still "
      + "surfaces them — but every one now waits for a human to notice, which "
      + "is exactly the five-minute window #388 says decides the job.",
    doThis:
      "Workers Logs, search `cron job job:retry-interrupted-sends failed` " +
      "for the stack. Nothing is lost: `job:fail-stuck-sends` runs in the " +
      "same tick and still surfaces these as retryable failures (#411), " +
      "so the cost is that every one of them now waits for a human to " +
      "press retry. That matters because it is exactly the five-minute " +
      "first-response window #388 says decides the job — so until this is " +
      "fixed, watch the inbox for failed sends and retry them yourself.",
    everyMinutes: 5,
    graceMinutes: 20,
  },
  "job:carrier-ceiling": {
    what:
      "Nothing is watching the carrier's daily message ceiling (#457). It is "
      + "the one limit we cannot raise for a customer — the way up is a fresh "
      + "registration taking days — so a crew that hits it unwarned loses the "
      + "rest of the day's sends with no remedy.",
    doThis:
      "Workers Logs, search `cron job job:carrier-ceiling failed` for the " +
      "stack, and treat it as expiring rather than accumulating. Its only " +
      "useful advice is \"spread the rest over tomorrow\", which is " +
      "worthless once a crew has already hit the ceiling, and the " +
      "`usage_alerts` ledger is keyed on the UTC day so nobody gets " +
      "warned retroactively (#457). If it was down across a business day, " +
      "check today's outbound counts per workspace yourself and phone " +
      "anyone near their registration's daily limit — the way past that " +
      "ceiling is a fresh registration taking days, so there is no fix " +
      "after the fact.",
    everyMinutes: 60,
    graceMinutes: 30,
  },
  "job:retention-enforce": {
    what:
      "Retention is no longer being enforced (#284). Messages past a "
      + "workspace's own window are being kept, after that workspace was "
      + "emailed to say they would go — which is the promise, not the "
      + "deletion, that carries the liability.",
    doThis:
      "Workers Logs, search `cron job job:retention-enforce failed` for the "
      + "stack. Nothing is lost and nothing is over-deleted: the sweep is "
      + "resumable by construction (each pass deletes rows, so the database "
      + "state is the cursor) and one good run clears the whole backlog. Check "
      + "for `job:retention-notice` in this same email first — the notice is a "
      + "precondition the SQL enforces, so if IT is broken this job correctly "
      + "does nothing and is a symptom rather than a second fault. If the "
      + "stack is a Storage error, that is the safe failure: objects are "
      + "removed before the rows that point at them, so a failed remove leaves "
      + "both in place for the next run rather than stranding files nobody can "
      + "reach.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:retention-notice": {
    what:
      "Workspaces are no longer being warned before their oldest messages age "
      + "out (#284). Nobody should find out about a retention policy by losing "
      + "something, and this job is the only thing that prevents that.",
    doThis:
      "Workers Logs, search `cron job job:retention-notice failed` for " +
      "the stack. Reassuringly, nothing can be lost while this is down: " +
      "the notice was deliberately shipped ahead of the enforcement job " +
      "(#284), so no message is actually being aged out yet and the only " +
      "cost is a warning arriving late. That stops being true the moment " +
      "enforcement ships, so fix it before then rather than treating it " +
      "as optional.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:prune-contact-messages": {
    what:
      "Marketing contact-form data is no longer being aged out (#340). We are "
      + "holding names, emails and IP addresses of people who are not "
      + "customers, past the windows the privacy policy states.",
    doThis:
      "Workers Logs, search `cron job job:prune-contact-messages failed` " +
      "for the stack. We are holding names, emails and IP addresses of " +
      "people who are not customers, past the windows the privacy policy " +
      "states (#340) — the IP at 30 days, the message at a year. " +
      "Self-draining, so one good run clears the whole accumulation. If " +
      "the other `job:prune-*` keys are here too, the fault is the shared " +
      "15:30 UTC trigger rather than this job.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:prune-marketing-contacts": {
    what:
      "Prospect consent records are no longer being aged out (#312). We are "
      + "holding the email addresses of people who unsubscribed, and of people "
      + "who consented to an email that was never sent, past the windows "
      + "docs/PERSONAL-DATA-INVENTORY.md states.",
    doThis:
      "Workers Logs, search `cron job job:prune-marketing-contacts " +
      "failed` for the stack. We are holding email addresses of people " +
      "who unsubscribed, and of people who consented to an email that was " +
      "never sent, past the windows docs/PERSONAL-DATA-INVENTORY.md " +
      "states (#312). Nothing is at risk of being sent to them — a send " +
      "needs a live consent row — so this is a retention promise, not a " +
      "compliance incident, and one good run clears it.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:prune-abandoned-identity": {
    what:
      "SSN/SIN fragments from signups that never paid are no longer being "
      + "cleared (#381). We are holding a government identifier belonging to "
      + "somebody who never became a customer, past the window we set.",
    doThis:
      "Workers Logs, search `cron job job:prune-abandoned-identity " +
      "failed` for the stack, and rank this first among the retention " +
      "sweeps. What is sitting there is SSN/SIN fragments belonging to " +
      "people who started a signup and never paid (#381) — a government " +
      "identifier held past the window we set, for somebody who never " +
      "became a customer. Self-draining once it runs, so the whole fix is " +
      "getting the job green.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:prune-user-sessions": {
    what: "Ended and revoked device rows (#236) are no longer pruned past their 90-day window.",
    doThis:
      "Workers Logs, search `cron job job:prune-user-sessions failed` for " +
      "the stack. Low stakes: only ended and revoked device rows past " +
      "their 90-day window are affected (#236), live sessions are never " +
      "touched at any age, so nobody is logged out and no access is " +
      "widened. One good run clears the backlog. Several `job:prune-*` " +
      "keys together means the 15:30 UTC trigger, not these jobs.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:prune-public-link-access": {
    what:
      "Public-link access rows are no longer pruned past the 30-day window " +
      "PERSONAL-DATA-INVENTORY.md publishes for them.",
    doThis:
      "Workers Logs, search `cron job job:prune-public-link-access failed` " +
      "for the stack. Low stakes as an outage — nothing customer-facing " +
      "breaks — but the window is a published one, so a long silence here " +
      "means we are keeping access records past what we said we would. " +
      "Fully self-draining: one good run clears the backlog. This job and " +
      "`job:prune-probe-results` were both written, granted and documented " +
      "and then called by NOTHING until #581, so if either goes quiet " +
      "check first that it is still registered in index.ts rather than " +
      "assuming the cron trigger. Several `job:prune-*` keys together " +
      "means the 15:30 UTC trigger, not these jobs.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:expire-payment-requests": {
    what:
      "Payment requests past their 14-day expiry keep reading as \"Waiting\" " +
      "in the thread, so a crew chases a customer over a link that no longer " +
      "opens (#224).",
    doThis:
      "Workers Logs, search `cron job job:expire-payment-requests failed` for " +
      "the stack. No money is at risk in either direction: the D75 token has " +
      "already stopped resolving, so an expired request cannot be paid " +
      "whether or not this ran. What is wrong is only what the thread SAYS. " +
      "One good run clears the backlog. Several hourly keys together means " +
      "the trigger, not this job.",
    everyMinutes: 60,
    graceMinutes: 180,
  },
  "job:prune-probe-results": {
    what: "Synthetic probe results accumulate for the life of the install.",
    doThis:
      "Workers Logs, search `cron job job:prune-probe-results failed` for " +
      "the stack. The lowest-stakes job here: probe rows are our own " +
      "telemetry, no customer data is involved, and the only cost of a " +
      "silence is table growth. One good run clears the backlog. See the " +
      "note on `job:prune-public-link-access` — both were unreferenced " +
      "until #581.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:prune-expired-exports": {
    what:
      "Expired data exports are not being deleted from storage. Each one is a full " +
      "copy of a workspace's messages and contacts, kept past its own seven-day promise (#378).",
    doThis:
      "Workers Logs, search `cron job job:prune-expired-exports failed` " +
      "for the stack. Each stranded object is a full copy of one " +
      "workspace's messages and contacts sitting in storage past the " +
      "seven-day promise its own completion email made (#378) — " +
      "unreachable, because the signed URL has expired, but not deleted, " +
      "which is not what we said. Self-draining once the job runs.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  "job:build-data-exports": {
    what: "Requested data exports are never built, so a customer's export request silently never completes.",
    doThis:
      "Workers Logs, search `cron job job:build-data-exports failed` for " +
      "the stack, and treat this as somebody waiting on us. A customer " +
      "asked for their data, got told it was being prepared, and the " +
      "request is now silently never completing — which for an access " +
      "request is a deadline we are missing, not a slow queue. Requests " +
      "are selected by state so they all build on the first good run; if " +
      "anyone has been waiting more than a day, email them directly once " +
      "it is out.",
    everyMinutes: 1440,
    graceMinutes: 360,
  },
  // ---------------------------------------------------------------------
  // WORK expectations (#333 ask 3): "report work done, not just execution".
  //
  // A job can run every hour, succeed every hour, and still be failing at the
  // thing it exists for. The re-reporters are the case that matters, because
  // what leaks is revenue: rows sit unreported, every Stripe call errors, the
  // job catches and continues, and both the schedule and the job heartbeat
  // look perfect.
  //
  // The signal is a conjunction, not a count: healthy means EITHER there was
  // nothing outstanding OR we reported something. Outstanding work plus zero
  // reported is the only shape that is wrong — and it is the only one that
  // does not false-alarm on a quiet platform with no traffic to report.
  // ---------------------------------------------------------------------
  "job:report-usage:work": {
    what:
      "Message usage has been sitting unreported for hours and every attempt to " +
      "send it to Stripe failed. We are delivering the service and not billing for it.",
    doThis:
      "This one is not \"the job stopped\" — it is the job running fine and " +
      "failing at what it exists for: message usage has been outstanding " +
      "for hours and every attempt to send it to Stripe failed. So skip " +
      "the cron dashboard entirely and go to the Stripe API logs, then " +
      "Workers Logs for the reporting errors; the answer is almost always " +
      "an API key, a missing meter, or a subscription item that no longer " +
      "exists. Nothing is lost yet — `stripe_reported_at` stays NULL and " +
      "the rows bill themselves once Stripe accepts them — but it does " +
      "not fix itself, because the job will keep succeeding and keep " +
      "reporting nothing.",
    everyMinutes: 60,
    graceMinutes: 180,
  },
  "job:report-voice-usage:work": {
    what:
      "Voice minutes have been sitting unreported for hours and every attempt to " +
      "send them to Stripe failed. Same revenue leak as the segment reporter.",
    doThis:
      "Same shape as the segment reporter and the same money: voice " +
      "minutes have been outstanding for hours with every Stripe call " +
      "failing, while the job itself succeeds every run. Go to the Stripe " +
      "API logs first, then Workers Logs — an API key, a missing meter, " +
      "or a stale subscription item covers nearly every case. Check " +
      "whether `job:report-usage:work` is in this email too: both " +
      "together is a Stripe or credentials fault, this one alone points " +
      "at the voice meter specifically.",
    everyMinutes: 60,
    graceMinutes: 180,
  },
  "channel:sms-outbound": {
    what:
      "No outbound text has been accepted by the carrier across the entire platform. " +
      "Either nobody is texting, or sending is broken and every workspace is silent.",
    doThis:
      "Look for `channel:telnyx-message-status` in this same email before you " +
      "touch anything: this probe counts only outbound rows that reached " +
      "'sent' or 'delivered', and the status webhook is the sole thing that " +
      "sets them — if that key is here too, sending is probably fine and this " +
      "line is its symptom, not a second fault. Alone, split it in the " +
      "Supabase SQL editor: outbound `messages` from the last hour sitting at " +
      "'queued' or 'failed' mean the carrier is refusing us (check the Telnyx " +
      "balance and TELNYX_API_KEY), while no outbound rows at all means " +
      "nobody pressed send, which is the app's problem and not the carrier's. " +
      "This is no longer the quiet-week false alarm you already fixed — a " +
      "platform that has sent nothing in seven days now beats this heartbeat " +
      "itself, so its arrival means real traffic stopped.",
    everyMinutes: 60,
    graceMinutes: 360,
  },
  "channel:email-outbound": {
    what:
      "No outbound email has been accepted by Resend across the entire platform. " +
      "Notification and billing mail may be going nowhere.",
    doThis:
      "Almost certainly nothing, and the email in your hand is the proof: it " +
      "went out through the same `sendEmail` that records this heartbeat, so " +
      "Resend accepted a send seconds ago and this line cleared itself as it " +
      "was being written. A truly dead Resend cannot produce this alert at " +
      "all — the send would throw and no email would arrive. If it comes back " +
      "in six hours, look at exactly two things: Workers Logs for `liveness: " +
      "heartbeat channel:email-outbound failed to record`, and " +
      "`email_suppressions` rows with `cleared_at` null, because a send whose " +
      "every recipient is suppressed returns quietly, mails nobody and " +
      "records no heartbeat.",
    everyMinutes: 60,
    graceMinutes: 360,
  },
  // ---------------------------------------------------------------------
  // INBOUND webhook classes (#308).
  //
  // Everything inbound arrives by webhook. If they stop, nothing throws —
  // there is only an absence, and an absence reads as a quiet Tuesday. It is
  // the most dangerous failure shape this product has: silent AND total, with
  // the first signal being an angry phone call hours later.
  //
  // THREE KEYS, NOT ONE, because the paths fail independently. Message
  // webhooks fine and call webhooks dead is a real shape and nobody would spot
  // it until somebody missed a call.
  //
  // WHY THE GRACES ARE WIDE, AND WHY THAT IS HONEST. #308 asks for a
  // per-time-of-day baseline so a fixed threshold does not page at 3am every
  // night and get muted within a week. The premise is right and the remedy is
  // not: a baseline needs volume to be a baseline, and at this platform's size
  // a genuinely quiet overnight hour is indistinguishable from a total outage
  // no matter how the threshold is computed. Inferring from customer traffic
  // cannot be made fast AND quiet at once, so these are deliberately the slow,
  // quiet backstop — and the synthetic canary is what makes detection fast,
  // because it generates the traffic instead of waiting for it.
  //
  // A false alarm costs more than the delay it saves: it is exactly how a
  // founder learns to ignore this mailbox, and then every other key here goes
  // with it.
  "channel:telnyx-inbound-message": {
    what:
      "No inbound text has arrived from Telnyx across the entire platform. " +
      "Either nobody has texted any customer, or every business number in the " +
      "product is silently swallowing messages.",
    doThis:
      "Text one of the business numbers from your own phone. Thirty seconds, " +
      "and it is the only definitive answer, because at this volume a broken " +
      "path and a genuinely quiet thirteen hours look identical from every " +
      "dashboard there is. First though, count the other Telnyx lines here: " +
      "message status and call events ride the SAME `/webhooks/telnyx` route " +
      "and the same signature, so all of them together point at the route or " +
      "at API_ORIGIN rather than at messaging, while this one alone means " +
      "deliveries are still arriving and only inbound texts stopped. If no " +
      "canary line appears in this email, the canary is simply switched off — " +
      "setting CANARY_FROM_E164 and CANARY_TO_E164 makes this key " +
      "self-answering, because the canary's own round trip writes a " +
      "`message.received` every hour whether or not a customer texts.",
    everyMinutes: 60,
    graceMinutes: 720,
  },
  "channel:telnyx-message-status": {
    what:
      "No message-status webhook has arrived from Telnyx. Sends may be leaving " +
      "and never being confirmed, so every message sits on 'sent' forever and " +
      "a genuine delivery failure is indistinguishable from success.",
    doThis:
      "Treat this as the money line in the email. `usage_events` rows are " +
      "written ONLY by `message.finalized`, and nothing anywhere polls Telnyx " +
      "for a status we missed, so every segment sent during this gap is " +
      "unbilled PERMANENTLY — it does not drain later the way " +
      "`job:report-usage` does. Get deliveries flowing again first (same " +
      "`/webhooks/telnyx` route as the other Telnyx keys), then size the hole " +
      "in the Supabase SQL editor: outbound `messages` from the outage window " +
      "with no matching `usage_events` row are the ones you will never " +
      "invoice. Expect `channel:sms-outbound` in the next email too — its " +
      "probe reads the very statuses that stopped arriving, so it is a " +
      "symptom of this and not a second outage.",
    everyMinutes: 60,
    graceMinutes: 720,
  },
  "channel:telnyx-call-events": {
    what:
      "No call event has arrived from Telnyx. Inbound calls would ring nowhere " +
      "and no voicemail would ever be recorded.",
    doThis:
      "This is the one webhook URL a human can have broken. The Call-Control " +
      "application's is the ONLY webhook address anybody ever types into the " +
      "Telnyx portal by hand (docs/deploy/04-telnyx.md §1) — messaging and " +
      "10DLC set theirs programmatically — so if texts are fine and only " +
      "calls are silent, open Voice → Call Control and check that its webhook " +
      "URL and its failover URL are both still " +
      "`https://api.loonext.com/webhooks/telnyx`, and that " +
      "TELNYX_VOICE_CONNECTION_ID still names that application. Then call a " +
      "business number from your own phone: three days of silence is the bar " +
      "here because a small crew really can go that long without a call, and " +
      "one test call settles it — if nothing rings and no voicemail lands, " +
      "every caller for those three days reached nothing.",
    // The widest grace here, because call volume is the lowest: a whole day
    // with no calls is an ordinary day for a small crew, so this key can only
    // ever be a slow backstop. A synthetic call is what would make it sharp.
    everyMinutes: 1440,
    graceMinutes: 2880,
  },
  // ---------------------------------------------------------------------
  // The signature-rejection conjunction (#308) — the sharp instrument, and
  // the only one here that is independent of traffic volume.
  //
  // A rejection is a `return`, not a throw, so Sentry never sees it. Nonzero
  // rejections ALONE are ordinary noise (a retry, a stale delivery, a probe).
  // Rejections with ZERO accepted webhooks in the same window is the rotated-
  // secret shape and nothing else looks like it: the provider believes it is
  // delivering, we believe nothing is arriving, and both are wrong.
  //
  // Expressed as a heartbeat recorded while HEALTHY — the same conjunction the
  // `:work` keys above use, for the same reason: it is the only formulation
  // that does not false-alarm on a platform with no traffic to reject.
  // ---------------------------------------------------------------------
  // The canary (#308) — the fast, unambiguous half.
  //
  // The traffic keys above are wide because customer traffic cannot tell
  // "broken" from "quiet" at this volume. This one generates the traffic, so
  // its silence means something specific and it can afford a tight grace.
  //
  // CONDITIONALLY DECLARED. `runLivenessCheckJob` omits this expectation when
  // the canary is unconfigured — an expectation for something nobody asked
  // for would alert forever about a feature that was never switched on, and
  // that is precisely how this mailbox stops being read.
  "channel:inbound-canary": {
    what:
      "The synthetic inbound canary has not completed a round trip. A text we " +
      "sent from our own number to our own number did not come back as a " +
      "webhook, so the inbound path is broken somewhere between Telnyx and " +
      "our handler — this one is not a quiet hour, because we generated the " +
      "traffic ourselves.",
    doThis:
      "Believe this one — we sent the text ourselves, so its silence is " +
      "evidence rather than a quiet hour, and it is the fastest true signal " +
      "in the whole email. Check whether `channel:telnyx-inbound-message` is " +
      "here as well: together they mean the entire inbound path is down and " +
      "every customer's texts are being swallowed, while the canary ALONE " +
      "means customer webhooks are still arriving and the fault is the canary " +
      "pair itself — CANARY_TO_E164 released, or its number no longer on a " +
      "messaging profile pointing at `/webhooks/telnyx`. Then read " +
      "`inbound_canary_runs`: rows with `confirmed_at` and `send_error` both " +
      "null are the unanswered round trips, and once six of them pile up in a " +
      "day the canary deliberately stops sending, so an absence of new rows " +
      "is the cost cap working and not a second fault.",
    everyMinutes: 60,
    graceMinutes: 150,
  },
  // ---------------------------------------------------------------------
  // #375 — the channel the calls alarms report THROUGH.
  //
  // Every other key here watches a thing that does work. This one watches the
  // ability to complain, which is the dependency all of them share: if
  // DO-scoped Sentry is broken, the §13 cost-cap warnings and the §17 drift
  // alarm do not degrade, they stop existing, and their silence is identical
  // to the healthy state they spend most of their life in.
  //
  // CONDITIONALLY DECLARED, like the inbound canary: omitted when
  // CALL_SESSIONS is unbound, because there is no Durable Object runtime to
  // answer for and an expectation about an undeployed thing alerts forever.
  //
  // The grace is two cadences. One missed probe is a rate limit or a blip;
  // two is a channel that is actually gone, and the fault being watched for
  // does not repair itself.
  // ---------------------------------------------------------------------
  "channel:do-sentry": {
    what:
      "The Durable Object alert channel has not proved itself. Sentry either " +
      "has no client inside the DO isolate or is not accepting its events, " +
      "which by CALLS-V3 §13 makes every cost-cap warning and the §17 " +
      "queue-latency drift alarm a silent no-op. Nothing about the calls " +
      "system is being watched right now, and an outage there would produce " +
      "no alert at all.",
    doThis:
      "Search Workers Logs for `do-sentry-canary: the DO alert channel is NOT " +
      "healthy` — that single line carries the whole diagnosis in its " +
      "parentheses. `client=false` means the §2.1 wrapper is gone from the " +
      "`CallSessionDO` named export in apps/api/src/index.ts, which needs " +
      "code and not configuration; `ingest=429` means Sentry is shedding this " +
      "project's events and the fix is quota, not us; any other status is the " +
      "DSN itself. If the line is absent entirely, the DO never answered — " +
      "look for `the Durable Object did not answer` instead. Rank this above " +
      "any single broken job here: until it is back, every CALLS-V3 §13 " +
      "cost-cap warning and the §17 drift alarm is a silent no-op, so a real " +
      "calls outage would arrive as nothing at all.",
    everyMinutes: 360,
    graceMinutes: 720,
  },
  "channel:webhook-signature": {
    what:
      "Signed provider webhooks are being REJECTED and none are being accepted — " +
      "the signing secret has almost certainly rotated. Every delivery is " +
      "arriving and being discarded, which is invisible on both sides: the " +
      "provider believes it is delivering and nothing here throws.",
    doThis:
      "Find out WHICH provider first, because this email cannot tell you: in " +
      "the Supabase SQL editor, `select provider, sum(rejections) from " +
      "webhook_rejections where hour >= now() - interval '6 hours' group by " +
      "1`. Telnyx means TELNYX_PUBLIC_KEY no longer matches Account → Public " +
      "Key in the Telnyx portal, Stripe means STRIPE_WEBHOOK_SECRET no longer " +
      "matches that endpoint's signing secret, Resend means " +
      "RESEND_WEBHOOK_SECRET — rotate only the one that names itself, since " +
      "nothing rotated all three at once. One caveat before you touch a " +
      "secret: the denominator is accepted TELNYX traffic alone, so a couple " +
      "of Stripe or Resend rejections landing in a genuinely quiet Telnyx " +
      "window can raise this by themselves — a handful of rejections on a " +
      "provider that is otherwise working is that blind spot, not a rotation.",
    everyMinutes: 60,
    graceMinutes: 120,
  },
} as const satisfies Record<string, LivenessExpectation>;

export type LivenessKey = keyof typeof LIVENESS_EXPECTATIONS;

/**
 * The cron schedules this product is allowed to have.
 *
 * `CRON_JOBS` is typed by this, so adding a trigger without declaring what its
 * absence means is a compile error rather than a silent hole. This is the
 * "make declaration mandatory at the point of definition" ask of #387, and the
 * reason it is a type rather than a test: a test can be deleted by whoever is
 * annoyed by it, a type cannot be ignored.
 */
/**
 * The liveness key of a single scheduled job (#333).
 *
 * `CRON_JOBS` entries are `{ key, run }` pairs typed by this, so a job cannot
 * be added to a schedule without declaring what its silence means — the same
 * compile-time move that already governs the schedules themselves.
 */
export type JobKey = Extract<LivenessKey, `job:${string}`>;

export type CronSchedule =
  LivenessKey extends infer K
    ? K extends `cron:${infer Schedule}`
      ? Schedule
      : never
    : never;

/** Record that `key` just happened. Returns true when this ENDED an outage. */
export async function recordHeartbeat(
  env: Env,
  key: LivenessKey,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<boolean> {
  const { data, error } = await db.rpc("record_heartbeat", {
    p_key: key,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`record_heartbeat(${key}) failed: ${error.message}`);
  return (data as { recovered?: boolean } | null)?.recovered === true;
}

/**
 * Record a heartbeat WITHOUT letting a failure take down the caller.
 *
 * Used from `scheduled()`, where the heartbeat is bookkeeping wrapped around
 * the actual work: a liveness write that failed must never be the reason a
 * cron run is reported as broken. The write failing is itself an absence, and
 * the checker notices it one cadence later — which is the mechanism working,
 * not a hole in it.
 */
export async function recordHeartbeatBestEffort(
  env: Env,
  key: LivenessKey,
  now?: Date,
  db?: SupabaseClient,
): Promise<void> {
  try {
    await recordHeartbeat(env, key, now, db);
  } catch (cause) {
    console.error(`liveness: heartbeat ${key} failed to record: ${String(cause)}`);
  }
}
