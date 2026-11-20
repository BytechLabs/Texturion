import { fill, homeCopy, homeEn } from '@/i18n/marketing/home';
import type { HomeCopy } from '@/i18n/marketing/home';
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { currencyForCountry, formatMoney, PLAN_PRICE_CENTS, US_REGISTRATION_FEE_CENTS } from '@loonext/shared';
import type { BillingCurrency } from '@loonext/shared';

import { CountryOnly } from '@/components/marketing/country';
import type { Country } from '@/components/marketing/country';
import { FrSection } from "@/components/marketing/fr";

/**
 * S11 · FAIR QUESTIONS (COPY-DECK v2), country-aware (owner ruling v1,
 * 2026-07-08). Conversion job: handle the remaining objections on this page so
 * nobody leaves to "think about it."
 *
 * The setup/timeline/fee answers branch on the site-wide country. A US visitor
 * reads the honest carrier-wait and the one-time registration fee with no
 * Canadian carve-outs; a Canadian visitor reads the same-day, no-fee story,
 * plus the one opt-in question about turning on US texting later (where the US
 * fee and wait honestly do apply). Neither list shows the other country's
 * timeline.
 *
 * Native <details>/<summary> disclosures (§7: the FAQ works with zero JS),
 * drawn as white cards on the Frost band, separated by space and radius, no
 * hairline rules anywhere (Law 10). Numbers inside FAQ prose stay in the
 * body face (the §3 prose exception). No em-dashes.
 */

interface HomeFaq {
  /** The question (US/default wording). */
  q: string;
  /** The answer (US/default wording). */
  a: string;
  /** When set, this entry renders only for the matching country. */
  only?: Country;
  /** Canada question override (defaults to `q`). */
  qCa?: string;
  /** Canada answer override (defaults to `a`). */
  aCa?: string;
}

const crewElsewhere = (currency: BillingCurrency, copy: HomeCopy) =>
  currency === "cad" ? copy.faqCrewElsewhereCad : copy.faqCrewElsewhereUsd;

/** The question list for one currency; `faqsForCountry` picks which. */
function homeFaqs(
  audience: BillingCurrency,
  locale: MarketingLocale,
  copy: HomeCopy,
): readonly HomeFaq[] {
  const starter = formatMoney(PLAN_PRICE_CENTS.usd.starter, "usd", audience, locale);
  const pro = formatMoney(PLAN_PRICE_CENTS.usd.pro, "usd", audience, locale);
  const registration = formatMoney(US_REGISTRATION_FEE_CENTS.usd, "usd", audience, locale);
  // The first month is a SUM, so it is the figure that can go wrong while both
  // of its parts stay right. Added here rather than written down.
  const firstMonth = formatMoney(
    PLAN_PRICE_CENTS.usd.starter + US_REGISTRATION_FEE_CENTS.usd,
    "usd",
    audience,
    locale,
  );
  return [
    {
      q: copy.faqNumberQ,
      a: `${copy.faqNumberAUs} ${copy.faqNumberLandline}`,
      aCa: `${copy.faqNumberACa} ${copy.faqNumberLandline}`,
    },
    {
      q: copy.faqAppQ,
      a: copy.faqAppA,
    },
    {
      q: copy.faqCallsQ,
      a: copy.faqCallsA,
    },
    {
      q: fill(copy.faqPriceQ, { starter }),
      a: fill(copy.faqPriceAUs, {
        starter,
        pro,
        registration,
        firstMonth,
        crew: crewElsewhere(audience, copy),
      }),
      aCa: fill(copy.faqPriceACa, {
        starter,
        pro,
        crew: crewElsewhere(audience, copy),
      }),
    },
    {
      q: copy.faqCountQ,
      a: copy.faqCountA,
    },
    {
      q: copy.faqWaitQ,
      a: copy.faqWaitA,
      only: "us",
    },
    {
      q: copy.faqStartQ,
      a: copy.faqStartA,
      only: "ca",
    },
    {
      q: copy.faqUsQ,
      a: fill(copy.faqUsA, { registration }),
      only: "ca",
    },
    {
      q: copy.faqPhotosQ,
      a: copy.faqPhotosA,
    },
    {
      q: copy.faqOverageQ,
      a: copy.faqOverageA,
    },
    {
      q: copy.faqCancelQ,
      a: copy.faqCancelA,
    },
    {
      q: fill(copy.faqFeeQ, { registration }),
      a: copy.faqFeeA,
      only: "us",
    },
  ];
}

