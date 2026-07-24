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
