/**
 * /features/business-number, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * Dateline `THE NUMBER BELONGS TO THE BUSINESS` → H1 "A local number that
 * belongs to the business, not to somebody's phone." → sections: pick a
 * local number (set up today, US texting after carrier approval), bring your
 * number (free porting,
 * self-serve, the old number keeps working until the scheduled cutover,
 * usually a few days to two weeks for US numbers and often faster in
 * Canada), two numbers on Pro → Truth Strip branched by country (US
 * first-week approval in US mode, same-day/no-wait in CA mode) → pricing
 * snippet branched by country → unique FAQ → Frost CTA band.
 *
 * Every number is a verified product/billing fact. buildMetadata +
 * BreadcrumbList JSON-LD; no FAQPage.
 */


import {
  businessNumberCopy,
  type BusinessNumberCopy,
} from "@/i18n/marketing/business-number";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
import { CountryOnly, CountryText } from "@/components/marketing/country";
import { CityAreaCodeWidget } from "@/components/marketing/interactive/city-area-code-widget";
import {
  FirstMonthTotal,
  PlanPrice,
  RegistrationFee,
} from "@/components/marketing/pricing/plan-price";
import {
  FeatureCta,
  FeatureFaq,
  FeatureHero,
  FeatureSection,
  PlainDetails,
  PricingSnippet,
  RelatedLinks,
  TruthStripSection,
  UseCaseSteps,
} from "@/components/marketing/features/feature-page";
import { NumberCardsVisual } from "@/components/marketing/features/number-cards-visual";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";
import { activationClaim } from "@/lib/marketing/activation";

const PATH = "/features/business-number";

/**
 * The two "precise edges" facts that hold in both countries. The sole-proprietor
 * single-number cap is a US 10DLC-registration mechanic, so it lives only in the
 * US branch of PlainDetails below (Canada-to-Canada texting has no registration).
 */
const portDetail = (copy: BusinessNumberCopy) => ({
  term: copy.edgesPortTitle,
  detail: copy.edgesPortBody,
});

const paidPlanDetail = (copy: BusinessNumberCopy) => ({
  term: copy.edgesPaidTitle,
  detail: copy.edgesPaidBody,
});

export function BusinessNumberPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = businessNumberCopy(locale);
  const french = locale === "fr-CA";
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.breadcrumbHome, path: french ? "/fr" : "/" },
          { name: copy.breadcrumbSelf, path: french ? "/fr/numero-entreprise" : PATH },
        ])}
      />

      <FeatureHero
        dateline={copy.dateline}
        title={copy.h1}
        sub={copy.heroSub}
        panel={
          <PanelFrame
            caption={copy.visualCaption}
            ariaLabel={copy.visualAria}
          >
            <NumberCardsVisual locale={locale} />
          </PanelFrame>
        }
      />

      <FeatureSection
        ground="frost"
        eyebrow={copy.localEyebrow}
        heading={copy.localTitle}
        visual={<CityAreaCodeWidget />}
      >
        <p>
          {copy.localBodyOne}
        </p>
        <p>
          {copy.localBodyTwo}
        </p>
      </FeatureSection>

      <FeatureSection
        eyebrow={copy.portEyebrow}
        heading={copy.portTitle}
        flip
      >
        <p>
          {copy.portBodyOne}
        </p>
        <p>
          {copy.portBodyTwo}
        </p>
      </FeatureSection>

      <UseCaseSteps
        eyebrow={copy.fixesEyebrow}
        heading={copy.fixesTitle}
        steps={[
          {
            title: copy.fixesQuoteTitle,
            body: copy.fixesQuoteBody,
          },
          {
            title: copy.fixesTechTitle,
            body: copy.fixesTechBody,
          },
          {
            title: copy.fixesTwoTitle,
            body: copy.fixesTwoBody,
          },
        ]}
      />

      <CountryOnly country="us">
        <TruthStripSection
          heading={copy.weekUsTitle}
          items={[
            {
              text: copy.weekUsDayOne,
              good: true,
            },
            {
              text: copy.weekUsApproval,
            },
            {
              text: copy.weekUsScope,
            },
          ]}
        />
      </CountryOnly>

      <CountryOnly country="ca">
        <TruthStripSection
          heading={copy.weekCaTitle}
          items={[
            {
              text: copy.weekCaDayOne,
              good: true,
            },
            {
              text: copy.weekCaNoWait,
              good: true,
            },
            {
              text: copy.weekUsScope,
            },
          ]}
        />
      </CountryOnly>

      <CountryOnly country="us">
        <PlainDetails
          heading={copy.edgesEyebrow}
          lead={copy.edgesTitle}
          items={[
            portDetail(copy),
            {
              term: copy.edgesSoleTitle,
              detail:
                copy.edgesSoleBody,
            },
            paidPlanDetail(copy),
          ]}
        />
      </CountryOnly>

      <CountryOnly country="ca">
        <PlainDetails
          heading={copy.edgesEyebrow}
          lead="A phone number is a serious thing to hand your customers, so here is exactly how Loonext numbers work, including the limits."
          items={[portDetail(copy), paidPlanDetail(copy)]}
        />
      </CountryOnly>

      <PricingSnippet>
        <p>
          {copy.pricingStarterBefore} <PlanPrice plan="starter" />
          {copy.pricingStarterAfter}{" "}
          <PlanPrice plan="pro" />
          {copy.pricingProAfter}
        </p>
        <CountryText
          us={
            <p>
              {copy.pricingUsBefore} <RegistrationFee /> {copy.pricingUsMiddle} <FirstMonthTotal plan="starter" /> {copy.pricingUsAnd}{" "}
              <PlanPrice plan="starter" />.
            </p>
          }
          ca={
            <p>
              {copy.pricingCaBefore}{" "}
              <PlanPrice plan="starter" /> {copy.pricingCaOr} <PlanPrice plan="pro" /> {copy.pricingCaAfter}
            </p>
          }
        />
      </PricingSnippet>

      <RelatedLinks
        heading={copy.relatedEyebrow}
        intro={copy.relatedTitle}
        links={[
          {
            label: copy.relatedContractorsTitle,
            href: "/for/contractors",
            hint: copy.relatedContractorsBody,
          },
          {
            label: copy.relatedLandscapersTitle,
            href: "/for/landscapers",
            hint: copy.relatedLandscapersBody,
          },
          {
            label: copy.relatedCanadaTitle,
            href: "/canada",
            hint: copy.relatedCanadaBody,
          },
          {
            label: copy.relatedCompareTitle,
            href: "/compare/quo",
            hint: copy.relatedCompareBody,
          },
        ]}
      />

      <FeatureFaq
        heading={copy.faqTitle}
        faqs={[
          {
            q: copy.faqAreaQ,
            a: copy.faqAreaA,
          },
          {
            q: copy.faqPortQ,
            a: copy.faqPortA,
          },
          {
            q: copy.faqTwoQ,
            a: copy.faqTwoA,
          },
          {
            q: copy.faqOwnQ,
            a: copy.faqOwnA,
          },
          {
            q: copy.faqReadyQ,
            a: (
              <>
                Usually a minute or two after you subscribe. Receiving texts
                works as soon as the number is active.{" "}
                <CountryText
                  us={copy.faqReadyUs}
                  ca={copy.faqReadyCa}
                />
              </>
            ),
          },
        ]}
      />

      <FeatureCta
        heading={copy.ctaTitle}
        sub={`${copy.ctaSubBefore} ${activationClaim(locale)}${copy.ctaSubAfter}`}
      />
    </>
  );
}
