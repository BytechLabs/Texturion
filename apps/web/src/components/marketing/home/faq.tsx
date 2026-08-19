import { fill, homeCopy, homeEn, type HomeCopy } from "@/i18n/marketing/home";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import {
  currencyForCountry,
  formatMoney,
  PLAN_PRICE_CENTS,
  US_REGISTRATION_FEE_CENTS,
  type BillingCurrency,
} from "@loonext/shared";

import { CountryOnly, type Country } from "@/components/marketing/country";
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
 * #328: the country branch IS the currency branch. This list is built by a
 * function of currency and each country's list fixes that argument, which is
 * not an assumption about the reader: `faqsForCountry` is the only thing that
 * builds one, the two lists never render together, and the answers a Canadian
 * reads are therefore only ever built with CAD. That matters most in the
 * pricing answer, which is the one a reader checks against their card.
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

/**
 * Somebody else's prices, which stay literal because they are not ours to
 * derive: these are the published per-user rates the comparison pages source.
 *
 * They are US dollars, and for a Canadian reader they now SAY so. The sentence
 * sets a rival's monthly total beside ours, so once our half is CAD the two
 * halves stopped being the same money. The comparison still holds with the
 * label on (their US$90 floor is well past our CAD Pro price at any rate this
 * decade has seen); without it, the sentence was our argument plus an
 * accidental exchange rate, which is the exact defect #328 is about.
 */
const crewElsewhere = (currency: BillingCurrency, copy: HomeCopy) =>
  currency === "cad" ? copy.faqCrewElsewhereCad : copy.faqCrewElsewhereUsd;

/** The question list for one currency; `faqsForCountry` picks which. */
function homeFaqs(
  currency: BillingCurrency,
  copy: HomeCopy,
): readonly HomeFaq[] {
  const starter = formatMoney(PLAN_PRICE_CENTS[currency].starter, currency);
  const pro = formatMoney(PLAN_PRICE_CENTS[currency].pro, currency);
  const registration = formatMoney(US_REGISTRATION_FEE_CENTS[currency], currency);
  // The first month is a SUM, so it is the figure that can go wrong while both
  // of its parts stay right. Added here rather than written down.
  const firstMonth = formatMoney(
    PLAN_PRICE_CENTS[currency].starter + US_REGISTRATION_FEE_CENTS[currency],
    currency,
  );
  return [
    {
      q: copy.faqNumberQ,
      a: copy.faqNumberAUs,
      aCa: copy.faqNumberACa,
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
        crew: crewElsewhere(currency, copy),
      }),
      aCa: fill(copy.faqPriceACa, {
        starter,
        pro,
        crew: crewElsewhere(currency, copy),
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
      // The fee lands on a CANADIAN invoice here, which is why it is read with
      // this list's currency and not fixed to USD: a Canadian workspace that
      // turns on US texting is charged US_REGISTRATION_FEE_CENTS.cad.
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

/**
 * The US list, which is the SSR default (country-context.tsx).
 *
 * #328 note, the same one pricing-data.ts carries about `PLANS`: this is built
 * with USD, so the Canada-only entries inside it hold US figures. Nothing
 * renders it — `faqsForCountry` rebuilds the list in the reader's own currency
 * — and it is exported for the tests that read the country-neutral answers.
 */
export const HOME_FAQS: readonly HomeFaq[] = homeFaqs("usd", homeEn);

/** The visible question/answer list for one country: build it in the currency
 *  that country is billed in, filter the single-country entries out of the
 *  other country, then apply any Canada wording override. */
export function faqsForCountry(
  country: Country,
  locale: MarketingLocale = "en",
): { q: string; a: string }[] {
  return homeFaqs(currencyForCountry(country), homeCopy(locale))
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
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
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
