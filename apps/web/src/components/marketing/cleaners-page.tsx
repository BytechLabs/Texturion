import { CountryText } from "@/components/marketing/country";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { cleanersScript } from "@/components/marketing/trades/scripts";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { cleanersCopy } from "@/i18n/marketing/for-cleaners";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { fill } from "@/i18n/marketing/home";
import { activationChip, activationClaim } from "@/lib/marketing/activation";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

const PATH = "/for/cleaners";

/** /for/cleaners, composed once for both languages. See `plumbers-page.tsx`. */
export function CleanersPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = cleanersCopy(locale);
  const french = locale === "fr-CA";

  const content: TradeContent = {
    slug: "cleaners",
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
    script: cleanersScript(locale),
    threadAriaLabel: copy.threadAriaLabel,

    useCasesH2: copy.useCasesH2,
    useCases: [
      { title: copy.useCaseEntryTitle, body: copy.useCaseEntryBody },
      { title: copy.useCaseConfirmTitle, body: copy.useCaseConfirmBody },
      { title: copy.useCaseAddOnTitle, body: copy.useCaseAddOnBody },
      { title: copy.useCaseRescheduleTitle, body: copy.useCaseRescheduleBody },
    ],

    savedRepliesH2: copy.savedRepliesH2,
    savedRepliesIntro: copy.savedRepliesIntro,
    savedReplies: [
      { name: copy.replyVisitName, text: copy.replyVisitText },
      { name: copy.replyAccessName, text: copy.replyAccessText },
      { name: copy.replyOnOurWayName, text: copy.replyOnOurWayText },
      { name: copy.replyAddOnName, text: copy.replyAddOnText },
      { name: copy.replyRescheduleName, text: copy.replyRescheduleText },
      { name: copy.replyDoneName, text: copy.replyDoneText },
    ],
    savedRepliesCaption: copy.savedRepliesCaption,

    featuresH2: copy.featuresH2,
    features: [
      { title: copy.featureNotesTitle, body: copy.featureNotesBody },
      { title: copy.featureDispatchTitle, body: copy.featureDispatchBody },
      { title: copy.featureHistoryTitle, body: copy.featureHistoryBody },
      { title: copy.featureApronTitle, body: copy.featureApronBody },
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
      { q: copy.faqCodeQ, a: copy.faqCodeA },
      { q: copy.faqRescheduleQ, a: copy.faqRescheduleA },
      { q: copy.faqRegularsQ, a: copy.faqRegularsA },
      { q: copy.faqOfficeQ, a: copy.faqOfficeA },
      { q: copy.faqConfirmQ, a: copy.faqConfirmA },
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
          { name: copy.breadcrumbSelf, path: french ? "/fr/menage" : PATH },
        ])}
      />
      <TradePage content={content} locale={locale} />
    </>
  );
}
