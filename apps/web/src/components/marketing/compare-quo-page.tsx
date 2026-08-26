import Link from "next/link";

import {
  QUO_SEAT_PRICING,
  quoColumns,
  quoFootnote,
  quoRows,
} from "@/app/(marketing)/compare/quo/page-data";
import {
  compareAsOf,
  compareMonth,
} from "@/app/(marketing)/compare/verification";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { compareQuoCopy } from "@/i18n/marketing/compare-quo";
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

export function CompareQuoPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = compareQuoCopy(locale);
  const french = locale === "fr-CA";
  const path = french ? "/fr/comparer/quo" : "/compare/quo";
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
        footnote={quoFootnote(locale)}
      >
        <LedgerTable
          locale={locale}
          caption={copy.ledgerCaption.replace(
            "{asOf}",
            compareAsOf(locale),
          )}
          columns={quoColumns(locale)}
          rows={quoRows(locale)}
        />
      </LedgerBand>

      <SliderBand
        locale={locale}
        heading={copy.sliderTitle}
        lead={copy.sliderLead}
        perUserMonthly={QUO_SEAT_PRICING.perUserMonthly}
        minimumSeats={QUO_SEAT_PRICING.minimumSeats}
      />

      <HonestFit
        heading={copy.fitTitle}
        intro={copy.fitIntro}
        loonextTitle={copy.loonextTitle}
        loonextBody={
          <>
            <p>{copy.loonextBody}</p>
            <CountryOnly country="us">
              <p>{copy.loonextUs}</p>
            </CountryOnly>
            <CountryOnly country="ca">
              <p>{copy.loonextCa}</p>
            </CountryOnly>
          </>
        }
        competitorTitle={copy.rivalTitle}
        competitorBody={
          <>
            <p>{copy.rivalBody}</p>
            <p>{copy.rivalBodyTwo}</p>
          </>
        }
        points={[
          { title: copy.pointCallingTitle, body: copy.pointCallingBody },
          { title: copy.pointFeesTitle, body: copy.pointFeesBody },
          { title: copy.pointAppsTitle, body: copy.pointAppsBody },
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
            { text: copy.switchCalling },
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
            { text: copy.switchCalling },
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
