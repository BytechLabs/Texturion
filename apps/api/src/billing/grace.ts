import { CANCELLATION_GRACE_DAYS, type Locale } from "@loonext/shared";

import { billingRecipients } from "./recipients";
import { NUMBER_NOTICE_COPY } from "../notifications/number-copy";
import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { SupabaseClient } from "@supabase/supabase-js";

import { pushConsequentialNotice } from "./consequential-push";
import type { Env } from "../env";
import { deactivateCampaign } from "../telnyx/registration";
import {
  closeOutDeadProvisioningBestEffort,
  releaseCompanyNumbers,
} from "../telnyx/provisioning";

type Db = ReturnType<typeof getDb>;

/** Grace-warning thresholds with a `grace_notices` ledger row (SPEC §6, §9, §11). */
export type GraceThresholdDay = 1 | 15 | 27;
export const GRACE_THRESHOLD_DAYS: readonly GraceThresholdDay[] = [1, 15, 27];

/**
 * SPEC §1 key rule 2 / §9: numbers are released 30 days after cancellation.
 *
 * Derived from the shared constant rather than declared, because the same 30 is
 * now printed to a customer as a DEADLINE by three clients (the cancel card's
 * consequence copy and the grace-window win-back). This module still owns the
 * clock; it no longer owns a second copy of the number the clients quote.
 */
export const GRACE_PERIOD_DAYS = CANCELLATION_GRACE_DAYS;

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

/** How much of the window is left at a rung. The one place that subtracts. */
function graceDaysLeft(day: GraceThresholdDay): number {
  return GRACE_PERIOD_DAYS - day;
}

/**
 * #228 — the warning ladder's headline for one rung, in one language.
 *
 * The email subject and the push title are the SAME entry rather than the same
 * variable: `pushGraceWarning` used to be handed the subject string, which made
 * "both channels say the same thing" true only for as long as nobody passed a
 * different one. Now both read this.
 */
function graceTitle(
  locale: Locale,
  day: GraceThresholdDay,
  daysLeft: number,
): string {
  const copy = NUMBER_NOTICE_COPY[locale];
  // A Record over the rungs rather than a chain of ternaries, so a fourth
  // threshold day is a type error here instead of silently inheriting the last
  // arm's sentence — which is what the shape this replaced would have done.
  const rungs: Record<GraceThresholdDay, (daysLeft: number) => string> = {
    1: copy.graceDay1Title,
    15: copy.graceDay15Title,
    27: copy.graceDay27Title,
  };
  return rungs[day](daysLeft);
}

