/**
 * /features/contacts, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * WHY THIS PAGE EXISTS (#491). Contacts are an app tab and the marketing site
 * mentioned them once, as a CSV import feature, which is the least interesting
 * true thing about them.
 *
 * THE IDEA IS D99: a customer's history is one stream, assembled at read time.
 * Threading (D7) reopens a conversation closed within 30 days and otherwise
 * starts a new one, so a customer serviced once a year for six years is six
 * conversations — correct, and it means "what have we done for this customer?"
 * spanned N records with nothing assembling them. That question, asked before
 * every visit, is what this page sells.
 *
 * WHAT IT DOES NOT CLAIM: merging duplicates. #246 is open. Two customers that
 * already exist twice stay twice, and saying otherwise on a page about having
 * one record per customer would be the worst possible place to overpromise.
 */

import { contactsCopy } from "@/i18n/marketing/contacts";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import Link from "next/link";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
import { ContactTimelineVisual } from "@/components/marketing/features/contact-timeline-visual";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";
import {
  FeatureCta,
  FeatureFaq,
  FeatureHero,
  FeatureSection,
  PricingSnippet,
  RelatedLinks,
  TruthStripSection,
  UseCaseSteps,
} from "@/components/marketing/features/feature-page";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";
import { ACTIVATION_CLAIM } from "@/lib/marketing/activation";

const PATH = "/features/contacts";

export function ContactsPageBody({ locale = "en" }: { locale?: MarketingLocale }) {
  const copy = contactsCopy(locale);
  const french = locale === "fr-CA";
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.breadcrumbHome, path: french ? "/fr" : "/" },
          { name: copy.breadcrumbSelf, path: french ? "/fr/contacts" : PATH },
        ])}
      />

      <FeatureHero
        dateline={copy.dateline}
        title={copy.h1}
        sub={copy.heroSub}
        panel={
          <PanelFrame
            caption={copy.timelineCaption}
            ariaLabel={copy.timelineAria}
          >
            <ContactTimelineVisual locale={locale} />
          </PanelFrame>
        }
      />

      <FeatureSection
        ground="frost"
        eyebrow={copy.coreEyebrow}
        heading={copy.coreTitle}
      >
        <p>
          {copy.coreBodyOne}
        </p>
        <p>
          {copy.coreBodyTwo}
        </p>
        <p>
          {copy.coreBodyThree}
        </p>
      </FeatureSection>

      <UseCaseSteps
        ground="white"
        eyebrow={copy.holdsEyebrow}
        heading={copy.holdsTitle}
        steps={[
          {
            title: copy.holdsAddressTitle,
            body: copy.holdsAddressBody,
          },
          {
            title: copy.holdsConsentTitle,
            body: copy.holdsConsentBody,
          },
          {
            title: copy.holdsHistoryTitle,
            body: copy.holdsHistoryBody,
          },
          {
            title: copy.holdsImportTitle,
            body: copy.holdsImportBody,
          },
        ]}
      />

      <TruthStripSection
        heading={copy.factsEyebrow}
        items={[
          {
            text: copy.factsAssembled,
            good: true,
          },
          {
            text: copy.factsNotes,
          },
          {
            text: copy.factsDuplicates,
          },
          {
            text: copy.factsCsv,
          },
        ]}
      />

      <PricingSnippet>
        <p>
          {copy.pricingBefore} <PlanPrice plan="starter" />/mo on
          Starter for up to 3 people, <PlanPrice plan="pro" />/mo on Pro for up
          to 15. There is no per-contact pricing, no
          contact cap and no CRM tier. Photos and files attached to a customer
          are stored free with no caps, which is set out with everything else in
          our{" "}
          <Link
            href="/legal/fair-use"
            className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
          >
            {copy.fairUseLink}
          </Link>
          .
        </p>
      </PricingSnippet>

      <RelatedLinks
        heading={copy.relatedEyebrow}
        intro={copy.relatedTitle}
        links={[
          {
            label: copy.relatedInboxTitle,
            href: "/features/shared-inbox",
            hint: copy.relatedInboxBody,
          },
          {
            label: copy.relatedCallsTitle,
            href: "/features/calls",
            hint: copy.relatedCallsBody,
          },
          {
            label: copy.relatedTasksTitle,
            href: "/features/tasks",
            hint: copy.relatedTasksBody,
          },
          {
            label: copy.relatedComplianceTitle,
            href: "/features/compliance",
            hint: copy.relatedComplianceBody,
          },
        ]}
      />

      <FeatureFaq
        heading={copy.faqTitle}
        faqs={[
          {
            q: copy.faqCrmQ,
            a: copy.faqCrmA,
          },
          {
            q: copy.faqMergeQ,
            a: copy.faqMergeA,
          },
          {
            q: copy.faqNotesQ,
            a: copy.faqNotesA,
          },
          {
            q: copy.faqExportQ,
            a: copy.faqExportA,
          },
          {
            q: copy.faqCallsQ,
            a: copy.faqCallsA,
          },
        ]}
      />

      <FeatureCta
        heading={copy.ctaTitle}
        sub={`One history per customer, assembled from every text and call, ${ACTIVATION_CLAIM}. See the price.`}
      />
    </>
  );
}
