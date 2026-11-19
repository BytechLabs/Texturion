import { formatMoney } from "@loonext/shared";
import type { BillingCurrency } from "@loonext/shared";

import { compareAsOf } from "@/app/(marketing)/compare/verification";
import { compareUiCopy } from "@/i18n/marketing/compare-ui";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { LIVE_ROUTES } from "@/lib/marketing/site";

const SOURCES = {
  quo: { name: "Quo", en: LIVE_ROUTES.compareQuo, "fr-CA": "/fr/comparer/quo" },
  heymarket: { name: "Heymarket", en: LIVE_ROUTES.compareHeymarket, "fr-CA": "/fr/comparer/heymarket" },
};

export type SliderRival = keyof typeof SOURCES;

export function CrewSizeSliderSource({ rival, perUserMonthly, locale, audience }: {
  rival: SliderRival;
  perUserMonthly: number;
  locale: MarketingLocale;
  audience: BillingCurrency;
}) {
  const source = SOURCES[rival];
  const copy = compareUiCopy(locale);
  const pricing = copy.sliderSourceRate
    .replace("{rate}", formatMoney(perUserMonthly * 100, "usd", audience, locale))
    .replace("{rival}", source.name)
    .replace("{asOf}", compareAsOf(locale));

  return (
    <p className="mt-3 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
      {pricing}{" "}
      <a
        href={source[locale]}
        className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
      >
        {copy.sliderSourceLink}
      </a>
    </p>
  );
}
