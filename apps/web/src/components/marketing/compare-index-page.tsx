import Link from "next/link";

import {
  elsewhereColumns,
  elsewhereFootnote,
  elsewhereRows,
} from "@/app/(marketing)/pricing/pricing-data";
import {
  compareAsOf,
  compareMonth,
} from "@/app/(marketing)/compare/verification";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { compareIndexCopy } from "@/i18n/marketing/compare-index";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

import { CountryOnly } from "./country";
import {
  CompareCta,
  CompareHero,
  LedgerBand,
  SwitchBand,
} from "./compare/compare-sections";
import { ComparisonEmailForm } from "./compare/comparison-email-form";
import { LedgerTable } from "./compare/ledger-table";
import { FrCard, FrSection } from "./fr";
import { JsonLd } from "./ui/json-ld";
import { Reveal } from "./ui/reveal";

function fill(template: string, key: string, value: string): string {
  return template.replace(`{${key}}`, value);
}

export function CompareIndexPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = compareIndexCopy(locale);
  const french = locale === "fr-CA";
  const path = french ? "/fr/comparer" : "/compare";
  const month = compareMonth(locale);
  const asOf = compareAsOf(locale);
  const cards = [
    {
      href: french ? "/fr/comparer/heymarket" : "/compare/heymarket",
      heading: copy.heymarketCardTitle,
      fact: copy.heymarketFact,
      angle: copy.heymarketAngle,
    },
    {
      href: french ? "/fr/comparer/quo" : "/compare/quo",
      heading: copy.quoCardTitle,
      fact: copy.quoFact,
      angle: copy.quoAngle,
    },
  ];
  const omissions = [
    { heading: copy.blastsTitle, body: copy.blastsBody },
    { heading: copy.reviewsTitle, body: copy.reviewsBody },
    { heading: copy.dialerTitle, body: copy.dialerBody },
  ];

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.home, path: french ? "/fr" : "/" },
          { name: copy.breadcrumb, path },
        ])}
      />

      <CompareHero
        locale={locale}
        dateline={fill(copy.heroDateline, "month", month.toUpperCase())}
        title={copy.heroTitle}
        lead={copy.heroLead}
      />

      <LedgerBand
        heading={copy.ledgerTitle}
        lead={copy.ledgerLead}
        footnote={elsewhereFootnote(locale)}
      >
        <LedgerTable
          locale={locale}
          caption={fill(copy.ledgerCaption, "asOf", asOf)}
          columns={elsewhereColumns(locale)}
          rows={elsewhereRows(locale)}
        />
      </LedgerBand>

      <FrSection>
        <div className="mx-auto max-w-5xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            {copy.emailTitle}
          </h2>
          <p className="fr-body mt-4 mb-8 max-w-2xl text-[color:var(--fr-ink-70)]">
            {copy.emailLead}
          </p>
          <ComparisonEmailForm source="compare_page" locale={locale} />
        </div>
      </FrSection>

      <FrSection>
        <div className="mx-auto max-w-5xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            {copy.pickTitle}
          </h2>
          <p className="fr-body mt-4 max-w-2xl text-[color:var(--fr-ink-70)]">
            {copy.pickLead}
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {cards.map((card, index) => (
              <Reveal
                key={card.href}
                delay={Math.min(index, 3) * 60}
                className="h-full"
              >
                <FrCard className="h-full p-0">
                  <Link
                    href={card.href}
                    className="flex h-full flex-col rounded-[12px] p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
                  >
                    <span className="fr-eyebrow inline-flex w-fit items-center rounded-[6px] bg-[color:var(--fr-frost)] px-2.5 py-1.5 text-[color:var(--fr-ink)]">
                      {card.fact}
                    </span>
                    <span className="fr-h3 mt-4 block text-[color:var(--fr-ink)]">
                      {card.heading}
                    </span>
                    <span className="mt-2 block flex-1 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                      {card.angle}
                    </span>
                    <span className="mt-4 inline-flex items-center gap-1 text-[0.9375rem] font-semibold text-[color:var(--fr-olive)]">
                      {copy.cardAction}
                      <span aria-hidden>→</span>
                    </span>
                  </Link>
                </FrCard>
              </Reveal>
            ))}
          </div>
        </div>
      </FrSection>

      <FrSection ground="frost">
        <div className="mx-auto max-w-4xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            {copy.omissionsTitle}
          </h2>
          <p className="fr-body mt-4 max-w-2xl text-[color:var(--fr-ink-70)]">
            {copy.omissionsLead}
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {omissions.map((point) => (
              <Reveal key={point.heading} className="h-full">
                <FrCard className="h-full p-6">
                  <h3 className="fr-h3 text-[color:var(--fr-ink)]">
                    {point.heading}
                  </h3>
                  <p className="mt-2 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                    {point.body}
                  </p>
                </FrCard>
              </Reveal>
            ))}
          </div>
        </div>
      </FrSection>

      <CountryOnly country="us">
        <SwitchBand
          heading={copy.switchTitle}
          lead={copy.switchLead}
          items={[
            { text: copy.switchNumber, good: true },
            { text: copy.switchLive, good: true },
            { text: copy.switchUsGuarantee, good: true },
            { text: copy.switchUsActivation },
          ]}
        />
      </CountryOnly>
      <CountryOnly country="ca">
        <SwitchBand
          heading={copy.switchTitle}
          lead={copy.switchLead}
          items={[
            { text: copy.switchNumber, good: true },
            { text: copy.switchLive, good: true },
            { text: copy.switchCaGuarantee, good: true },
            { text: copy.switchCaActivation, good: true },
          ]}
        />
      </CountryOnly>

      <CompareCta
        locale={locale}
        heading={copy.ctaTitle}
        sub={copy.ctaBody}
      />
    </>
  );
}
