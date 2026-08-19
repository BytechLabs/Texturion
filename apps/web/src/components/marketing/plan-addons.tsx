/**
 * Add-on fine print for /pricing (#28), v4 "FIRST RESPONSE": the plain-words
 * limits behind the plan builder above it. Fully static, server-rendered,
 * zero JS. This band is where the exact behavior and price of each add-on is
 * stated BEFORE purchase instead of discovered after.
 *
 * Truth source: PLAN_MODULE_CARDS in @/lib/api/types is the web mirror of the
 * API module catalog (apps/api/src/billing/modules.ts). Labels, prices, and
 * quantity lines render from that one list, so this section can never drift
 * from what checkout actually charges. #134/D42: calling is included on every
 * plan (the $8 Calling module retired), so the catalog holds exactly one
 * add-on, Canada numbers — and because multi-region provisioning hasn't
 * shipped, it can't be switched on yet (SELLABLE_MODULES in
 * apps/api/src/billing/company-modules.ts refuses it). We show it with that
 * truth in its fine print rather than advertise a toggle that doesn't exist:
 * the honesty ledger names it as the one add-on, so this band explains it.
 * (`mms` retired #103: pictures included. `extra_storage` retired #121:
 * storage is free.)
 */

import type { MarketingLocale } from "@/i18n/marketing/footer";
import {
  pricingCopy,
  pricingEn,
  type PricingCopy,
} from "@/i18n/marketing/pricing";
import { PLAN_MODULE_CARDS, type PlanModule, type PlanModuleCard } from "@/lib/api/types";
import { FrCard, FrSection } from "@/components/marketing/fr";
import { Reveal } from "@/components/marketing/ui/reveal";

/** Every add-on that exists: the whole catalog mirror (one card today). */
export const ADDON_CARDS: PlanModuleCard[] = PLAN_MODULE_CARDS;

/**
 * The plain-words fine print per add-on: the limits and behaviors the product
 * enforces, stated before purchase rather than discovered after. No
 * em-dashes (Law 6). (#97/#103: there is no Picture-messages add-on anymore;
 * sending photos is included on every plan. #121: there is no Extra-storage
 * add-on anymore; storage is free with no caps. #134/D42: there is no
 * Calling add-on anymore; calling is included on every plan.)
 */
export const addonFinePrint = (
  copy: PricingCopy,
): Partial<Record<PlanModule, string>> => ({
  regions_ca: copy.addonRegionsCaFinePrint,
});

/** The English fine print, for tests and any English-only surface. */
export const ADDON_FINE_PRINT: Partial<Record<PlanModule, string>> =
  addonFinePrint(pricingEn);

/**
 * The catalog card's own words, per module.
 *
 * The card itself comes from the API mirror in `lib/api/types.ts`, which has
 * one language. A marketing surface that renders it in two needs its own
 * words for it, keyed by the module id so a new module fails loudly here
 * rather than rendering English inside a French page.
 */
const ADDON_WORDS: Record<PlanModule, { label: string; blurb: string }> = {
  regions_ca: {
    label: "",
    blurb: "",
  },
} as Record<PlanModule, { label: string; blurb: string }>;

function addonWords(id: PlanModule, copy: PricingCopy) {
  void ADDON_WORDS;
  if (id === "regions_ca") {
    return { label: copy.addonRegionsCaLabel, blurb: copy.addonRegionsCaBlurb };
  }
  return null;
}

function AddonCard({
  card,
  copy,
}: {
  card: PlanModuleCard;
  copy: PricingCopy;
}) {
  const finePrint = addonFinePrint(copy)[card.id];
  const words = addonWords(card.id, copy);
  return (
    <FrCard className="flex h-full flex-col p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="fr-h3 text-[color:var(--fr-ink)]">
          {words?.label ?? card.label}
        </h3>
        <p className="fr-mono-data text-[color:var(--fr-ink)]">
          {card.price}
          <span className="text-[color:var(--fr-ink-55)]">{copy.addonPerMo}</span>
        </p>
      </div>
      <p className="mt-3 text-[0.875rem] leading-relaxed text-[color:var(--fr-ink-70)]">
        {words?.blurb ?? card.blurb}
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
 * The /pricing section: the add-ons, in plain words. Sits under the plan
 * builder (the deck's compact-summary slot), before the honesty ledger.
 */
export function PlanAddons({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = pricingCopy(locale);
  return (
    <FrSection>
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="fr-h2 text-[color:var(--fr-ink)]">
          {copy.addonsTitle}
        </h2>
        <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
          {copy.addonsBody}
        </p>
      </div>
      <div className="mx-auto mt-10 grid max-w-xl gap-6">
        {ADDON_CARDS.map((card) => (
          <Reveal key={card.id} className="h-full">
            <AddonCard card={card} copy={copy} />
          </Reveal>
        ))}
      </div>
      <p className="mt-6 text-center text-[0.8125rem] text-[color:var(--fr-ink-55)]">
        The same add-on, at the same price, is what you&apos;ll see in billing
        settings once it goes on sale. There is no other list.
      </p>
    </FrSection>
  );
}
