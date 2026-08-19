/**
 * /features/compliance, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * Dateline `STOP MEANS STOP · INSTANTLY` → H1 "Texting rules are real. We
 * deal with them so you don't have to." → the real registration stepper in
 * its "In review" state in a Panel Frame → the four proof points from the
 * deck expanded (registration filed for you; STOP means stop; consent on
 * the record; opt-outs honored however they're said) plus the late-night
 * send check → Truth Strip → pricing snippet → unique FAQ → Frost CTA band.
 *
 * The page branches on the site-wide country (CountryOnly / CountryText),
 * including the hero panel, the registration section, the truth strip, the
 * pricing snippet, the FAQ, and the closing CTA. In US mode the honest 10DLC
 * countdown story stays, "3 to 7 business days" stated up front, with no
 * Canadian carve-outs, and the hero panel is the registration tracker in
 * carrier review. In CA mode it reframes: no US carrier registration for
 * Canada-to-Canada texting, the hero panel is the consent record, and the copy
 * covers how consent under CASL works instead. Loonext HELPS you follow TCPA
 * and CASL; it never claims to make you compliant, and it never alters or
 * appends to message content.
 */

import { complianceCopy } from "@/i18n/marketing/compliance";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
import { CountryOnly, CountryText } from "@/components/marketing/country";
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
} from "@/components/marketing/features/feature-page";
import { ConsentVisual } from "@/components/marketing/features/consent-visual";
import { OptOutVisual } from "@/components/marketing/features/opt-out-visual";
import { QuietHoursVisual } from "@/components/marketing/features/quiet-hours-visual";
import { RegistrationStepperVisual } from "@/components/marketing/features/registration-stepper-visual";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

const PATH = "/features/compliance";

