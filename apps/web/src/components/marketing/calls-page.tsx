/**
 * /features/calls, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * WHY THIS PAGE EXISTS (#491). Calling has shipped on every plan since
 * D36–D43 and the marketing site never had a page for it, so the product read
 * as a texting tool with a dialer bolted on. The founder's words: "instead of
 * making it look like our platform is for texts only."
 *
 * THE OBJECTION IT HAS TO ANSWER is not "can it make calls". It is "so it is a
 * texting app that also dials out". The answer is the pair the visual shows:
 * an incoming call ringing the WHOLE CREW, and the voicemail it becomes,
 * written down, when they were all on a roof.
 *
 * Dateline `WHOEVER IS FREE PICKS UP` → H1 → the ringing card + the voicemail
 * it becomes → the core idea → use cases → what it is NOT → Truth Strip →
 * pricing snippet → related → unique FAQ → Frost CTA band.
 *
 * Every claim here is checked against `lib/marketing/llms-txt.ts` and
 * docs/CALLS-V2.md. The deletions matter as much as the features: D43 removed
 * cell forwarding, so no sentence on this page may imply a call reaches a
 * personal phone. buildMetadata + BreadcrumbList JSON-LD; no FAQPage.
 */

import { callsCopy } from "@/i18n/marketing/calls";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import Link from "next/link";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
import { CallVisual } from "@/components/marketing/features/call-visual";
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

const PATH = "/features/calls";

export function CallsPageBody({ locale = "en" }: { locale?: MarketingLocale }) {
  const copy = callsCopy(locale);
  const french = locale === "fr-CA";
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.breadcrumbHome, path: french ? "/fr" : "/" },
          { name: copy.breadcrumbSelf, path: french ? "/fr/appels" : PATH },
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
            <CallVisual locale={locale} />
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
        eyebrow={copy.useEyebrow}
        heading={copy.useTitle}
        steps={[
          {
            title: copy.useMissedTitle,
            body: copy.useMissedBody,
          },
          {
            title: copy.useOfficeTitle,
            body: copy.useOfficeBody,
          },
          {
            title: copy.useTaskTitle,
            body: copy.useTaskBody,
          },
        ]}
      />

      <FeatureSection
        eyebrow={copy.notEyebrow}
        heading={copy.notTitle}
      >
        <p>
          {copy.notBodyOne}
        </p>
        <p>
          {copy.notBodyTwo}
        </p>
        <p>
          {copy.notBodyThree}
        </p>
      </FeatureSection>

      <TruthStripSection
        heading={copy.factsEyebrow}
        items={[
          {
            text: copy.factsIncluded,
            good: true,
          },
          {
            text: copy.factsMinutes,
          },
          {
            text: copy.factsTranscripts,
          },
          {
            text: copy.factsNoHardware,
          },
        ]}
      />

      <PricingSnippet>
        <p>
          {copy.pricingBefore} <PlanPrice plan="starter" />/mo on
          Starter covers up to 3 people and <PlanPrice plan="pro" />/mo on Pro
          covers up to 15, and calls are included at both prices. Minutes work
          the way texting does, on a fair-use basis rather
          than a hard cap, with a spending limit you set and an email at 80%
          and again at 100% before a single paid minute is billed. The concrete
          numbers live in our{" "}
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
            label: copy.relatedNumberTitle,
            href: "/features/business-number",
            hint: copy.relatedNumberBody,
          },
          {
            label: copy.relatedMissedTitle,
            href: "/blog/missed-calls-lost-jobs-text-back-playbook",
            hint: copy.relatedMissedBody,
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
            q: copy.faqCellQ,
            a: copy.faqCellA,
          },
          {
            q: copy.faqNoAnswerQ,
            a: copy.faqNoAnswerA,
          },
          {
            q: copy.faqTwoQ,
            a: copy.faqTwoA,
          },
          {
            q: copy.faqOutboundQ,
            a: copy.faqOutboundA,
          },
          {
            q: copy.faqTransferQ,
            a: copy.faqTransferA,
          },
          {
            q: copy.faqRecordQ,
            a: copy.faqRecordA,
          },
          {
            q: copy.faqHardwareQ,
            a: copy.faqHardwareA,
          },
        ]}
      />

      <FeatureCta
        heading={copy.ctaTitle}
        sub={`Calls and texts on one business number, answered by whoever is free, ${ACTIVATION_CLAIM}. See the price.`}
      />
    </>
  );
}
