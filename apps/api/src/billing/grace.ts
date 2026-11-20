import { CANCELLATION_GRACE_DAYS, numberReleaseAt } from "@loonext/shared";
import type { Locale } from "@loonext/shared";

import { sendBillingEmailGroups, sendLedgered } from "./send-ledgered";
import { captureException } from "../observability/capture";
import { getStripe } from "./stripe";
import { billingRecipientsByLocale } from "./recipients";
import { NUMBER_NOTICE_COPY } from "../notifications/number-copy";
import { getDb } from "../db";
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
const GRACE_TITLE_KEYS = {
  1: "graceDay1Title",
  15: "graceDay15Title",
  27: "graceDay27Title",
} as const satisfies Record<GraceThresholdDay, keyof (typeof NUMBER_NOTICE_COPY)[Locale]>;

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
  locale?: string | null;
  canceled_at: string;
  stripe_subscription_id?: string | null;
  current_period_end?: string | null;
}

function graceDaysLeft(canceledAt: string, now: Date): number {
  const deadline = numberReleaseAt(canceledAt);
  if (!deadline) return 0;
  const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS);
  return Math.min(GRACE_PERIOD_DAYS, Math.max(0, daysLeft));
}

export async function reanchorCancellation(
  db: Db,
  company: CanceledCompany,
  endedAt: number,
): Promise<boolean> {
  const end = new Date(endedAt * 1000);
  if (end.getTime() <= Date.parse(company.canceled_at)) return true;

  const { data, error } = await db.rpc("api_reanchor_cancellation", {
    p_company_id: company.id,
    p_old_canceled_at: company.canceled_at,
    p_new_canceled_at: end.toISOString(),
  });
  if (error) throw new Error(`cancellation reanchor failed: ${error.message}`);
  return data === true;
}

async function repairCancellationAnchor(
  env: Env,
  db: Db,
  company: CanceledCompany,
): Promise<CanceledCompany | null> {
  const { stripe_subscription_id: id, current_period_end: periodEnd } = company;
  if (!id || !periodEnd || Date.parse(periodEnd) <= Date.parse(company.canceled_at)) {
    return company;
  }

  const subscription = await getStripe(env).subscriptions.retrieve(id);
  if (subscription.status !== "canceled") return null;
  const endedAt = subscription.ended_at;
  if (endedAt == null || endedAt * 1000 <= Date.parse(company.canceled_at)) return company;
  if (!(await reanchorCancellation(db, company, endedAt))) return null;
  return { ...company, canceled_at: new Date(endedAt * 1000).toISOString() };
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
  return copy[GRACE_TITLE_KEYS[day]](daysLeft);
}

function warningCopy(
  company: CanceledCompany,
  day: GraceThresholdDay,
  env: Env,
  daysLeft: number,
  locale: Locale,
): { subject: string; text: string } {
  const resubscribeUrl = `${env.APP_ORIGIN}/settings/billing`;
  const subject = graceTitle(locale, day, daysLeft);
  if (locale === "fr-CA") {
    const paragraphs = [
      "Bonjour,",
      `L’abonnement Loonext de ${company.name} est annulé. Votre numéro d’entreprise est suspendu, mais il vous est réservé pendant ${GRACE_PERIOD_DAYS} jours après la fin du forfait. Il vous reste environ ${daysLeft} ${daysLeft === 1 ? "jour" : "jours"} pour vous réabonner et conserver le numéro ainsi que tout l’historique de vos messages.`,
    ];
    if (day >= 15) {
      paragraphs.push(`Après ${GRACE_PERIOD_DAYS} jours, le numéro retournera au fournisseur et pourra être attribué à une autre entreprise. Vos clients qui l’ont encore dans leurs contacts joindront alors cette entreprise s’ils lui envoient un texto.`);
    }
    if (day === 27) {
      paragraphs.push(
        `Pour garder le numéro, transférez-le à un autre fournisseur ou à une ligne personnelle avant le ${releaseDateLabel(company.canceled_at, locale)}. Votre nouveau fournisseur lance la démarche, qui prend quelques jours ouvrables. Mieux vaut commencer dès maintenant.`,
        "Pensez aussi à donner votre nouveau numéro à vos clients avant l’échéance.",
      );
    }
    paragraphs.push(`Vous réabonner : ${resubscribeUrl}`, "Loonext");
    return { subject, text: paragraphs.join("\n\n") };
  }
  const opening =
    `Hi,\n\nThe Loonext subscription for ${company.name} is canceled. ` +
    `Your business phone number is suspended but reserved for ${GRACE_PERIOD_DAYS} days ` +
    `after the plan ends. You still have about ${daysLeft} day${daysLeft === 1 ? "" : "s"} ` +
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
    `line before ${releaseDateLabel(company.canceled_at, locale)}. Your new carrier starts ` +
    `that, not us, and it takes them a few business days — so begin now rather than ` +
    `on the last day.\n\n` +
    `It is also worth telling your own customers your new number before the ` +
    `deadline. One message from you now saves them texting a stranger later.\n\n`;

  const body =
    day === 1
      ? opening
      : (day === 15
        ? opening + reassignment
        : opening + reassignment + wayOut);

  return { subject, text: `${body}Resubscribe: ${resubscribeUrl}\n\nLoonext` };
}

