"use client";

import { headlinePrice, headlinePriceSuffix } from "@/lib/marketing/headline-price";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { usePriceAudience } from "@/components/marketing/pricing/plan-price";
import { MonoFigure } from "@/components/marketing/fr/mono-figure";

/**
 * The USD headline price and the number of seats it covers.
 *
 * # Why a component rather than a string
 *
 * `MonoFigure` takes `value: string`, and the three surfaces that render the
 * headline — the home truth bar, every feature page, every trade page — are
 * server components. A server component cannot read `useCountry()`, so the
 * currency has to cross that boundary as a client component, not as a value.
 *
 * # Why it also owns the suffix
 *
 * #385's rule is that the claim cannot travel without its qualifier: `$29` in
 * the site's largest type, with no "up to 3 seats" beside it, was the least
 * qualified claim on the surface most visitors saw first. `headline-price.test.ts`
 * enforces that by walking every `MonoFigure` call site and failing on a price
 * that supplies its own suffix.
 *
 * Binding the two together here keeps that guarantee while adding the currency:
 * there is now ONE place that can render this figure, and it cannot render the
 * number without the words.
 */
export function HeadlinePriceFigure({
  size = "display",
  tone,
  locale = "en",
}: {
  size?: "data" | "stat" | "display";
  tone?: "ink" | "cobalt" | "green" | "flare";
  locale?: MarketingLocale;
}) {
  const audience = usePriceAudience();
  return (
    <MonoFigure
      value={headlinePrice(audience, locale)}
      suffix={headlinePriceSuffix(locale)}
      size={size}
      {...(tone ? { tone } : {})}
    />
  );
}
