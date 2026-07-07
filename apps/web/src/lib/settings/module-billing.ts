/**
 * Add-on (plan module) billing logic for the settings plan-builder card
 * (#12, #45): every toggle is confirmed with a plain sentence stating EXACTLY
 * what POST /v1/billing/modules does (apps/api/src/routes/billing.ts) —
 *
 *   enable  → the module's Stripe line item is added with
 *             proration_behavior 'always_invoice': a prorated share of the
 *             monthly price (rest of the current period) is invoiced TODAY,
 *             then the full price with each renewal.
 *   disable → the module (and whatever it gated) turns off IMMEDIATELY — not
 *             at period end. IF a Stripe line item exists it is deleted with
 *             'always_invoice', so the unused remainder of the month comes
 *             back as a prorated credit toward the next invoice. But
 *             grandfathered legacy modules (seeded free by migrations
 *             20260704160000/20260707140000 with NO Stripe line item) hit the
 *             API's no-item branch: no Stripe call, no charge ever existed,
 *             no credit. GET /v1/billing/modules doesn't expose which cohort
 *             a company is in, so the credit sentence below is CONDITIONAL
 *             ("if this add-on is on your bill") — true for both cohorts,
 *             never a false billing promise to grandfathered owners.
 *
 * Pure logic — the card renders it. The module rows themselves come from
 * GET /v1/billing/modules (the API MODULE_CATALOG), never from a hand-kept
 * web copy (#59).
 */
import type { PlanModule, PlanModuleCard } from "@/lib/api/types";

/** "$5" for 500, "$7.50" for 750 — whole dollars drop the cents. */
export function formatMonthlyCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export interface ModuleToggleDescription {
  /** Dialog title, e.g. "Add Picture messages?". */
  title: string;
  /** One G10 sentence pair: the price change and when it hits the card. */
  summary: string;
  /** Confirm-button label, e.g. "Add for $5/mo". */
  confirmLabel: string;
}

/**
 * Describe an add-on toggle for the confirmation dialog (#45). The copy must
 * match the API's actual proration behavior ('always_invoice' both ways) —
 * see the module doc above.
 */
export function describeModuleToggle(input: {
  label: string;
  monthlyCents: number;
  /** The state the user is switching TO. */
  enable: boolean;
}): ModuleToggleDescription {
  const price = formatMonthlyCents(input.monthlyCents);
  if (input.enable) {
    return {
      title: `Add ${input.label}?`,
      summary:
        `Adds ${input.label} to your plan for ${price}/month. ` +
        `You'll be charged a prorated share of ${price} today — covering the rest of this billing period — then the full ${price} with each renewal.`,
      confirmLabel: `Add for ${price}/mo`,
    };
  }
  return {
    title: `Turn off ${input.label}?`,
    summary:
      `${input.label} turns off right away — anything it unlocks stops working now, not at the end of the period. ` +
      // Conditional on purpose: grandfathered legacy modules were never
      // billed (no Stripe line item), so no credit exists for them — see the
      // module doc above.
      `If this add-on is on your bill, the part of its ${price} you've paid for time you won't use comes back as a prorated credit toward your next invoice.`,
    confirmLabel: "Turn off",
  };
}

/**
 * Structural shape of a GET /v1/billing/modules row (only the display fields
 * this projection needs — kept structural so this file doesn't import the
 * react-query hook module).
 */
export interface ApiModuleRow {
  id: PlanModule;
  label: string;
  blurb: string;
  detail: string | null;
  monthly_cents: number;
}

/**
 * #59: project an API catalog row into the PlanModuleCard display shape so
 * surfaces that render add-on cards (the onboarding plan builder) can derive
 * them from GET /v1/billing/modules instead of the hand-kept
 * PLAN_MODULE_CARDS mirror in lib/api/types.ts.
 */
export function planModuleCardFromApi(row: ApiModuleRow): PlanModuleCard {
  const card: PlanModuleCard = {
    id: row.id,
    label: row.label,
    blurb: row.blurb,
    price: formatMonthlyCents(row.monthly_cents),
  };
  if (row.detail !== null) card.detail = row.detail;
  return card;
}