/**
 * The release date, as a person reads it. #413 ask 2 needs a concrete deadline —
 * "before the deadline" is not something anybody can act on.
 *
 * The deadline stays in UTC even when its display language changes.
 */
function releaseDateLabel(canceledAt: string, locale: Locale): string {
  const release = new Date(new Date(canceledAt).getTime() + GRACE_PERIOD_DAYS * DAY_MS);
  return release.toLocaleDateString(locale === "en" ? "en-US" : locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function releasedCopy(company: CanceledCompany, locale: Locale): {
  subject: string;
  text: string;
} {
  if (locale === "fr-CA") {
    return {
      subject: NUMBER_NOTICE_COPY[locale].numberReleasedTitle,
      text: [
        "Bonjour,",
        `Le délai de grâce de ${GRACE_PERIOD_DAYS} jours de ${company.name} a pris fin. Votre numéro d’entreprise a été libéré. Vous pouvez toujours retrouver vos conversations en vous reconnectant.`,
        "Le numéro a été rendu au fournisseur et pourrait être attribué à une autre entreprise. Les personnes qui lui écrivent pourraient joindre cette entreprise. Loonext ne peut plus récupérer le numéro.",
        "Loonext",
      ].join("\n\n"),
    };
  }
  return {
    subject: NUMBER_NOTICE_COPY[locale].numberReleasedTitle,
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

async function releaseGraceNotice(
  db: Db,
  company: CanceledCompany,
  thresholdDay: GraceNoticeDay,
): Promise<void> {
  const { error } = await db
    .from("grace_notices")
    .delete()
    .eq("company_id", company.id)
    .eq("canceled_at", company.canceled_at)
    .eq("threshold_day", thresholdDay);
  if (error) throw new Error(`grace_notices release failed: ${error.message}`);
}

async function sendGraceEmail(
  env: Env,
  db: Db,
  company: CanceledCompany,
  threshold: GraceNoticeDay,
  copy: (locale: Locale) => { subject: string; text: string },
): Promise<boolean> {
  const groups = await billingRecipientsByLocale(db, company.id, company.locale);
  if (groups.size === 0) {
    void captureException(env, "No billing contacts for grace notice", {
      source: "cron",
      company_id: company.id,
    });
    return false;
  }
  return sendBillingEmailGroups(env, db, company.id, `grace:${company.canceled_at}:${threshold}`, groups, copy, { critical: true });
}

export async function recordAndSendGraceNotice(
  env: Env,
  company: CanceledCompany,
  thresholdDay: GraceThresholdDay,
  now = new Date(),
): Promise<boolean> {
  const daysLeft = graceDaysLeft(company.canceled_at, now);
  if (daysLeft === 0) return false;
  const db = getDb(env);
  return sendLedgered({
    claim: () => claimGraceNotice(db, company, thresholdDay),
    release: () => releaseGraceNotice(db, company, thresholdDay),
    send: async () => {
      await pushGraceWarning(env, db, company, thresholdDay, daysLeft);
      return sendGraceEmail(env, db, company, thresholdDay, (locale) =>
        warningCopy(company, thresholdDay, env, daysLeft, locale));
    },
  });
}

async function pushGraceWarning(
  env: Env,
  db: SupabaseClient,
  company: CanceledCompany,
  thresholdDay: GraceThresholdDay,
  daysLeft: number,
): Promise<void> {
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
  type EmbeddedCompany = Omit<CanceledCompany, "canceled_at"> & { canceled_at: string | null };
  const found = new Map<string, CanceledCompany>();

  // A to-one embed arrives as an object, while the generated types describe it
  // as an array. Accept either rather than trusting one shape.
  const collect = (rows: unknown) => {
    for (const row of (rows as { companies?: unknown }[] | null) ?? []) {
      const embedded = row.companies;
      const companies: EmbeddedCompany[] = Array.isArray(embedded)
        ? (embedded as EmbeddedCompany[])
        : (embedded
          ? [embedded as EmbeddedCompany]
          : []);
      for (const company of companies) {
        if (company?.canceled_at) {
          found.set(company.id, {
            id: company.id,
            name: company.name,
            canceled_at: company.canceled_at,
            stripe_subscription_id: company.stripe_subscription_id,
            current_period_end: company.current_period_end,
          });
        }
      }
    }
  };

  const { data: numbers, error: numbersError } = await db
    .from("phone_numbers")
    .select("company_id,companies!inner(id,name,locale,canceled_at,stripe_subscription_id,current_period_end)")
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
    .select("company_id,companies!inner(id,name,locale,canceled_at,stripe_subscription_id,current_period_end)")
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

  await sendLedgered({
    claim: () => claimGraceNotice(db, company, GRACE_RELEASED_NOTICE_DAY),
    release: () => releaseGraceNotice(db, company, GRACE_RELEASED_NOTICE_DAY),
    send: async () => {
      const { data, error } = await db
        .from("phone_numbers")
        .select("id")
        .eq("company_id", company.id)
        .limit(1);
      if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
      // A workspace that never acquired a number has no release to announce.
      if ((data ?? []).length === 0) return true;

      await pushConsequentialNotice(env, db, {
        companyId: company.id,
        title: (locale) => NUMBER_NOTICE_COPY[locale].numberReleasedTitle,
        body: (locale) => NUMBER_NOTICE_COPY[locale].numberReleasedBody,
        path: "/settings/billing",
        collapseKey: `grace:${company.id}:released`,
      });
      return sendGraceEmail(env, db, company, GRACE_RELEASED_NOTICE_DAY, (locale) => releasedCopy(company, locale));
    },
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
    .select("id,name,locale,canceled_at,stripe_subscription_id,current_period_end")
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
  const seen = new Set((data ?? []).map((row) => row.id));
  const queue = [
    ...((data ?? []) as CanceledCompany[]),
    ...stragglers.filter((row) => !seen.has(row.id)),
  ];

  const failures: unknown[] = [];
  for (const candidate of queue) {
    try {
      const company = await repairCancellationAnchor(env, db, candidate);
      if (!company) continue;
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

      if (daysElapsed >= GRACE_PERIOD_DAYS) {
        await releaseExpiredCompany(env, company);
      } else {
        const day = GRACE_THRESHOLD_DAYS.findLast((threshold) => daysElapsed >= threshold);
        if (day !== undefined) {
          await recordAndSendGraceNotice(env, company, day, now);
        }
      }
    } catch (error_) {
      // One broken tenant must not starve the rest; rethrown below so the
      // cron run still reports failure (the scheduled handler reports it).
      failures.push(error_);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `grace job failed for ${failures.length} compan${failures.length === 1 ? "y" : "ies"}`,
    );
  }
}
