import { CountryText } from "@/components/marketing/country";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { hvacScript } from "@/components/marketing/trades/scripts";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { hvacCopy } from "@/i18n/marketing/for-hvac";
import { fill } from "@/i18n/marketing/home";
import { activationChip, activationClaim } from "@/lib/marketing/activation";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

const PATH = "/for/hvac";

/** /for/hvac, composed once for both languages. See `plumbers-page.tsx`. */
export function HvacPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = hvacCopy(locale);
  const french = locale === "fr-CA";

  const content: TradeContent = {
    slug: "hvac",
    displayName: copy.displayName,

    dateline: copy.dateline,
    h1: copy.h1,
    heroSub: (
      <>
        {`${copy.heroSubBefore} `}
        <PlanPrice plan="starter" />
        {` ${copy.heroSubAfter}`}
      </>
    ),
    heroTruth: fill(copy.heroTruth, { chip: activationChip(locale) }),

    painH2: copy.painH2,
    painBody: [copy.painBodyOne, copy.painBodyTwo],

    threadH2: copy.threadH2,
    threadLede: copy.threadLede,
    script: hvacScript(locale),
    threadAriaLabel: copy.threadAriaLabel,

    useCasesH2: copy.useCasesH2,
    useCases: [
      { title: copy.useCaseTriageTitle, body: copy.useCaseTriageBody },
      { title: copy.useCaseFaultTitle, body: copy.useCaseFaultBody },
      { title: copy.useCaseQuoteTitle, body: copy.useCaseQuoteBody },
      {
        title: copy.useCaseMaintenanceTitle,
        body: copy.useCaseMaintenanceBody,
      },
    ],

    savedRepliesH2: copy.savedRepliesH2,
    savedRepliesIntro: copy.savedRepliesIntro,
    savedReplies: [
      { name: copy.replyOnMyWayName, text: copy.replyOnMyWayText },
      { name: copy.replyFilterName, text: copy.replyFilterText },
      { name: copy.replyQuoteName, text: copy.replyQuoteText },
      { name: copy.replyBookingName, text: copy.replyBookingText },
      { name: copy.replySeasonName, text: copy.replySeasonText },
      { name: copy.replyReviewName, text: copy.replyReviewText },
    ],
    savedRepliesCaption: copy.savedRepliesCaption,

    featuresH2: copy.featuresH2,
    features: [
      { title: copy.featureDispatchTitle, body: copy.featureDispatchBody },
      { title: copy.featureSeasonalTitle, body: copy.featureSeasonalBody },
      { title: copy.featureFollowUpTitle, body: copy.featureFollowUpBody },
      { title: copy.featureMechanicalTitle, body: copy.featureMechanicalBody },
    ],

    pricingH2: (
      <>
        <PlanPrice plan="starter" />
        {` ${copy.pricingH2After}`}
      </>
    ),
    pricingBody: (
      <>
        {`${copy.pricingBodyBefore} `}
        <PlanPrice plan="pro" />
        {copy.pricingBodyAfter}
      </>
    ),

    faqH2: copy.faqH2,
    faqs: [
      { q: copy.faqRemindersQ, a: copy.faqRemindersA },
      { q: copy.faqSurgeQ, a: copy.faqSurgeA },
      { q: copy.faqPhotosQ, a: copy.faqPhotosA },
      {
        q: copy.faqSeatsQ,
        a: (
          <>
            {`${copy.faqSeatsBefore} `}
            <PlanPrice plan="starter" />
            {` ${copy.faqSeatsMiddle} `}
            <PlanPrice plan="pro" />
            {` ${copy.faqSeatsAfter}`}
          </>
        ),
      },
      { q: copy.faqQuotesQ, a: copy.faqQuotesA },
      {
        q: copy.faqRegisterQ,
        a: <CountryText us={copy.faqRegisterUs} ca={copy.faqRegisterCa} />,
      },
    ],

    finalH2: copy.finalH2,
    finalSub: fill(copy.finalSub, { claim: activationClaim(locale) }),
  };

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.breadcrumbHome, path: french ? "/fr" : "/" },
          { name: copy.breadcrumbSelf, path: french ? "/fr/cvca" : PATH },
        ])}
      />
      <TradePage content={content} locale={locale} />
    </>
  );
}
