import { CountryText } from "@/components/marketing/country";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { plumbersScript } from "@/components/marketing/trades/scripts";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { plumbersCopy } from "@/i18n/marketing/for-plumbers";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { fill } from "@/i18n/marketing/home";
import { activationChip, activationClaim } from "@/lib/marketing/activation";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

const PATH = "/for/plumbers";

/**
 * /for/plumbers, composed once for both languages.
 *
 * The content object is built per render rather than declared at module scope,
 * because it now depends on a locale. Everything that quotes a price still
 * renders `<PlanPrice>`, so a Canadian reader sees the CAD figure their card is
 * charged (#328) — which is why the sentences carrying one are split around it
 * instead of interpolating a string.
 */
export function PlumbersPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = plumbersCopy(locale);
  const french = locale === "fr-CA";

  const content: TradeContent = {
    slug: "plumbers",
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
    script: plumbersScript(locale),
    threadAriaLabel: copy.threadAriaLabel,

    useCasesH2: copy.useCasesH2,
    useCases: [
      { title: copy.useCasePhotoTitle, body: copy.useCasePhotoBody },
      { title: copy.useCaseOnMyWayTitle, body: copy.useCaseOnMyWayBody },
      { title: copy.useCaseQuoteTitle, body: copy.useCaseQuoteBody },
      { title: copy.useCaseAfterHoursTitle, body: copy.useCaseAfterHoursBody },
    ],

    savedRepliesH2: copy.savedRepliesH2,
    savedRepliesIntro: copy.savedRepliesIntro,
    savedReplies: [
      { name: copy.replyOnMyWayName, text: copy.replyOnMyWayText },
      { name: copy.replyPhotoName, text: copy.replyPhotoText },
      { name: copy.replyQuoteName, text: copy.replyQuoteText },
      { name: copy.replyBookingName, text: copy.replyBookingText },
      { name: copy.replyDoneName, text: copy.replyDoneText },
      { name: copy.replyReviewName, text: copy.replyReviewText },
    ],
    savedRepliesCaption: copy.savedRepliesCaption,

    featuresH2: copy.featuresH2,
    features: [
      { title: copy.featureNumberTitle, body: copy.featureNumberBody },
      { title: copy.featureAssignTitle, body: copy.featureAssignBody },
      { title: copy.featureNotesTitle, body: copy.featureNotesBody },
      { title: copy.featureCrawlspaceTitle, body: copy.featureCrawlspaceBody },
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
      { q: copy.faqPhotosQ, a: copy.faqPhotosA },
      { q: copy.faqTechsQ, a: copy.faqTechsA },
      { q: copy.faqNightQ, a: copy.faqNightA },
      {
        q: copy.faqTwoGuysQ,
        a: (
          <>
            {`${copy.faqTwoGuysBefore} `}
            <PlanPrice plan="starter" />
            {` ${copy.faqTwoGuysAfter}`}
          </>
        ),
      },
      { q: copy.faqOnMyWayQ, a: copy.faqOnMyWayA },
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
            path: french ? "/fr/plombiers" : PATH,
          },
        ])}
      />
      <TradePage content={content} locale={locale} />
    </>
  );
}
