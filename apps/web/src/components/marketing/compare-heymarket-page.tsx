import Link from "next/link";

import {
  HEYMARKET_SEAT_PRICING,
  heymarketColumns,
  heymarketFootnote,
  heymarketRows,
} from "@/app/(marketing)/compare/heymarket/page-data";
import {
  compareAsOf,
  compareMonth,
} from "@/app/(marketing)/compare/verification";
import { compareHeymarketCopy } from "@/i18n/marketing/compare-heymarket";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

import {
  CompareCta,
  CompareHero,
  HonestFit,
  LedgerBand,
  SliderBand,
  SwitchBand,
} from "./compare/compare-sections";
import { LedgerTable } from "./compare/ledger-table";
import { CountryOnly } from "./country";
import { JsonLd } from "./ui/json-ld";

export function CompareHeymarketPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = compareHeymarketCopy(locale);
  const french = locale === "fr-CA";
  const path = french ? "/fr/comparer/heymarket" : "/compare/heymarket";
  const comparePath = french ? "/fr/comparer" : "/compare";
  const fairUsePath = french
    ? "/fr/utilisation-equitable"
    : "/legal/fair-use";

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.home, path: french ? "/fr" : "/" },
          { name: copy.compare, path: comparePath },
          { name: copy.breadcrumb, path },
        ])}
      />

      <CompareHero
        locale={locale}
        dateline={copy.dateline}
        title={copy.title}
        lead={copy.lead.replace("{month}", compareMonth(locale))}
      />

      <LedgerBand
        heading={copy.ledgerTitle}
        lead={
          <>
            {copy.ledgerLead}{" "}
            <Link
              href={fairUsePath}
              className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
            >
              {copy.fairUseLink}
            </Link>
            .
          </>
        }
        footnote={heymarketFootnote(locale)}
      >
        <LedgerTable
          locale={locale}
          caption={copy.ledgerCaption.replace(
            "{asOf}",
            compareAsOf(locale),
          )}
          columns={heymarketColumns(locale)}
          rows={heymarketRows(locale)}
        />
      </LedgerBand>

      <SliderBand
        locale={locale}
        heading={copy.sliderTitle}
        lead={copy.sliderLead}
        perUserMonthly={HEYMARKET_SEAT_PRICING.perUserMonthly}
        minimumSeats={HEYMARKET_SEAT_PRICING.minimumSeats}
      />

      <HonestFit
        heading={copy.fitTitle}
        intro={copy.fitIntro}
        loonextTitle={copy.loonextTitle}
        loonextBody={
          <>
            <p>{copy.loonextBodyOne}</p>
            <p>{copy.loonextBodyTwo}</p>
          </>
        }
        competitorTitle={copy.rivalTitle}
        competitorBody={
          <>
            <p>{copy.rivalBodyOne}</p>
            <p>{copy.rivalBodyTwo}</p>
          </>
        }
        points={[
          {
            title: copy.pointComplianceTitle,
            body: copy.pointComplianceBody,
          },
          { title: copy.pointEmailTitle, body: copy.pointEmailBody },
          { title: copy.pointCrmTitle, body: copy.pointCrmBody },
        ]}
        recommendation={copy.recommendation}
      />

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