function warningCopy(
  company: CanceledCompany,
  day: GraceThresholdDay,
  env: Env,
): { subject: string; text: string } {
  const resubscribeUrl = `${env.APP_ORIGIN}/settings/billing`;
  const daysLeft = graceDaysLeft(day);
  // ENGLISH, PINNED. `billingRecipients` returns addresses, not readers, and the
  // body below is English prose with no translation — a French subject on an
  // English letter would be worse than an English one. The reader's language
  // only enters on the push, which knows who it is waking.
  const subject = graceTitle("en", day, daysLeft);
  const opening =
    `Hi,\n\nThe Loonext subscription for ${company.name} is canceled. ` +
    `Your business phone number is suspended but reserved for ${GRACE_PERIOD_DAYS} days ` +
    `from cancellation. You still have about ${daysLeft} day${daysLeft === 1 ? "" : "s"} ` +
    `to resubscribe and keep it, with your full message history intact.\n\n`;

  /**
   * #413 — what "released" actually means, said from day 15 onward.
   *
   * The old copy said the number is "permanently released and cannot be
   * recovered", which is true about US and reads as "it is gone". The truth is
   * that it goes back into carrier inventory and gets **reassigned to another
   * business**. It is recycled, not deleted.
   *
   * Those are materially different facts and only one of them prompts action:
   * the customer's own customers have that number saved, keep texting it, and
   * eventually reach a stranger — with an address, sometimes a gate code,
   * sometimes a photo of the inside of a house. Same standard DELETION.md sets
   * for data ("a deletion feature that claims total erasure is lying"), applied
   * to numbers.
   *
   * NOT on day 1, deliberately. Day 1 is "nothing is lost yet, here is how to
   * come back"; loading it with what happens in four weeks makes the one message
   * that should be reassuring alarming instead, and there is nothing to act on
   * yet.
   */
  const reassignment =
    `When the ${GRACE_PERIOD_DAYS} days are up the number does not disappear — it goes ` +
    `back to the phone company and can be given to another business. Anyone who ` +
    `still has it saved and texts it will reach whoever has it next, not you.\n\n`;

  /**
   * #413 ask 2 — the single most useful sentence we can send a departing
   * customer, and it costs us nothing: they are leaving either way.
   *
   * Only at day 27, when it is urgent and the deadline is concrete. Encouraging a
   * port-out was worth checking against #398 (nothing noticed a number leaving);
   * that is closed, so we are no longer blind to the action we are recommending.
   */
  const wayOut =
    `If you want to keep this number, port it out to another carrier or a personal ` +
    `line before ${releaseDateLabel(company.canceled_at)}. Your new carrier starts ` +
    `that, not us, and it takes them a few business days — so begin now rather than ` +
    `on the last day.\n\n` +
    `It is also worth telling your own customers your new number before the ` +
    `deadline. One message from you now saves them texting a stranger later.\n\n`;

  const body =
    day === 1
      ? opening
      : day === 15
        ? opening + reassignment
        : opening + reassignment + wayOut;

  return { subject, text: `${body}Resubscribe: ${resubscribeUrl}\n\nLoonext` };
}

/**
 * The release date, as a person reads it. #413 ask 2 needs a concrete deadline —
 * "before the deadline" is not something anybody can act on.
 *
 * UTC, and deliberately not localised: the grace clock is computed in UTC, so
 * formatting in a guessed timezone could print a date a day either side of the one
 * the job will actually act on. A date that is off by one in a final notice is
 * worse than a date with no timezone.
 */