export const HOME_FAQS: readonly HomeFaq[] = homeFaqs("usd", "en", homeEn);

export function faqsForCountry(
  country: Country,
  locale: MarketingLocale = "en",
): { q: string; a: string }[] {
  return homeFaqs(currencyForCountry(country), locale, homeCopy(locale))
    .filter((f) => !f.only || f.only === country)
    .map((f) => ({
      q: country === "ca" && f.qCa ? f.qCa : f.q,
      a: country === "ca" && f.aCa ? f.aCa : f.a,
    }));
}

/* Section CSS, prefix "frq-". One inert style block (repo pattern),
   unlayered on purpose so these base declarations beat Tailwind utilities.
   The only transitions (glyph turn + color) are gated behind
   prefers-reduced-motion: no-preference; without it, states swap instantly.
   No hairlines (Law 10): the rows are white cards on the Frost wash. */
const CSS = `
.frq-item summary {
  position: relative;
  list-style: none;
  cursor: pointer;
  padding: 1.125rem 3.25rem 1.125rem 1.375rem;
}
.frq-item summary::-webkit-details-marker {
  display: none;
}
/* CSS-only plus/minus: two bars; the vertical one lies down when open. */
.frq-item summary::before,
.frq-item summary::after {
  content: "";
  position: absolute;
  right: 1.375rem;
  top: calc(50% - 1px);
  width: 0.75rem;
  height: 2px;
  border-radius: 1px;
  background: var(--fr-ink-55);
}
.frq-item summary::after {
  transform: rotate(90deg);
}
.frq-item[open] > summary::after {
  transform: rotate(0deg);
}
.frq-item summary:hover::before,
.frq-item summary:hover::after,
.frq-item summary:focus-visible::before,
.frq-item summary:focus-visible::after {
  background: var(--fr-olive);
}
/* Light-ground focus: 2px cobalt outline, 2px offset (§7). */
.frq-item summary:focus-visible {
  outline: 2px solid var(--fr-olive);
  outline-offset: 2px;
  border-radius: 12px;
}
@media (prefers-reduced-motion: no-preference) {
  .frq-item summary::before,
  .frq-item summary::after {
    transition:
      transform 200ms ease-out,
      background-color 200ms ease-out;
  }
}
`;

function FaqList({ items }: { items: { q: string; a: string }[] }) {
  return (
    <>
      {items.map((item) => (
        <details key={item.q} className="frq-item fr-card rounded-xl">
          <summary className="font-body-mkt text-base font-semibold text-[color:var(--fr-ink)]">
            {item.q}
          </summary>
          <p className="font-body-mkt px-[1.375rem] pb-5 text-[0.9375rem] leading-[1.65] text-[color:var(--fr-ink-70)]">
            {item.a}
          </p>
        </details>
      ))}
    </>
  );
}

export function Faq({ locale = "en" }: { locale?: MarketingLocale } = {}) {
  const copy = homeCopy(locale);
  return (
    <FrSection ground="frost" id="faq">
      <style>{CSS}</style>
      <h2 className="fr-h2 max-w-2xl">{copy.faqTitle}</h2>

      {/* The two lists never coexist: SSR renders the US set (the default), and
          a returning Canadian swaps to the Canada set after hydration. */}
      <div className="mx-auto mt-12 max-w-3xl space-y-3">
        <CountryOnly country="us">
          <FaqList items={faqsForCountry("us", locale)} />
        </CountryOnly>
        <CountryOnly country="ca">
          <FaqList items={faqsForCountry("ca", locale)} />
        </CountryOnly>
      </div>
    </FrSection>
  );
}
