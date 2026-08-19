import { CountryText } from "@/components/marketing/country";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { salonsScript } from "@/components/marketing/trades/scripts";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { salonsCopy } from "@/i18n/marketing/for-salons";
import { fill } from "@/i18n/marketing/home";
import { activationChip, activationClaim } from "@/lib/marketing/activation";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

const PATH = "/for/salons";

/** /for/salons, composed once for both languages. See `plumbers-page.tsx`. */
export function SalonsPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = salonsCopy(locale);
  const french = locale === "fr-CA";

  const content: TradeContent = {
    slug: "salons",
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
    script: salonsScript(locale),
    threadAriaLabel: copy.threadAriaLabel,

    useCasesH2: copy.useCasesH2,
    useCases: [
      { title: copy.useCaseConfirmTitle, body: copy.useCaseConfirmBody },
      { title: copy.useCaseWaitlistTitle, body: copy.useCaseWaitlistBody },
      { title: copy.useCaseAftercareTitle, body: copy.useCaseAftercareBody },
      { title: copy.useCaseConsultTitle, body: copy.useCaseConsultBody },
    ],

    savedRepliesH2: copy.savedRepliesH2,
    savedRepliesIntro: copy.savedRepliesIntro,
    savedReplies: [
      { name: copy.replyConfirmName, text: copy.replyConfirmText },
      { name: copy.replyWaitlistName, text: copy.replyWaitlistText },
      { name: copy.replyAftercareName, text: copy.replyAftercareText },
      { name: copy.replyBehindName, text: copy.replyBehindText },
      { name: copy.replyConsultName, text: copy.replyConsultText },
      { name: copy.replyReviewName, text: copy.replyReviewText },
    ],
    savedRepliesCaption: copy.savedRepliesCaption,

    featuresH2: copy.featuresH2,
    features: [
      { title: copy.featureFloorTitle, body: copy.featureFloorBody },
      { title: copy.featureAssignTitle, body: copy.featureAssignBody },
      { title: copy.featureNotesTitle, body: copy.featureNotesBody },
      { title: copy.featureNoAppTitle, body: copy.featureNoAppBody },
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
      { q: copy.faqRemindersQ, a: copy.faqRemindersA },
      { q: copy.faqNoShowQ, a: copy.faqNoShowA },
      { q: copy.faqWaitlistQ, a: copy.faqWaitlistA },
      { q: copy.faqStylistQ, a: copy.faqStylistA },
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
          { name: copy.breadcrumbSelf, path: french ? "/fr/salons" : PATH },
        ])}
      />
      <TradePage content={content} locale={locale} />
    </>
  );
}
