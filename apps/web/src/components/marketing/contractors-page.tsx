import Link from "next/link";

import { CountryText } from "@/components/marketing/country";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { contractorsScript } from "@/components/marketing/trades/scripts";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { contractorsCopy } from "@/i18n/marketing/for-contractors";
import { fill } from "@/i18n/marketing/home";
import { activationChip, activationClaim } from "@/lib/marketing/activation";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

const PATH = "/for/contractors";

/** /for/contractors, composed once for both languages. See `plumbers-page.tsx`. */
export function ContractorsPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = contractorsCopy(locale);
  const french = locale === "fr-CA";

  const content: TradeContent = {
    slug: "contractors",
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
    script: contractorsScript(locale),
    threadAriaLabel: copy.threadAriaLabel,

    useCasesH2: copy.useCasesH2,
    useCases: [
      { title: copy.useCaseDecisionsTitle, body: copy.useCaseDecisionsBody },
      { title: copy.useCaseSubsTitle, body: copy.useCaseSubsBody },
      { title: copy.useCasePhotosTitle, body: copy.useCasePhotosBody },
      { title: copy.useCaseCellTitle, body: copy.useCaseCellBody },
    ],

    savedRepliesH2: copy.savedRepliesH2,
    savedRepliesIntro: copy.savedRepliesIntro,
    savedReplies: [
      { name: copy.replyAccessName, text: copy.replyAccessText },
      { name: copy.replyChangeName, text: copy.replyChangeText },
      { name: copy.replyProgressName, text: copy.replyProgressText },
      { name: copy.replySubName, text: copy.replySubText },
      { name: copy.replyDecisionName, text: copy.replyDecisionText },
      { name: copy.replyWalkthroughName, text: copy.replyWalkthroughText },
    ],
    savedRepliesCaption: copy.savedRepliesCaption,

    featuresH2: copy.featuresH2,
    features: [
      { title: copy.featureDoneTitle, body: copy.featureDoneBody },
      { title: copy.featureHandoffTitle, body: copy.featureHandoffBody },
      { title: copy.featureNotesTitle, body: copy.featureNotesBody },
      { title: copy.featureNumberTitle, body: copy.featureNumberBody },
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
    truthLines: [
      {
        text: (
          <>
            {copy.truthSuiteBefore}{" "}
            <Link
              href="/compare"
              className="text-[color:var(--fr-olive)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
            >
              {copy.truthSuiteLink}
            </Link>{" "}
            {copy.truthSuiteAfter}
          </>
        ),
      },
    ],

    faqH2: copy.faqH2,
    faqs: [
      { q: copy.faqPmQ, a: copy.faqPmA },
      { q: copy.faqDoneQ, a: copy.faqDoneA },
      { q: copy.faqSeparateQ, a: copy.faqSeparateA },
      { q: copy.faqProofQ, a: copy.faqProofA },
      { q: copy.faqOutQ, a: copy.faqOutA },
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
            path: french ? "/fr/entrepreneurs" : PATH,
          },
        ])}
      />
      <TradePage content={content} locale={locale} />
    </>
  );
}
