/**
 * /canada, the Canada-first page, on the v4 "FIRST RESPONSE" CANADA template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * Dateline `DAY ONE · NO WAIT` → H1 "In Canada? You can text customers
 * today." → the flipped first-week timeline leads (green Day 0 node only:
 * the waiting segment does not exist; green is allowed to lead this one
 * page) → why there's no registration wait → province availability as an
 * Honesty Ledger, computed from the same NANP table the app picks numbers
 * from (@loonext/shared, nothing invented) → CASL consent records (the real
 * component) → USD Truth Strip → the enable-US-texting-later path → FAQ →
 * Frost CTA band.
 *
 * "Helps you follow CASL", never "CASL-compliant". US data residency stated,
 * not buried. Every number is a verified product/billing fact.
 *
 * # #328: this page does NOT force CAD, and the figures are not typed
 *
 * Every price here renders through `<PlanPrice>` / `<RegistrationFee>`, which
 * read the ONE site-wide country context. That context is what the nav
 * selector moves, and it is deliberately not overridden here even though this
 * page's reader is definitionally Canadian.
 *
 * The reason is that the nav CountrySelector is on screen while this page is.
 * Pinning the body to CAD would put a page-local currency in plain view of a
 * control reading "US", and the shared `PricingSnippet` around the CTAs would
 * still branch its guarantee microcopy on the context, so a single card would
 * carry Canadian figures beside the US registration-fee sentence. Owner ruling
 * v1 is one country for the whole marketing app, and a second, page-local
 * source of truth is the exact disagreement that ruling exists to prevent.
 *
 * A visitor who arrived by typing /canada has told us something the context
 * does not know, and the home for that is the country signal itself (adopting
 * "ca" for a visitor who has not chosen yet), not a currency override in this
 * file. That is a change to site-wide behaviour and belongs to whoever owns
 * the context.
 *
 * The billing STATEMENTS below are therefore worded as facts about Canadian
 * workspaces rather than about "you", so they read true in either branch and
 * need no CountryText split. That also fixes what was here before: this page
 * said "Billing is in USD for now, CAD billing is coming", in three places,
 * which #328 has now made false.
 */

import {
  canadaCopy,
  type CanadaCopy,
} from "@/i18n/marketing/canada";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { Check } from "lucide-react";

import { NANP_AREA_CODES } from "@loonext/shared";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { FrCard, PanelFrame } from "@/components/marketing/fr";
import {
  FeatureCta,
  FeatureFaq,
  FeatureHero,
  FeatureSection,
  PricingSnippet,
  RelatedLinks,
  TruthStripSection,
} from "@/components/marketing/features/feature-page";
import { ConsentVisual } from "@/components/marketing/features/consent-visual";
import {
  PlanPrice,
  RegistrationFee,
} from "@/components/marketing/pricing/plan-price";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

const PATH = "/canada";

/* -------------------------------------------------------------------------- */
/* The province ledger, computed from the app's own NANP table so every code  */
/* shown is one the app could actually assign (nothing invented, Law 7).     */
/* -------------------------------------------------------------------------- */

/** Canada Post province/territory code → display name, in ledger order. */
const PROVINCE_KEYS: [string, keyof CanadaCopy][] = [
  ["BC", "provinceBc"],
  ["AB", "provinceAb"],
  ["SK", "provinceSk"],
  ["MB", "provinceMb"],
  ["ON", "provinceOn"],
  ["QC", "provinceQc"],
  ["NB", "provinceNb"],
  ["NS", "provinceNs"],
  ["PE", "provincePe"],
  ["NL", "provinceNl"],
];

/** The territories share one geographic code; shown as a single ledger row. */
const TERRITORIES: string[] = ["NT", "NU", "YT"];

function codesForRegions(regions: string[]): string[] {
  const codes = Object.entries(NANP_AREA_CODES)
    .filter(
      ([, entry]) =>
        entry.country === "CA" &&
        entry.geographic &&
        entry.region !== null &&
        regions.includes(entry.region),
    )
    .map(([code]) => code);
  return [...new Set(codes)].sort();
}

function ProvinceLedger({ copy }: { copy: CanadaCopy }) {
  const rows: { label: string; codes: string[] }[] = [
    ...PROVINCE_KEYS.map(([region, key]) => ({
      label: copy[key],
      codes: codesForRegions([region]),
    })),
    { label: copy.provinceTerritories, codes: codesForRegions(TERRITORIES) },
  ];
  return (
    <div className="overflow-hidden rounded-xl">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th className="fr-eyebrow px-4 py-3 text-[color:var(--fr-ink-55)]">
              {copy.ledgerProvinceHeading}
            </th>
            <th className="fr-eyebrow px-4 py-3 text-right text-[color:var(--fr-ink-55)]">
              {copy.ledgerCodesHeading}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.label}
              className={i % 2 === 0 ? "bg-[color:var(--fr-frost)]" : undefined}
            >
              <td className="font-body-mkt px-4 py-2.5 text-[15px] text-[color:var(--fr-ink)]">
                {row.label}
              </td>
              <td className="fr-mono-data px-4 py-2.5 text-right text-[color:var(--fr-ink)]">
                {row.codes.join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The flipped first-week timeline: a green Day 0 node, and the waiting       */
/* segment shown as the thing that does not exist here.                       */
/* -------------------------------------------------------------------------- */

function FlippedTimeline({ copy }: { copy: CanadaCopy }) {
  return (
    <FrCard className="p-6 sm:p-8">
      <div className="flex gap-4">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--fr-green)] text-[color:var(--fr-on-green)]"
          aria-hidden
        >
          <Check className="size-5" strokeWidth={2.5} />
        </span>
        <div>
          <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
            {copy.timelineDayZero}
          </p>
          <h3 className="fr-h3 mt-2 text-[color:var(--fr-ink)]">
            {copy.timelineLiveTitle}
          </h3>
          <p className="font-body-mkt mt-2 text-[15px] leading-relaxed text-[color:var(--fr-ink-70)]">
            {copy.timelineLiveBody}
          </p>
        </div>
      </div>
      <div className="mt-6 rounded-xl bg-[color:var(--fr-frost)] px-4 py-3.5">
        <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
          {copy.timelineReviewTitle}
        </p>
        <p className="font-body-mkt mt-1.5 text-[14px] leading-relaxed text-[color:var(--fr-ink-70)]">
          {copy.timelineReviewBody}
        </p>
      </div>
    </FrCard>
  );
}

