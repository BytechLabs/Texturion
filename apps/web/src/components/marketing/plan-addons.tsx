/**
 * Add-on fine print for /pricing (#28), v4 "FIRST RESPONSE": the plain-words
 * limits behind the plan builder's toggles above it. Fully static,
 * server-rendered, zero JS. The builder is where a buyer switches an add-on
 * on; this band is where the exact behavior of each one is stated BEFORE
 * purchase instead of discovered after.
 *
 * Truth source: PLAN_MODULE_CARDS in @/lib/api/types is the web mirror of the
 * API module catalog (apps/api/src/billing/modules.ts). Labels, prices, and
 * quantity lines render from that one list (via plan-math's
 * SELLABLE_ADDON_CARDS, the same array the builder totals), so this section
 * can never drift from what checkout actually charges. `regions_ca` (Canada numbers) is excluded on
 * purpose: the API refuses to sell it until multi-region provisioning ships
 * (SELLABLE_MODULES in apps/api/src/billing/company-modules.ts), and we don't
 * advertise what a buyer can't buy. `extra_storage` is retired (#121: storage
 * is free on every plan, with no caps; there is nothing to sell).
 */

import type { PlanModule, PlanModuleCard } from "@/lib/api/types";
import { FrCard, FrSection } from "@/components/marketing/fr";
import { SELLABLE_ADDON_CARDS } from "@/components/marketing/pricing/plan-math";
import { Reveal } from "@/components/marketing/ui/reveal";

export { SELLABLE_ADDON_CARDS };

/**
 * The plain-words fine print per add-on: the limits and behaviors the product
 * enforces (apps/api/src/billing/plans.ts; the 80% warning is the owner email
 * from billing/usage-alerts.ts), stated before purchase rather than
 * discovered after. No em-dashes (Law 6). (#97/#103: there is no
 * Picture-messages add-on anymore; sending photos is included on every plan.
 * #121: there is no Extra-storage add-on anymore; storage is free with no
 * caps, so there is nothing to buy and nothing that pauses.)
 */
export const ADDON_FINE_PRINT: Partial<Record<PlanModule, string>> = {
  voice:
    "Calls to your business number ring your cell, and missed ones get an automatic text-back so the lead still lands in your inbox. Loonext itself doesn't place calls.",
};

function AddonCard({ card }: { card: PlanModuleCard }) {
  const finePrint = ADDON_FINE_PRINT[card.id];
  return (
    <FrCard className="flex h-full flex-col p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="fr-h3 text-[color:var(--fr-ink)]">{card.label}</h3>
        <p className="fr-mono-data text-[color:var(--fr-ink)]">
          {card.price}
          <span className="text-[color:var(--fr-ink-55)]">/mo</span>
        </p>
      </div>
      <p className="mt-3 text-[0.875rem] leading-relaxed text-[color:var(--fr-ink-70)]">
        {card.blurb}
        {card.detail ? ` ${card.detail}` : ""}
      </p>
      {finePrint ? (
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
          {finePrint}
        </p>
      ) : null}
    </FrCard>
  );
}

/**
 * The /pricing section: the add-ons, in plain words. Sits directly under the
 * plan builder (the deck's compact-summary slot), before the honesty ledger.
 */
export function PlanAddons() {
  return (
    <FrSection>
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="fr-h2 text-[color:var(--fr-ink)]">
          The add-ons, in plain words.
        </h2>
        <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
          The base plan is the complete shared inbox, nothing above is held
          back. Call forwarding is the only add-on that exists, optional and
          priced right here, with the limits written out before you pay.
        </p>
      </div>
      <div className="mx-auto mt-10 grid max-w-xl gap-6">
        {SELLABLE_ADDON_CARDS.map((card) => (
          <Reveal key={card.id} className="h-full">
            <AddonCard card={card} />
          </Reveal>
        ))}
      </div>
      <p className="mt-6 text-center text-[0.8125rem] text-[color:var(--fr-ink-55)]">
        The same add-on, at the same price, is what you&apos;ll see at signup
        and in billing settings. There is no other list.
      </p>
    </FrSection>
  );
}
