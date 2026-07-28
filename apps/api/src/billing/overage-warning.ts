/**
 * #85 (child 3 / #92) — the dynamic overage-warning cron job.
 *
 * Runs in the hourly cron ALONGSIDE the static 80%/100% usage alerts (which stay
 * as a backstop). For every active company it asks {@link decideOverage}: is the
 * tenant projected, from usage so far this period, to cost more than they pay? If
 * so, it emails the owner + admins AT MOST ONCE per billing period — the same
 * ledger-first idempotency the static alerts use ({@link recordAndSendAlert}),
 * keyed on the `cost_projection` metric so it never collides with a static arm
 * and re-runs/overlaps can't double-send. When the tenant is comfortably inside
 * their revenue, nothing sends — the "stay silent unless it matters" posture the
 * #85 fair-use model is built around.
 *
 * This job intentionally makes NO enforcement decision: the static cap-and-drop
 * gates remain the only thing that ever pauses usage. This only warns + (in the
 * later children) points the owner at the controls.
 */
import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { decideOverage, type OverageCompany } from "./overage-projection";
import { recordAndSendAlert } from "./usage-alerts";

/** The company shape the warning job selects: {@link OverageCompany} + a name. */
interface OverageWarningCompany extends OverageCompany {
  name: string;
}

/** The owner-facing heads-up. Honest and non-alarming: nothing is blocked, and
 *  the owner keeps control via the spending cap. Deliberately does NOT restate
 *  the hidden per-plan quota numbers (#85) — the precise projected figures land
 *  in settings + GET /v1/usage in the next child (#93). */
function overageWarningCopy(
  company: OverageWarningCompany,
  env: Env,
): { subject: string; text: string } {
  const usageUrl = `${env.APP_ORIGIN}/settings/usage`;
  return {
    subject: `A heads-up about ${company.name}'s usage this period`,
    text:
      `Hi,\n\nBased on how ${company.name} is using Loonext so far this billing ` +
      `period, you're on track to use more than your plan comfortably covers ` +
      `before the period ends. Nothing is blocked and nothing is overdue; we'd ` +
      `rather give you a heads-up than a surprise.\n\n` +
      `You stay in control: you can review your usage and set or adjust your ` +
      `spending cap anytime, so charges never grow past a limit you choose.\n\n` +
      `Review usage and your cap: ${usageUrl}\n\nLoonext`,
  };
}

/**
 * #447 — the founder's copy of the same crossing.
 *
 * The customer arm above is right and unchanged: their staff hear that usage
 * is heading past what the plan covers, in their terms, with no numbers of
 * ours in it. But the owner and admins ARE the customer's staff, so the one
 * signal in this system that says "this tenant is unprofitable" — the output
 * of a model built to answer exactly that — reached the tenant and nobody
 * else. The person who cannot absorb the cost was not told.
 *
 * This copy carries the money, because ops is the only audience for whom the
 * margin is meaningful and the only one it may be shown to.
 *
 * It does NOT change the no-enforcement boundary this module draws. Being
 * informed is not intervening; the static cap-and-drop gates remain the only
 * thing that ever pauses anything.
 */
function overageOpsCopy(
  company: OverageWarningCompany,
  decision: {
    extrapolatedCostCents: number;
    revenueCents: number;
    marginCents: number;
    elapsedDays: number;
    periodDays: number;
  },
): { subject: string; text: string } {
  const dollars = (cents: number) =>
    `${cents < 0 ? "-" : ""}$${Math.abs(cents / 100).toFixed(2)}`;
  return {
    subject: `[ops] ${company.name} projected over revenue (${dollars(decision.marginCents)} margin)`,
    text:
      `Company: ${company.name} (${company.id})\n` +
      `Plan: ${company.plan}\n` +
      `Day ${decision.elapsedDays} of ${decision.periodDays} in the period.\n\n` +
      `Projected month-end provider cost: ${dollars(decision.extrapolatedCostCents)}\n` +
      `Net revenue (after Stripe): ${dollars(decision.revenueCents)}\n` +
      `Projected margin: ${dollars(decision.marginCents)}\n\n` +
      `The customer has been sent the plain-language heads-up; nothing is ` +
      `blocked and nothing here enforces anything.\n\n` +
      `One tenant crossing is a heavy user. Several in a month is a pricing ` +
      `question (#446) — the weekly digest is the one that answers that.`,
  };
}

