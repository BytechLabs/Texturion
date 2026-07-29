/**
 * #452 — the meter on HIGH-priority push.
 *
 * FCM HIGH and APNs priority 10 wake a phone out of Doze. They are a rationed
 * resource: Google throttles apps that overuse them, and the throttling is
 * applied to the app rather than to the offending message, so the penalty
 * lands on exactly the notifications that most needed to arrive. That is a
 * budget denominated in platform goodwill rather than dollars — which is why
 * it went four features deep without anybody counting it.
 *
 * `ai/run.ts` makes every AI cost centre declare a cap and an alert threshold
 * before it may spend. This is the same discipline for the same reason; the
 * only difference is the currency.
 *
 * EVERY high-priority request in the codebase goes through `claimHighPriority`
 * — the shared fan-out in `deliver.ts`, and the two pipelines in
 * `incoming-call.ts` / `call-end.ts` that deliberately keep their own. There
 * is no fourth path, and `PushDelivery` is typed so that asking for HIGH
 * without naming a company and a reason does not compile.
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { billingRecipients } from "../billing/recipients";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/**
 * Which feature is spending. Recorded per company per day so a spike can be
 * attributed to the feature that caused it rather than to "push".
 *
 * `lead` and `lead_chase` share ONE ceiling; the other three are counted and
 * never capped. That split is a shape argument rather than a volume one. A
 * `ring` and a `call_end` require a phone call to have actually happened, and
 * a ring delivered at NORMAL priority is not a ring; an `emergency` requires
 * one of the four fixed words in EMERGENCY_KEYWORDS. None of those can be
 * manufactured from outside at volume. The two lead reasons both fire off
 * inbound text volume, which is the one input an outsider controls — and they
 * share a ceiling rather than holding one each precisely because they share
 * that input, so a flood cannot spend the budget twice.
 *
 * The capped set is enforced in `claim_high_priority_push`, not here, so the
 * two cannot drift.
 */
export type HighPriorityReason =
  | "lead"
  | "lead_chase"
  | "emergency"
  | "ring"
  | "call_end";

/**
 * Names the company being spent on and the feature spending. Required to
 * request HIGH — see `PushDelivery.highPriority`.
 */
export interface HighPriorityRequest {
  companyId: string;
  reason: HighPriorityReason;
}

/**
 * Daily ceiling on lead-driven HIGH-priority NATIVE DEVICE sends, per company,
 * shared by `lead` and `lead_chase`. Overridable per company (ops-only,
 * `companies.high_priority_push_limit`).
 *
 * HOW THIS WAS PICKED. The metered unit is one device, because the device is
 * what the platform counts. A ten-person crew carrying two devices each is 20
 * device sends per lead, and a new conversation is unassigned, so a lead wakes
 * the whole crew rather than one person. The #388 ladder can add two more
 * rungs on top of that, so budget ~60 device sends per unanswered lead. 2000
 * is therefore ~30 unanswered new conversations a day for the largest crew D12
 * describes, or ~100 answered ones — well past a real trades day, and still a
 * hard bound on somebody blasting inbound texts to wake twenty phones at full
 * priority each time.
 *
 * Deliberately NOT per-plan, unlike the #343 ceilings: this protects our
 * standing with Google, which does not improve because a customer pays more.
 */
export const HIGH_PRIORITY_PUSH_DAILY_LIMIT = 2000;

export interface HighPriorityClaim {
  /** False means: send this delivery at NORMAL instead. Never "do not send". */
  allowed: boolean;
  /** 80 or 100 the first time the day's ledger crosses that mark, else null. */
  alert: 80 | 100 | null;
}

/** Fail-open: metering must never be the reason a phone does not ring. */
const OPEN: HighPriorityClaim = { allowed: true, alert: null };

/**
 * Claim `sends` native device sends at HIGH priority for one company.
 *
 * NEVER THROWS, and fails OPEN. Two reasons. The uncapped reasons run on the
 * live-call path, whose whole contract is that push weather cannot break a
 * call. And for the capped one, the bound exists to shape spend across days,
 * not milliseconds: leaving it unbounded for the length of a database outage
 * is plainly better than degrading every lead in the country to NORMAL because
 * a counter was unreachable. The failure is reported rather than swallowed.
 */
