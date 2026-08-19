import { CountryText } from "@/components/marketing/country";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { landscapersScript } from "@/components/marketing/trades/scripts";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { landscapersCopy } from "@/i18n/marketing/for-landscapers";
import { fill } from "@/i18n/marketing/home";
import { activationChip, activationClaim } from "@/lib/marketing/activation";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

const PATH = "/for/landscapers";

/** /for/landscapers, composed once for both languages. See `plumbers-page.tsx`. */
export function LandscapersPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = landscapersCopy(locale);
  const french = locale === "fr-CA";

  const content: TradeContent = {
    slug: "landscapers",
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
    script: landscapersScript(locale),
    threadAriaLabel: copy.threadAriaLabel,

    useCasesH2: copy.useCasesH2,
    useCases: [
      { title: copy.useCaseWeatherTitle, body: copy.useCaseWeatherBody },
      { title: copy.useCasePhotosTitle, body: copy.useCasePhotosBody },
      { title: copy.useCaseSpringTitle, body: copy.useCaseSpringBody },
      { title: copy.useCaseGateTitle, body: copy.useCaseGateBody },
    ],

    savedRepliesH2: copy.savedRepliesH2,
    savedRepliesIntro: copy.savedRepliesIntro,
    savedReplies: [
      { name: copy.replyPhotoName, text: copy.replyPhotoText },
      { name: copy.replyQuoteName, text: copy.replyQuoteText },
      { name: copy.replyWeatherName, text: copy.replyWeatherText },
      { name: copy.replyOnTheWayName, text: copy.replyOnTheWayText },
      { name: copy.replySeasonName, text: copy.replySeasonText },
      { name: copy.replyDoneName, text: copy.replyDoneText },
    ],
    savedRepliesCaption: copy.savedRepliesCaption,

    featuresH2: copy.featuresH2,
    features: [
      { title: copy.featurePropertyTitle, body: copy.featurePropertyBody },
      { title: copy.featureAssignTitle, body: copy.featureAssignBody },
      { title: copy.featureSeasonTitle, body: copy.featureSeasonBody },
      { title: copy.featurePhotosTitle, body: copy.featurePhotosBody },
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
        {` ${copy.pricingBodyAfter}`}
      </>
    ),

    faqH2: copy.faqH2,
    faqs: [
      { q: copy.faqQuoteQ, a: copy.faqQuoteA },
      {
        q: copy.faqSeatsQ,
        a: (
          <>
            {`${copy.faqSeatsBefore} `}
            <PlanPrice plan="starter" />
            {`${copy.faqSeatsMiddle} `}
            <PlanPrice plan="pro" />
            {` ${copy.faqSeatsAfter}`}
          </>
        ),
      },
      { q: copy.faqCodeQ, a: copy.faqCodeA },
      { q: copy.faqWeatherQ, a: copy.faqWeatherA },
      { q: copy.faqSeasonalQ, a: copy.faqSeasonalA },
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
          {
            name: copy.breadcrumbSelf,
            path: french ? "/fr/paysagistes" : PATH,
          },
        ])}
      />
      <TradePage content={content} locale={locale} />
    </>
  );
}
