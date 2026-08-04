/**
 * #386 ask 3 — alert on the DOMAIN's bounce and complaint rates.
 *
 * Per-message alerting would be noise. Reputation is a rolling, domain-level
 * property: mailbox providers judge our sending domain, not the tenant whose
 * crew member mistyped an address. So one stale mailbox in one workspace can
 * push every customer's notifications into spam, and the only number that sees
 * it coming is this one.
 *
 * The cap here is the reputation cliff, and it is ONE-WAY — a throttled
 * sending domain is not something a deploy fixes. The cost-protection mandate
 * says alert BEFORE the cap, so both thresholds below sit well under the level
 * at which providers actually act.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import { emailLayout } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

import {
  postureAlertText,
  postureDomainFor,
  postureProblems,
  readAuthPosture,
  shouldAlertNow,
} from "./auth-posture";

/**
 * Bounce rate that gets somebody's attention.
 *
 * Providers start treating a sender as careless around 5%. Three is early
 * enough to find the bad address and late enough not to fire on a single
 * typo in a quiet week.
 */
const BOUNCE_RATE_ALERT = 0.03;

/**
 * Complaint rate that gets somebody's attention.
 *
 * Gmail and Yahoo's bulk-sender rules put the enforcement line at 0.3% and
 * ask senders to stay under 0.1%. This fires under both, because by the time
 * you are AT the enforcement line the damage is already being applied.
 */
const COMPLAINT_RATE_ALERT = 0.0008;

/**
 * Below this many events, a rate is arithmetic rather than a signal.
 *
 * One bounce out of four is a 25% bounce rate and means nothing at all. A
 * threshold that pages on that teaches the founder to ignore this mailbox,
 * which costs more than the outage it was trying to prevent.
 */
const MIN_EVENTS = 50;

const WINDOW_HOURS = 24;

interface EmailHealth {
  window_hours: number;
  delivered: number;
  bounced: number;
  complained: number;
  total: number;
  bounce_rate: number | null;
  complaint_rate: number | null;
  suppressed_total: number;
}

export async function runEmailHealthJob(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<{ alerted: boolean; health: EmailHealth | null }> {
  // #252: the posture check rides this job rather than getting a cron of its
  // own. It is the same subject — whether our mail arrives — and a second
  // schedule for three DNS lookups is a second thing to notice has stopped
  // running. Best-effort and first, so a resolver having a bad day can never
  // cost us the rate alert, which is the one with real numbers behind it.
  await checkAuthPosture(env, now).catch((cause) => {
    console.error(`email auth posture check failed: ${String(cause)}`);
  });

  const { data, error } = await db.rpc("api_email_health", {
    p_now: now.toISOString(),
    p_window_hours: WINDOW_HOURS,
  });
  if (error) throw new Error(`api_email_health failed: ${error.message}`);

  const health = data as EmailHealth | null;
  if (!health || health.total < MIN_EVENTS) return { alerted: false, health };

  const bounceRate = health.bounce_rate ?? 0;
  const complaintRate = health.complaint_rate ?? 0;
  const problems: string[] = [];

  if (bounceRate >= BOUNCE_RATE_ALERT) {
    problems.push(
      `Bounce rate ${pct(bounceRate)} (${health.bounced} of ${health.total}), ` +
        `over the ${pct(BOUNCE_RATE_ALERT)} line.`,
    );
  }
  if (complaintRate >= COMPLAINT_RATE_ALERT) {
    problems.push(
      `Complaint rate ${pct(complaintRate)} (${health.complained} of ${health.total}), ` +
        `over the ${pct(COMPLAINT_RATE_ALERT)} line.`,
    );
  }
  if (problems.length === 0) return { alerted: false, health };

  const text =
    `Email deliverability is drifting over the last ${WINDOW_HOURS} hours.\n\n` +
    `${problems.map((line) => `• ${line}`).join("\n")}\n\n` +
    `${health.suppressed_total} address(es) are currently suppressed.\n\n` +
    `This is a DOMAIN-level number, not one tenant's. Mailbox providers judge ` +
    `the sending domain, so one workspace's stale address degrades delivery ` +
    `for every customer — and the first symptom would be everybody's ` +
    `notifications quietly landing in spam.\n\n` +
    `The reputation cliff is one-way: a throttled domain is not something a ` +
    `deploy fixes. Find the addresses in email_events and confirm SPF, DKIM ` +
    `and DMARC are still aligned for the sending domain.`;

  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: `[ops] email deliverability drifting (${problems.length} threshold(s) crossed)`,
    text,
    html: emailLayout(
      `<p><strong>Email deliverability is drifting.</strong></p><ul>` +
        problems.map((line) => `<li>${escapeText(line)}</li>`).join("") +
        `</ul>`,
    ),
  });

  return { alerted: true, health };
}

/**
 * #252 — is our SPF/DKIM/DMARC still what the deploy doc says it is?
 *
 * Runs at most once a day (see `shouldAlertNow`) even though this job is
 * hourly: the gap it watches is a DNS record somebody has to go and add, and
 * twenty-four copies of the same sentence before anybody could act on the
 * first is how a mailbox stops being read.
 *
 * Never throws. The caller's rate alert is the one with real numbers behind
 * it, and a DNS lookup must not be able to take it down.
 */
async function checkAuthPosture(env: Env, now: Date): Promise<void> {
  if (!shouldAlertNow(now)) return;
  const domain = postureDomainFor(env);
  // No sending address configured at all — nothing to check, and nothing
  // being sent either.
  if (!domain) return;

  const posture = await readAuthPosture(domain);
  const problems = postureProblems(posture);
  if (problems.length === 0) return;

  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: `[ops] email authentication gap on ${domain} (${problems.length})`,
    text: postureAlertText(posture, problems),
    html: emailLayout(
      `<p><strong>Email authentication on ${escapeText(domain)} is not what ` +
        `the deploy doc records.</strong></p><ul>` +
        problems.map((line) => `<li>${escapeText(line)}</li>`).join("") +
        `</ul>`,
    ),
  });
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
