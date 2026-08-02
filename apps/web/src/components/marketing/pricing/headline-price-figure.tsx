"use client";

import { headlinePrice, HEADLINE_PRICE_SUFFIX } from "@/lib/marketing/headline-price";
import { useMarketingCurrency } from "@/components/marketing/pricing/plan-price";
import { MonoFigure } from "@/components/marketing/fr/mono-figure";

/**
 * #328/#385 — the headline price, in the visitor's currency, with its
 * qualifier attached.
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
}: {
  size?: "data" | "stat" | "display";
  tone?: "ink" | "cobalt" | "green" | "flare";
}) {
  const currency = useMarketingCurrency();
  return (
    <MonoFigure
      value={headlinePrice(currency)}
      suffix={HEADLINE_PRICE_SUFFIX}
      size={size}
      {...(tone ? { tone } : {})}
    />
  );
}
