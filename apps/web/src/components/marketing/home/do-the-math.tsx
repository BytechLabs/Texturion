import { homeCopy, type HomeCopy } from "@/i18n/marketing/home";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { CtaButton, Eyebrow, FrSection } from "@/components/marketing/fr";
import { MissedTextCalculatorStatic } from "@/components/marketing/interactive/missed-text-calculator-static";
import { PRIMARY_CTA_LABEL, SIGNUP_HREF } from "@/components/marketing/nav-links";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";

import { LazyMissedTextCalculator } from "./lazy-islands";

/**
 * S8 · DO THE MATH (COPY-DECK v2). Conversion job: convert the pain into a
 * dollar figure the owner computes himself, then anchor the monthly price
 * against it.
 *
 * The calculator's output figure is the band's ONE display-scale accent (the
 * sanctioned Flare use, whitelist §3.4.3; Law 5: no cobalt display element
 * shares this band, the CTA button is standard size). The server ships the
 * resting state; the draggable island swaps in on viewport approach.
 *
 * #328: the anchor is the whole point of the band, so it has to be the price
 * the reader would actually be charged. <PlanPrice> reads the site-wide
 * country; this stays a server component and renders it as a child.
 */
export function DoTheMath({
  locale = "en",
}: {
  locale?: MarketingLocale;
} = {}) {
  const copy = homeCopy(locale);
  return (
    <FrSection ground="white" id="math">
      <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <Eyebrow>{copy.mathEyebrow}</Eyebrow>
          <h2 className="fr-h2 mt-4">
            {copy.mathTitle}
          </h2>
          {/* The deck's §S8 lead ("This is arithmetic on your numbers…")
              renders verbatim inside the calculator card itself, so the
              column carries only the closer; repeating the lead here would
              print the same sentence twice in one viewport. */}
          <p className="fr-body mt-6 max-w-[52ch] text-[color:var(--fr-ink-70)]">
            {copy.mathClose}{" "}
            <span className="fr-mono-data text-[color:var(--fr-ink)]">
              <PlanPrice plan="starter" />
            </span>{" "}
            {copy.mathCloseAfter}
          </p>
          <div className="mt-8">
            <CtaButton href={SIGNUP_HREF}>{PRIMARY_CTA_LABEL}</CtaButton>
          </div>
        </div>

        <LazyMissedTextCalculator
          locale={locale}
          fallback={<MissedTextCalculatorStatic locale={locale} />}
        />
      </div>
    </FrSection>
  );
}