export function CanadaPageBody({ locale = "en" }: { locale?: MarketingLocale }) {
  const copy = canadaCopy(locale);
  const french = locale === "fr-CA";
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.breadcrumbHome, path: french ? "/fr" : "/" },
          { name: copy.breadcrumbSelf, path: french ? "/fr/canada" : PATH },
        ])}
      />

      <FeatureHero
        dateline={copy.dateline}
        title={copy.h1}
        sub={
          <>
            {copy.heroBody} <PlanPrice plan="starter" /> {copy.heroPriceAfter}
          </>
        }
        panel={<FlippedTimeline copy={copy} />}
      />

      <FeatureSection
        ground="frost"
        eyebrow={copy.noWaitEyebrow}
        heading={copy.noWaitTitle}
      >
        <p>
          {copy.noWaitBodyOne}
        </p>
        <p>
          {copy.noWaitBodyTwo}
        </p>
      </FeatureSection>

      <FeatureSection
        eyebrow={copy.numbersEyebrow}
        heading={copy.numbersTitle}
        visual={
          <div>
            <ProvinceLedger copy={copy} />
            <p className="font-body-mkt mt-3 text-[13px] text-[color:var(--fr-ink-55)]">
              {copy.ledgerCaption}
            </p>
          </div>
        }
      >
        <p>
          {copy.numbersBodyOne}
        </p>
        <p>
          {copy.numbersBodyTwo}
        </p>
      </FeatureSection>

      <FeatureSection
        ground="frost"
        eyebrow={copy.caslEyebrow}
        heading={copy.caslTitle}
        visual={
          <PanelFrame
            caption={copy.consentPanelCaption}
            ariaLabel={copy.consentPanelAlt}
          >
            <ConsentVisual />
          </PanelFrame>
        }
        flip
      >
        <p>
          {copy.caslBody}
        </p>
        <p>
          {copy.caslCarefulBefore} <em>{copy.caslCarefulEmphasis}</em> {copy.caslCarefulAfter}
        </p>
      </FeatureSection>

      <FeatureSection
        eyebrow={copy.usEyebrow}
        heading={copy.usTitle}
      >
        <p>
          {copy.usBodyBefore} <RegistrationFee /> {copy.usBodyAfter}
        </p>
        <p>
          {copy.dataBody}
        </p>
      </FeatureSection>

      <TruthStripSection
        heading={copy.truthEyebrow}
        items={[
          {
            text: copy.truthDayOne,
            good: true,
          },
          {
            // #328 replaced the "billing is in USD for now, CAD is coming"
            // line this strip used to carry. It is stated about a Canadian
            // workspace rather than about "you", so it stays true whichever
            // branch the site-wide country toggle is on.
            text: copy.truthBilling,
            good: true,
          },
          {
            text: copy.truthData,
          },
        ]}
      />

      <PricingSnippet>
        <p>
          {copy.truthPlansBefore} <PlanPrice plan="starter" />/mo on
          Starter for up to 3 people and one local number,{" "}
          <PlanPrice plan="pro" />/mo on Pro for up to 15 people and two
          numbers. Receiving texts is always free and unlimited, month to
          month.
        </p>
        <p>
          {copy.truthFeeBefore} <RegistrationFee /> {copy.truthFeeAfter}
        </p>
      </PricingSnippet>

      <RelatedLinks
        heading={copy.relatedTitle}
        intro={copy.relatedBody}
        links={[
          {
            label: copy.relatedNumberTitle,
            href: "/features/business-number",
            hint: copy.relatedNumberBody,
          },
          {
            label: copy.relatedComplianceTitle,
            href: "/features/compliance",
            hint: copy.relatedComplianceBody,
          },
          {
            label: copy.relatedCleanersTitle,
            href: "/for/cleaners",
            hint: copy.relatedCleanersBody,
          },
          {
            label: copy.relatedLandscapersTitle,
            href: "/for/landscapers",
            hint: copy.relatedLandscapersBody,
          },
        ]}
      />

      <FeatureFaq
        heading={copy.faqTitle}
        faqs={[
          {
            q: copy.faqSameDayQ,
            a: copy.faqSameDayA,
          },
          {
            q: copy.faqNumberQ,
            a: copy.faqNumberA,
          },
          {
            q: copy.faqCaslQ,
            a: copy.faqCaslA,
          },
          {
            q: copy.faqDataQ,
            a: copy.faqDataA,
          },
          {
            q: copy.faqCurrencyQ,
            a: copy.faqCurrencyA,
          },
        ]}
      />

      <FeatureCta
        heading={copy.ctaTitle}
        sub={copy.ctaBody}
      />
    </>
  );
}