export async function claimHighPriority(
  db: SupabaseClient,
  request: HighPriorityRequest,
  sends: number,
): Promise<HighPriorityClaim> {
  if (sends <= 0) return OPEN;
  try {
    const { data, error } = await db.rpc("claim_high_priority_push", {
      p_company_id: request.companyId,
      p_reason: request.reason,
      p_sends: sends,
      p_default_limit: HIGH_PRIORITY_PUSH_DAILY_LIMIT,
    });
    if (error) throw new Error(error.message);
    const row = (data ?? {}) as { allowed?: boolean; alert?: number | null };
    return {
      // An absent verdict reads as allowed, matching the fail-open posture.
      allowed: row.allowed !== false,
      alert: row.alert === 80 || row.alert === 100 ? row.alert : null,
    };
  } catch (cause) {
    const message =
      `high-priority push meter failed for company ${request.companyId} ` +
      `(${request.reason}): ${cause instanceof Error ? cause.message : String(cause)}`;
    console.error(message);
    Sentry.captureMessage(message, "warning");
    return OPEN;
  }
}

/**
 * The ops alert. Ops-only, deliberately: this is our standing with Google, not
 * the customer's bill, and there is nothing an owner could do about it — the
 * same call #448 made for per-dial fees.
 *
 * Exactly-once is the ledger stamp's guarantee, inside `claim_high_priority_push`;
 * this only renders and sends. Never throws, for the same reason the claim does
 * not: an alert about push must not break push.
 */
export async function reportHighPriorityPushAlert(
  env: Env,
  db: SupabaseClient,
  request: HighPriorityRequest,
  threshold: 80 | 100,
): Promise<void> {
  try {
    const { data, error } = await db
      .from("companies")
      .select("name")
      .eq("id", request.companyId)
      .limit(1);
    if (error) throw new Error(error.message);
    const name =
      (data?.[0] as { name: string } | undefined)?.name ?? request.companyId;

    // Who the owner/admins are is useful context for the ops reader deciding
    // whether this is a real crew having a huge day or an abuse pattern.
    let owners = "";
    try {
      const recipients = await billingRecipients(env, request.companyId, db);
      if (recipients.length > 0) owners = recipients.join(", ");
    } catch {
      // Context, not the alert. Losing it must not lose the alert.
    }

    const text =
      (threshold === 100
        ? `${name} has reached today's ceiling of ${HIGH_PRIORITY_PUSH_DAILY_LIMIT} ` +
          `high-priority device pushes for new leads. Further lead ` +
          `notifications today are being delivered at NORMAL priority — they ` +
          `are still sent, they just will not wake a phone out of Doze.\n\n`
        : `${name} has used 80% of today's ceiling of ` +
          `${HIGH_PRIORITY_PUSH_DAILY_LIMIT} high-priority device pushes for ` +
          `new leads. Past the ceiling, lead notifications degrade to NORMAL ` +
          `priority for the rest of their local day.\n\n`) +
      `Company: ${name} (${request.companyId})\n` +
      (owners ? `Owner/admins: ${owners}\n` : "") +
      `Reason: ${request.reason}\n\n` +
      `High-priority push is rationed by Google and Apple, and overuse is ` +
      `penalised app-wide rather than per message. Check whether this is a ` +
      `genuinely busy crew (raise companies.high_priority_push_limit) or an ` +
      `inbound flood (check the workspace for spam threads).\n\n` +
      `Last 7 days by company: select api_high_priority_push_report(7);\n`;

    await sendEmail(env, {
      to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
      subject:
        threshold === 100
          ? `[ops] ${name} hit the high-priority push ceiling`
          : `[ops] ${name} is nearing the high-priority push ceiling`,
      text,
      html: renderEmailHtml(text),
    });
  } catch (cause) {
    const message =
      `high-priority push alert (${threshold}%) failed for company ` +
      `${request.companyId}: ${cause instanceof Error ? cause.message : String(cause)}`;
    console.error(message);
    Sentry.captureMessage(message, "warning");
  }
}

/**
 * Claim, then alert if the claim crossed a rung. The one call every sender
 * makes; returns the urgency to actually send at.
 */
export async function resolveHighPriority(
  env: Env,
  db: SupabaseClient,
  request: HighPriorityRequest,
  sends: number,
): Promise<"normal" | "high"> {
  const claim = await claimHighPriority(db, request, sends);
  if (claim.alert !== null) {
    await reportHighPriorityPushAlert(env, db, request, claim.alert);
  }
  return claim.allowed ? "high" : "normal";
}
