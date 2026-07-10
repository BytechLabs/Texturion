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
