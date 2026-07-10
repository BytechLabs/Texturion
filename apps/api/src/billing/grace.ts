import { billingRecipients } from "./recipients";
import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { deactivateCampaign } from "../telnyx/registration";
import { releaseCompanyNumbers } from "../telnyx/provisioning";

type Db = ReturnType<typeof getDb>;

/** Grace-warning thresholds with a `grace_notices` ledger row (SPEC §6, §9, §11). */
export type GraceThresholdDay = 1 | 15 | 27;
export const GRACE_THRESHOLD_DAYS: readonly GraceThresholdDay[] = [1, 15, 27];

/** SPEC §1 key rule 2 / §9: numbers are released 30 days after cancellation. */
export const GRACE_PERIOD_DAYS = 30;

/**
 * #54: the synthetic `grace_notices.threshold_day` for the day-30 "number
 * released" email. The release email shares the warnings' insert-first ledger
 * so an overlapping cron run can never double-send it, and a run that crashed
 * after releasing (or a failed Resend call) sends it on the next run instead
 * of silently returning at the release-state check.
 */
export const GRACE_RELEASED_NOTICE_DAY = 30;

/** Every ledgered notice: the 1/15/27 warnings + the day-30 released email. */
type GraceNoticeDay = GraceThresholdDay | typeof GRACE_RELEASED_NOTICE_DAY;

const DAY_MS = 24 * 60 * 60 * 1000;

interface CanceledCompany {
  id: string;
  name: string;
  canceled_at: string;
}

function warningCopy(
  company: CanceledCompany,
  day: GraceThresholdDay,
  env: Env,
): { subject: string; text: string } {
  const resubscribeUrl = `${env.APP_ORIGIN}/settings/billing`;
  const daysLeft = GRACE_PERIOD_DAYS - day;
  const subjects: Record<GraceThresholdDay, string> = {
    1: `Your Loonext subscription was canceled. Your number is safe for ${daysLeft} more days`,
    15: `${daysLeft} days left before your Loonext business number is released`,
    27: `Final notice: your Loonext business number is released in ${daysLeft} days`,
  };
  const text =
    `Hi,\n\nThe Loonext subscription for ${company.name} is canceled. ` +
    `Your business phone number is suspended but reserved for ${GRACE_PERIOD_DAYS} days ` +
    `from cancellation. You still have about ${daysLeft} day${daysLeft === 1 ? "" : "s"} ` +
    `to resubscribe and keep it, with your full message history intact.\n\n` +
    `After that the number is permanently released and cannot be recovered.\n\n` +
    `Resubscribe: ${resubscribeUrl}\n\nLoonext`;
  return { subject: subjects[day], text };
}

function releasedCopy(company: CanceledCompany): {
  subject: string;
  text: string;
} {
  return {
    subject: "Your Loonext business number has been released",
    text:
      `Hi,\n\nThe ${GRACE_PERIOD_DAYS}-day grace period for ${company.name} has ended, ` +
      `and your business phone number has been released. Your conversation history ` +
      `remains available if you sign back in.\n\n` +
      `If you resubscribe, we'll set you up with a new number and re-run US carrier ` +
      `registration where required.\n\nLoonext`,
  };
}

/**
 * Claim the `(company_id, canceled_at, threshold_day)` ledger row. True means
 * this caller inserted the row and owns sending the matching email; false
 * means another run already claimed it. The §9 `subscription.deleted`
 * handler and the §11 cron share this ledger, so overlap can never
 * double-send.
 */