/**
 * Hourly dynamic overage-warning check. Same active-company selection as the
 * static usage-alert job, plus the period end + registration + cap fields
 * {@link decideOverage} needs. One broken tenant never starves the rest.
 */
export async function runOverageWarningJob(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb(env);
  const { data, error } = await db
    .from("companies")
    .select(
      "id,name,plan,current_period_start,current_period_end,us_texting_enabled,overage_cap_multiplier,paid_extra_numbers",
    )
    .eq("subscription_status", "active")
    .not("plan", "is", null)
    .not("current_period_start", "is", null)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`active companies lookup failed: ${error.message}`);
  }

  const failures: unknown[] = [];
  for (const company of (data ?? []) as OverageWarningCompany[]) {
    try {
      const decision = await decideOverage(db, company, now);
      if (decision.trendingOver) {
        await recordAndSendAlert(
          env,
          company,
          "cost_projection",
          100,
          overageWarningCopy(company, env),
          // #447: the founder rides the SAME ledger row, so the copy that
          // says "this tenant is unprofitable" can never be sent more often
          // than the one that told the tenant, and never without it.
          overageOpsCopy(company, decision),
        );
      }
    } catch (cause) {
      // One broken tenant must not starve the rest; rethrown below so the cron
      // run still reports failure (Sentry wraps scheduled()).
      failures.push(cause);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `overage-warning job failed for ${failures.length} compan${failures.length === 1 ? "y" : "ies"}`,
    );
  }
}

/** How far back the weekly digest counts crossings. */
const DIGEST_WINDOW_DAYS = 7;

/**
 * #447 ask 2 — the weekly founder digest.
 *
 * A per-tenant copy answers "is THIS customer unprofitable". It cannot answer
 * the question #446 actually asks, which is "are the ceilings we publish being
 * tested, and by how many". One tenant crossing is a heavy user; four in a
 * month is a pricing error, and only someone holding all four can tell those
 * apart. That is a different email, not a louder one.
 *
 * It reads the `usage_alerts` ledger rather than re-running the projection.
 * The ledger row already exists for idempotency, carries `sent_at`, and is
 * therefore the history — which is ask 3: whether "how often does this happen"
 * is answerable at all. Reading it here is what makes that true rather than
 * theoretical, and it means the digest reports what was actually SENT, not
 * what a re-run would decide today.
 *
 * Silent when nothing crossed, matching this module's posture. A week with no
 * email is the answer "nobody hit the ceiling"; job failure is Sentry's to
 * report, not this email's.
 */
export async function runOverageDigestJob(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb(env);
  const since = new Date(
    now.getTime() - DIGEST_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: crossings, error: crossingsError } = await db
    .from("usage_alerts")
    .select("company_id")
    .eq("metric", "cost_projection")
    .gte("sent_at", since);
  if (crossingsError) {
    throw new Error(`overage digest lookup failed: ${crossingsError.message}`);
  }

  // Distinct companies: one tenant crossing in two periods inside the window
  // is one tenant, not two.
  const tenants = new Set(
    (crossings ?? []).map((row) => (row as { company_id: string }).company_id),
  );
  if (tenants.size === 0) return;

  const { count, error: activeError } = await db
    .from("companies")
    .select("id", { count: "exact", head: true })
    .eq("subscription_status", "active")
    .not("plan", "is", null)
    .is("deleted_at", null);
  if (activeError) {
    throw new Error(`active company count failed: ${activeError.message}`);
  }
  const active = count ?? 0;

  const text =
      `${tenants.size} of ${active} active tenant${active === 1 ? "" : "s"} ` +
      `were projected to cost more than they pay in the last ` +
      `${DIGEST_WINDOW_DAYS} days.\n\n` +
      `Each was warned individually at the time; this is the pattern, not a ` +
      `new event. Counts only — the per-tenant conversation stays between the ` +
      `product and the customer.\n\n` +
      `One is a heavy user. Several is the pricing question in #446: whether ` +
      `the published ceilings sit above break-even, which is empirical and ` +
      `this is the only place the answer shows up.\n\n` +
      `Nothing was paused. Warning and enforcing are separate jobs.`;

  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: `[ops] ${tenants.size} tenant${tenants.size === 1 ? "" : "s"} projected over revenue in the last ${DIGEST_WINDOW_DAYS} days`,
    text,
    html: renderEmailHtml(text),
  });
}