function releaseDateLabel(canceledAt: string): string {
  const release = new Date(new Date(canceledAt).getTime() + GRACE_PERIOD_DAYS * DAY_MS);
  return release.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function releasedCopy(company: CanceledCompany): {
  subject: string;
  text: string;
} {
  return {
    // English, pinned, for the same reason as the warnings' subject above.
    subject: NUMBER_NOTICE_COPY.en.numberReleasedTitle,
    text:
      `Hi,\n\nThe ${GRACE_PERIOD_DAYS}-day grace period for ${company.name} has ended, ` +
      `and your business phone number has been released. Your conversation history ` +
      `remains available if you sign back in.\n\n` +
      // #413: this is the moment it stops being a warning and becomes a fact. The
      // number is back in carrier inventory now and may already belong to someone
      // else, so the one useful thing left to say is what a customer texting the
      // old number will experience — and that we cannot get it back for them.
      `The number has gone back to the phone company and can be reassigned to ` +
      `another business, so anyone still texting it may now reach a stranger. We ` +
      `cannot get it back — not even if you resubscribe today. If your customers ` +
      `still have it saved, tell them your new number.\n\n` +
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
  // #252: the critical stream. Every rung of this ladder is a deadline
  // after which the customer's business number is gone.
  await sendEmail(env, {
    to,
    subject,
    text,
    html: renderEmailHtml(text),
    critical: true,
  });
  await pushGraceWarning(env, db, company, thresholdDay);
  return true;
}

/**
 * #252: the release warning also goes to the phone.
 *
 * Losing a business number is the most expensive thing that can happen to a
 * workspace here, and until now the ONLY warning was an email — to an address
 * that may bounce, may be filtered, and whose deliverability this very issue
 * exists because we could not vouch for. "Belt and braces on the ones that
 * matter": a notice this consequential must not depend on one channel we do
 * not fully control.
 *
 * BEST-EFFORT, AND AFTER THE EMAIL. The ledger row is already claimed by the
 * time this runs, so a push failure must never make the caller think the
 * warning was not sent — it was, by the channel that has always carried it.
 * Throwing here would also re-run the whole notice on the next sweep, and the
 * claim would refuse it, so the email would not resend either.
 *
 * NO CONTENT TO WITHHOLD. This is our own sentence about the workspace's own
 * billing, not a customer's words, so #430 has nothing to hide here.
 */
async function pushGraceWarning(
  env: Env,
  db: SupabaseClient,
  company: CanceledCompany,
  thresholdDay: GraceThresholdDay,
): Promise<void> {
  const daysLeft = graceDaysLeft(thresholdDay);
  // #228: composed per reader, unlike the email that has just gone — a push is
  // delivered to a person whose language `deliverPush` has resolved, an email
  // to an address that is nobody in particular. So the two channels stop
  // sharing one STRING while still sharing one ENTRY: `graceTitle` is what the
  // subject was built from a moment ago, asked again in the reader's language.
  await pushConsequentialNotice(env, db, {
    companyId: company.id,
    title: (locale: Locale) => graceTitle(locale, thresholdDay, daysLeft),
    body: (locale: Locale) => NUMBER_NOTICE_COPY[locale].graceBody,
    path: "/settings/billing",
    collapseKey: `grace:${company.id}:${thresholdDay}`,
  });
}

/**
 * Canceled companies older than the notice window that STILL own something the
 * release was supposed to take back: a number not yet released, or a campaign
 * still live on Telnyx. Both are recurring charges.
 *
 * Two narrow reads rather than one scan of the whole churn history: a company
 * shows up only while it still owes work, so the set is empty on a healthy day.
 */
async function companiesWithUnreleasedResources(
  db: ReturnType<typeof getDb>,
  olderThan: string,
): Promise<CanceledCompany[]> {
  type EmbeddedCompany = { id: string; name: string; canceled_at: string | null };
  const found = new Map<string, CanceledCompany>();

  // A to-one embed arrives as an object, while the generated types describe it
  // as an array. Accept either rather than trusting one shape.
  const collect = (rows: unknown) => {
    for (const row of (rows as { companies?: unknown }[] | null) ?? []) {
      const embedded = row.companies;
      const companies: EmbeddedCompany[] = Array.isArray(embedded)
        ? (embedded as EmbeddedCompany[])
        : embedded
          ? [embedded as EmbeddedCompany]
          : [];
      for (const company of companies) {
        if (company?.canceled_at) {
          found.set(company.id, {
            id: company.id,
            name: company.name,
            canceled_at: company.canceled_at,
          });
        }
      }
    }
  };

  const { data: numbers, error: numbersError } = await db
    .from("phone_numbers")
    .select("company_id,companies!inner(id,name,canceled_at)")
    .neq("status", "released")
    .eq("companies.subscription_status", "canceled")
    .is("companies.deleted_at", null)
    .lt("companies.canceled_at", olderThan);
  if (numbersError) {
    throw new Error(`unreleased numbers lookup failed: ${numbersError.message}`);
  }
  collect(numbers);

  const { data: campaigns, error: campaignsError } = await db
    .from("messaging_registrations")
    .select("company_id,companies!inner(id,name,canceled_at)")
    .eq("kind", "campaign")
    .not("telnyx_id", "is", null)
    .is("deactivated_at", null)
    .eq("companies.subscription_status", "canceled")
    .is("companies.deleted_at", null)
    .lt("companies.canceled_at", olderThan);
  if (campaignsError) {
    throw new Error(`live campaigns lookup failed: ${campaignsError.message}`);
  }
  collect(campaigns);

  return [...found.values()];
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
  await sendEmail(env, {
    to,
    subject,
    text,
    html: renderEmailHtml(text),
    critical: true,
  });

  // #252: the last of the consequential notices, and the only one that is
  // already true when it arrives. Nobody should learn their business number is
  // gone by noticing it stopped working — least of all through the one channel
  // whose deliverability this issue exists because we could not vouch for.
  await pushConsequentialNotice(env, db, {
    companyId: company.id,
    // #228: per reader, like the warnings above, and off the same entry the
    // English subject was just built from.
    title: (locale: Locale) => NUMBER_NOTICE_COPY[locale].numberReleasedTitle,
    body: (locale: Locale) => NUMBER_NOTICE_COPY[locale].numberReleasedBody,
    path: "/settings/billing",
    collapseKey: `grace:${company.id}:released`,
  });
}

/**
 * Daily grace & release cron body (SPEC §11): for every `canceled` company,
 * close out any provisioning row that never became a number (#526 — the loop
 * argues why this job is where that belongs), send the day-1/15/27 warnings
 * through the `grace_notices` ledger, and at ≥30 days release the numbers +
 * deactivate the campaign + send the final email (ledgered as the synthetic
 * day-30 notice, #54). Work is selected by state (status + `canceled_at` age)
 * plus the ledger, never by "last run" bookkeeping, so re-runs and overlaps are
 * safe.
 *
 * `now` is injected so the clock is a parameter, never buried logic; the
 * scheduled handler passes the trigger's time.
 */
export async function runGraceJob(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb(env);
  // Bound the scan to the ACTIONABLE window: the day-30 release notice is the
  // last grace action, so a company canceled longer ago than that (+ a few
  // days' margin) has no remaining work — every notice already ledgered. Without
  // this lower bound the scan grows with the ENTIRE churn history forever and
  // could silently truncate recent cancellations behind a large row cap.
  const graceCutoff = new Date(
    now.getTime() - (GRACE_RELEASED_NOTICE_DAY + 3) * DAY_MS,
  ).toISOString();
  const { data, error } = await db
    .from("companies")
    .select("id,name,canceled_at")
    .eq("subscription_status", "canceled")
    .not("canceled_at", "is", null)
    .gte("canceled_at", graceCutoff)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`canceled companies lookup failed: ${error.message}`);
  }

  // Anything the release could not finish stays in scope until it is finished.
  //
  // The window above is right for NOTICES, which genuinely stop being owed, and
  // wrong for the release itself. A release failure is re-thrown on purpose so
  // the daily cron retries, but the retries only lasted while the company sat
  // inside the window: four attempts. A Telnyx number that is mid-port, or a
  // campaign the API keeps refusing, or four days of a broken cron, and the
  // company aged out with its number never deleted and its campaign never
  // deactivated. Nothing else reclaims those: the number reconcile skips
  // canceled companies, and its orphan scan only looks for numbers it does not
  // know about, while a suspended row is perfectly well known. The rent and the
  // monthly campaign fee then bill a churned tenant forever, silently.
  //
  // Bounded by OUTSTANDING WORK rather than by age, so it stays small: a
  // company appears here only while it still owns something to release.
  const stragglers = await companiesWithUnreleasedResources(db, graceCutoff);
  const seen = new Set((data ?? []).map((row) => (row as CanceledCompany).id));
  const queue = [
    ...((data ?? []) as CanceledCompany[]),
    ...stragglers.filter((row) => !seen.has(row.id)),
  ];

  const failures: unknown[] = [];
  for (const company of queue) {
    try {
      // #526 — the standing pass over the rows that are not numbers.
      //
      // `suspendCompanyNumbers` closes these out on the cancellation webhook,
      // and that is one instant in time. It cannot see a saga that records its
      // failure a second later, or a 180-second lease that expires tomorrow,
      // and it could never have reached a workspace that was ALREADY sitting in
      // the grace window — which is precisely the cohort it was written for. A
      // one-shot migration would have fixed those and nothing after them.
      //
      // This loop already walks exactly the right set, every day: `canceled`
      // workspaces inside the window plus the stragglers that still owe a
      // release. That is the only cohort in which a `provisioning` row is inert
      // rather than a purchase in flight, which is what makes closing one out
      // safe at all. So the same question is asked again here, and converges.
      //
      // The window is not academic: every workspace in it can resubscribe at
      // any moment, and the allowance a resubscribe settles against counts
      // every row that is not `released` — so a ghost left open holds the slot
      // the workspace's real, working number needs, and the owner is told their
      // number is on hold instead.
      await closeOutDeadProvisioningBestEffort(db, company.id, "grace");
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