async function claimGraceNotice(
  db: Db,
  company: CanceledCompany,
  thresholdDay: GraceNoticeDay,
): Promise<boolean> {
  const { data, error } = await db
    .from("grace_notices")
    .upsert(
      {
        company_id: company.id,
        canceled_at: company.canceled_at,
        threshold_day: thresholdDay,
      },
      {
        onConflict: "company_id,canceled_at,threshold_day",
        ignoreDuplicates: true,
      },
    )
    .select("company_id");
  if (error) {
    throw new Error(`grace_notices insert failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/**
 * Insert the ledger row FIRST and only send when the insert actually landed
 * (see {@link claimGraceNotice}). Returns whether this call sent the email.
 */
export async function recordAndSendGraceNotice(
  env: Env,
  company: CanceledCompany,
  thresholdDay: GraceThresholdDay,
): Promise<boolean> {
  const db = getDb(env);
  if (!(await claimGraceNotice(db, company, thresholdDay))) {
    return false; // ledger says already sent
  }

  const to = await billingRecipients(env, company.id, db);
  if (to.length === 0) return false;
  const { subject, text } = warningCopy(company, thresholdDay, env);
  await sendEmail(env, { to, subject, text, html: renderEmailHtml(text) });
  return true;
}

/**
 * Release day-30 work: hand the numbers back via the telnyx track, deactivate
 * the 10DLC campaign (stops the recurring campaign fee — SPEC §4.4, §11), and
 * send the final email. The release/deactivate calls are state-gated for
 * idempotency (§11: "status transitions are one-way; release skips
 * already-released rows"); the EMAIL is gated by the day-30 `grace_notices`
 * ledger row instead (#54) — insert-first like the warnings, so overlapping
 * cron runs cannot double-send, and a run that crashed between releasing and
 * emailing still sends on the next run instead of returning at the state
 * check and losing the email forever.
 */
async function releaseExpiredCompany(
  env: Env,
  company: CanceledCompany,
): Promise<void> {
  const db = getDb(env);

  const { count, error: numbersError } = await db
    .from("phone_numbers")
    .select("id", { count: "exact", head: true })
    .eq("company_id", company.id)
    .neq("status", "released");
  if (numbersError) {
    throw new Error(`phone_numbers lookup failed: ${numbersError.message}`);
  }
  const numbersToRelease = count ?? 0;

  const { data: campaignRows, error: campaignError } = await db
    .from("messaging_registrations")
    .select("id")
    .eq("company_id", company.id)
    .eq("kind", "campaign")
    .not("telnyx_id", "is", null)
    .is("deactivated_at", null)
    .limit(1);
  if (campaignError) {
    throw new Error(
      `messaging_registrations lookup failed: ${campaignError.message}`,
    );
  }
  const campaignActive = (campaignRows ?? []).length > 0;

  if (numbersToRelease > 0) await releaseCompanyNumbers(env, company.id);
  if (campaignActive) await deactivateCampaign(env, company.id);

  // #54: the released email runs off the ledger, NOT the state check above —
  // a failure in either release call has already thrown (the claim never runs
  // before the release work is durably done), and once the claim lands
  // exactly one run sends. The common already-processed daily pass is a
  // single no-op upsert.
  if (!(await claimGraceNotice(db, company, GRACE_RELEASED_NOTICE_DAY))) {
    return;
  }

  // A canceled tenant that never provisioned a number has nothing released —
  // "your business phone number has been released" would be false. The ledger
  // row above is still claimed, so this check runs once per cancellation.
  const { data: everRows, error: everError } = await db
    .from("phone_numbers")
    .select("id")
    .eq("company_id", company.id)
    .limit(1);
  if (everError) {
    throw new Error(`phone_numbers lookup failed: ${everError.message}`);
  }
  if ((everRows ?? []).length === 0) return;

  const to = await billingRecipients(env, company.id, db);
  if (to.length === 0) return;
  const { subject, text } = releasedCopy(company);
  await sendEmail(env, { to, subject, text, html: renderEmailHtml(text) });
}

/**
 * Daily grace & release cron body (SPEC §11): for every `canceled` company,
 * send the day-1/15/27 warnings through the `grace_notices` ledger, and at
 * ≥30 days release the numbers + deactivate the campaign + send the final
 * email (ledgered as the synthetic day-30 notice, #54). Work is selected by
 * state (status + `canceled_at` age) plus the ledger, never by "last run"
 * bookkeeping, so re-runs and overlaps are safe.
 *
 * `now` is injected so the clock is a parameter, never buried logic; the
 * scheduled handler passes the trigger's time.
 */
export async function runGraceJob(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb(env);
  const { data, error } = await db
    .from("companies")
    .select("id,name,canceled_at")
    .eq("subscription_status", "canceled")
    .not("canceled_at", "is", null)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`canceled companies lookup failed: ${error.message}`);
  }

  const failures: unknown[] = [];
  for (const company of (data ?? []) as CanceledCompany[]) {
    try {
      const canceledAt = new Date(company.canceled_at).getTime();
      const daysElapsed = Math.floor((now.getTime() - canceledAt) / DAY_MS);

      for (const day of GRACE_THRESHOLD_DAYS) {
        if (daysElapsed >= day) {
          await recordAndSendGraceNotice(env, company, day);
        }
      }
      if (daysElapsed >= GRACE_PERIOD_DAYS) {
        await releaseExpiredCompany(env, company);
      }
    } catch (cause) {
      // One broken tenant must not starve the rest; rethrown below so the
      // cron run still reports failure (Sentry wraps scheduled()).
      failures.push(cause);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `grace job failed for ${failures.length} compan${failures.length === 1 ? "y" : "ies"}`,
    );
  }
}