export function CompliancePageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = complianceCopy(locale);
  const french = locale === "fr-CA";
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.breadcrumbHome, path: french ? "/fr" : "/" },
          { name: copy.breadcrumbSelf, path: french ? "/fr/conformite" : PATH },
        ])}
      />

      <FeatureHero
        dateline={copy.dateline}
        title={copy.h1}
        sub={
          <CountryText
            us={copy.heroSubUs}
            ca={copy.heroSubCa}
          />
        }
        panel={
          <>
            <CountryOnly country="us">
              <PanelFrame
                caption={copy.heroCaptionUs}
                ariaLabel={copy.heroAriaUs}
              >
                <RegistrationStepperVisual locale={locale} />
              </PanelFrame>
            </CountryOnly>
            <CountryOnly country="ca">
              <PanelFrame
                caption={copy.heroCaptionCa}
                ariaLabel={copy.heroAriaCa}
              >
                <ConsentVisual locale={locale} />
              </PanelFrame>
            </CountryOnly>
          </>
        }
      />

      <CountryOnly country="us">
        <FeatureSection
          ground="frost"
          eyebrow={copy.regEyebrowUs}
          heading={copy.regTitleUs}
        >
          <p>
            {copy.regBodyUsOne}
          </p>
          <p>
            {copy.regBodyUsTwo}
          </p>
        </FeatureSection>
      </CountryOnly>

      <CountryOnly country="ca">
        <FeatureSection
          ground="frost"
          eyebrow={copy.regEyebrowCa}
          heading={copy.regTitleCa}
        >
          <p>
            {copy.regBodyCaOne}
          </p>
          <p>
            {copy.regBodyCaTwo}
          </p>
        </FeatureSection>
      </CountryOnly>

      <FeatureSection
        eyebrow={copy.optOutEyebrow}
        heading={copy.optOutTitle}
        visual={
          <PanelFrame
            caption={copy.optOutCaption}
            ariaLabel={copy.optOutAria}
          >
            <OptOutVisual locale={locale} />
          </PanelFrame>
        }
        flip
      >
        <p>
          {copy.optOutBodyOne}
        </p>
        <p>
          {copy.optOutBodyTwo}
        </p>
      </FeatureSection>

      <FeatureSection
        ground="frost"
        eyebrow={copy.consentEyebrow}
        heading={copy.consentTitle}
        visual={
          <PanelFrame
            caption={copy.consentCaption}
            ariaLabel={copy.consentAria}
          >
            <ConsentVisual locale={locale} />
          </PanelFrame>
        }
      >
        <p>
          {copy.consentBodyOne}
        </p>
        <p>
          {copy.consentBodyTwo}
        </p>
      </FeatureSection>

      <FeatureSection
        eyebrow={copy.quietEyebrow}
        heading={copy.quietTitle}
        visual={
          <PanelFrame
            caption={copy.quietCaption}
            ariaLabel={copy.quietAria}
          >
            <QuietHoursVisual locale={locale} />
          </PanelFrame>
        }
        flip
      >
        <p>
          {copy.quietBodyOne}
        </p>
        <p>
          {copy.quietBodyTwo}
        </p>
      </FeatureSection>

      <CountryOnly country="us">
        <TruthStripSection
          heading={copy.factsEyebrow}
          items={[
            {
              text: copy.factsKeywords,
              good: true,
            },
            {
              text: copy.factsWaitUs,
            },
            {
              text: copy.factsLawUs,
            },
          ]}
        />
      </CountryOnly>

      <CountryOnly country="ca">
        <TruthStripSection
          heading={copy.factsEyebrow}
          items={[
            {
              text: copy.factsKeywords,
              good: true,
            },
            {
              text: copy.factsNoWaitCa,
              good: true,
            },
            {
              text: copy.factsLawCa,
            },
          ]}
        />
      </CountryOnly>

      <PlainDetails
        heading={copy.claimsEyebrow}
        lead={copy.claimsLead}
        items={[
          {
            term: copy.claimsHelpTitle,
            detail:
              copy.claimsHelpBody,
          },
          {
            term: copy.claimsAlterTitle,
            detail:
              copy.claimsAlterBody,
          },
          {
            term: copy.claimsBlastTitle,
            detail:
              copy.claimsBlastBody,
          },
          {
            term: copy.claimsNudgeTitle,
            detail:
              copy.claimsNudgeBody,
          },
        ]}
      />

      <PricingSnippet>
        <p>
          {copy.pricingBefore}{" "}
          <PlanPrice plan="starter" /> {copy.pricingOr} <PlanPrice plan="pro" />.
        </p>
        <CountryText
          us={
            <p>
              {copy.pricingUsBefore} <RegistrationFee />{" "}
              {copy.pricingUsMiddle}{" "}
              <FirstMonthTotal plan="starter" /> {copy.pricingUsAnd} <PlanPrice plan="starter" />.
            </p>
          }
          ca={
            <p>
              {copy.pricingCaBefore}{" "}
              <PlanPrice plan="starter" /> {copy.pricingOr} <PlanPrice plan="pro" /> {copy.pricingCaAfter}
            </p>
          }
        />
      </PricingSnippet>

      <RelatedLinks
        heading={copy.relatedEyebrow}
        intro={copy.relatedTitle}
        links={[
          {
            label: copy.relatedAupTitle,
            href: "/legal/aup",
            hint: copy.relatedAupBody,
          },
          {
            label: copy.relatedSmsTitle,
            href: "/legal/messaging",
            hint: copy.relatedSmsBody,
          },
          {
            label: copy.relatedCanadaTitle,
            href: "/canada",
            hint: copy.relatedCanadaBody,
          },
        ]}
      />

      <CountryOnly country="us">
        <FeatureFaq
          heading={copy.faqTitle}
          faqs={[
            {
              q: copy.faq10dlcQ,
              a: copy.faq10dlcA,
            },
            {
              q: copy.faqWaitQ,
              a: copy.faqWaitA,
            },
            {
              q: copy.faqStopQ,
              a: copy.faqStopA,
            },
            {
              q: copy.faqConsentQ,
              a: copy.faqConsentA,
            },
            {
              q: copy.faqAlterQ,
              a: copy.faqAlterA,
            },
            {
              q: copy.faqLegalQ,
              a: copy.faqLegalAUs,
            },
          ]}
        />
      </CountryOnly>

      <CountryOnly country="ca">
        <FeatureFaq
          heading={copy.faqTitle}
          faqs={[
            {
              q: copy.faqRegisterCaQ,
              a: copy.faqRegisterCaA,
            },
            {
              q: copy.faqCaslQ,
              a: copy.faqCaslA,
            },
            {
              q: copy.faqStopQ,
              a: copy.faqStopA,
            },
            {
              q: copy.faqConsentQ,
              a: copy.faqConsentA,
            },
            {
              q: copy.faqAlterQ,
              a: copy.faqAlterA,
            },
            {
              q: copy.faqLegalQ,
              a: copy.faqLegalACa,
            },
          ]}
        />
      </CountryOnly>

      <CountryOnly country="us">
        <FeatureCta
          heading={copy.ctaTitleUs}
          sub={copy.ctaSubUs}
        />
      </CountryOnly>

      <CountryOnly country="ca">
        <FeatureCta
          heading={copy.ctaTitleCa}
          sub={copy.ctaSubCa}
        />
      </CountryOnly>
    </>
  );
}
