/**
 * Add-on fine print for /pricing (#28), v4 "FIRST RESPONSE": the plain-words
 * limits behind the three toggles in the plan builder above it. Fully static,
 * server-rendered, zero JS. The builder is where a buyer switches an add-on
 * on; this band is where the exact behavior of each one is stated BEFORE
 * purchase instead of discovered after.
 *
 * Truth source: PLAN_MODULE_CARDS in @/lib/api/types is the web mirror of the
 * API module catalog (apps/api/src/billing/modules.ts; quantities from
 * apps/api/src/billing/plans.ts: 300 minutes, 10 GB). Labels,
 * prices, and quantity lines render from that one list (via plan-math's
 * SELLABLE_ADDON_CARDS, the same array the builder totals), so this section
 * can never drift from what checkout actually charges. `regions_ca` (Canada
 * numbers) is excluded on purpose: the API refuses to sell it until
 * multi-region provisioning ships (SELLABLE_MODULES in
 * apps/api/src/billing/company-modules.ts), and we don't advertise what a
 * buyer can't buy.
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
 * Picture-messages add-on anymore; sending photos is included on every plan
 * and each picture counts as three texts from the allowance.)
 */
export const ADDON_FINE_PRINT: Record<
  Exclude<PlanModule, "regions_ca">,
  string
> = {
  voice:
    "Calls to your business number ring your cell, and missed ones get an automatic text-back so the lead still lands in your inbox. Loonext itself doesn't place calls.",
  extra_storage:
    "Your plan's storage holds the files you attach to notes and the photos customers text you; when a pool is full, new photos stop being saved (the message text still arrives), so free up space or add storage to keep saving them. This add-on gives you more room: it stacks on top of your included storage (5 GB on Starter, 25 GB on Pro, per pool).",
};

function AddonCard({ card }: { card: PlanModuleCard }) {
  const id = card.id as Exclude<PlanModule, "regions_ca">;
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
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
        {ADDON_FINE_PRINT[id]}
      </p>
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
          back. These three are the only add-ons that exist, each optional and
          priced right here, with the limits written out before you pay.
        </p>
      </div>
      <div className="mx-auto mt-10 grid max-w-5xl gap-6 md:grid-cols-3">
        {SELLABLE_ADDON_CARDS.map((card) => (
          <Reveal key={card.id} className="h-full">
            <AddonCard card={card} />
          </Reveal>
        ))}
      </div>
      <p className="mt-6 text-center text-[0.8125rem] text-[color:var(--fr-ink-55)]">
        The same three add-ons, at the same prices, are what you&apos;ll see at
        signup and in billing settings. There is no other list.
      </p>
    </FrSection>
  );
}
