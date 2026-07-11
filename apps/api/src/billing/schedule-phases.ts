/**
 * #18: rebuild the remaining phases of a subscription schedule so a flat
 * price is present in (or absent from) EVERY phase — the current one (which
 * updates the live subscription, prorated) and the scheduled-downgrade one
 * (so the rollover carries the new item set instead of the stale items pinned
 * at downgrade time). Phase boundaries and the other items' prices/quantities
 * are passed through untouched; completed phases cannot be re-supplied to
 * Stripe and are dropped.
 *
 * Shared by the module toggle (routes/billing.ts, customer-initiated —
 * `always_invoice` so the proration lands on an immediate invoice) and the
 * #103 retired-module sweep (billing/reconcile.ts — `create_prorations` so the
 * credit rides the next invoice, mirroring the non-schedule item delete).
 */
import type { Env } from "../env";
import { allVoiceOveragePrices, voiceOveragePrice } from "./modules";
import { planForLicensedPrice } from "./plans";
import type { Stripe } from "./stripe";

export async function applyPriceToSchedulePhases(
  stripe: Stripe,
  scheduleId: string,
  price: string,
  enabled: boolean,
  prorationBehavior: "always_invoice" | "create_prorations" = "always_invoice",
): Promise<void> {
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const phases: Stripe.SubscriptionScheduleUpdateParams.Phase[] =
    schedule.phases
      // Stripe requires the supplied list to start at the CURRENT phase.
      .filter((phase) => phase.end_date > nowSeconds)
      .map((phase) => {
        const items = phase.items
          .map((item) => ({
            price: typeof item.price === "string" ? item.price : item.price.id,
            quantity: item.quantity,
          }))
          .filter((item) => enabled || item.price !== price)
          .map((item) =>
            // Metered items carry no quantity (SPEC §9) — omit, don't null.
            item.quantity == null
              ? { price: item.price }
              : { price: item.price, quantity: item.quantity },
          );
        if (enabled && !items.some((item) => item.price === price)) {
          items.push({ price, quantity: 1 });
        }
        return {
          items,
          start_date: phase.start_date,
          end_date: phase.end_date,
        };
      });
  await stripe.subscriptionSchedules.update(scheduleId, {
    phases,
    proration_behavior: prorationBehavior,
  });
}

/**
 * D36 review fix: the voice METERED overage price is PLAN-SPECIFIC (its $0
 * tier is the plan's allowance), so on a schedule it must be resolved PER
 * PHASE from that phase's base licensed price — a pending Pro→Starter
 * downgrade needs the Pro price in the current phase and the Starter price
 * in phase 2. Applying one price to every phase (the flat-module recipe
 * above) mis-tiers the post-rollover phase forever, and a disable that only
 * removes the live item's price strands the other plan's price in a pinned
 * phase; a later re-enable then stacks BOTH prices on one meter =
 * double-billing. This helper therefore strips EVERY voice overage price
 * from every remaining phase and, when enabling, adds exactly the one that
 * matches each phase's plan (no licensed match → no voice price in that
 * phase — fail toward unbilled). Metered: never a quantity.
 */
export async function applyVoiceOverageToSchedulePhases(
  stripe: Stripe,
  env: Env,
  scheduleId: string,
  enabled: boolean,
  prorationBehavior: "always_invoice" | "create_prorations" = "always_invoice",
): Promise<void> {
  const voicePrices = new Set(allVoiceOveragePrices(env));
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const phases: Stripe.SubscriptionScheduleUpdateParams.Phase[] =
    schedule.phases
      .filter((phase) => phase.end_date > nowSeconds)
      .map((phase) => {
        const items = phase.items
          .map((item) => ({
            price: typeof item.price === "string" ? item.price : item.price.id,
            quantity: item.quantity,
          }))
          .filter((item) => !voicePrices.has(item.price))
          .map((item) =>
            item.quantity == null
              ? { price: item.price }
              : { price: item.price, quantity: item.quantity },
          );
        if (enabled) {
          const phasePlan = items
            .map((item) => planForLicensedPrice(env, item.price))
            .find((plan) => plan !== null);
          const phaseVoicePrice = phasePlan
            ? voiceOveragePrice(env, phasePlan)
            : null;
          if (phaseVoicePrice) items.push({ price: phaseVoicePrice });
        }
        return {
          items,
          start_date: phase.start_date,
          end_date: phase.end_date,
        };
      });
  await stripe.subscriptionSchedules.update(scheduleId, {
    phases,
    proration_behavior: prorationBehavior,
  });
}
