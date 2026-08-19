/**
 * /features/assistant — Lou, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * WHY THIS PAGE EXISTS (#491). Five AI features have shipped and the marketing
 * site mentioned none of them, which is half of why the product reads as a
 * texting tool: the assistant is the part a buyer compares against everybody
 * else's "AI receptionist".
 *
 * THE COPY RULE THIS PAGE IS WRITTEN UNDER is the one in
 * docs/DESCRIPTIVE-SURFACES.md: "Overstating a limit is a documentation error.
 * Understating what you do with customer data is the other thing." So the page
 * leads with what Lou touches and what it never does, and the defaults are
 * stated per feature rather than as one comfortable sentence. Four toggles are
 * ON; `voicemail_intake` is OFF, and it says so, because it is the only one
 * that changes what a stranger hears in the business's own name (D89).
 *
 * Every number is read from the product: the monthly caps and the five toggles
 * in apps/api/src/ai/settings.ts, mirrored in lib/marketing/llms-txt.ts, whose
 * test reads the caps out of the API constants that enforce them.
 */

import { assistantCopy } from "@/i18n/marketing/assistant";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import Link from "next/link";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
import { AssistantVisual } from "@/components/marketing/features/assistant-visual";
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

const PATH = "/features/assistant";

export function AssistantPageBody({ locale = "en" }: { locale?: MarketingLocale }) {
  const copy = assistantCopy(locale);
  const french = locale === "fr-CA";
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.breadcrumbHome, path: french ? "/fr" : "/" },
          { name: copy.breadcrumbSelf, path: french ? "/fr/lou" : PATH },
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
            <AssistantVisual locale={locale} />
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
      </FeatureSection>

      <UseCaseSteps
        ground="white"
        eyebrow={copy.doesEyebrow}
        heading={copy.doesTitle}
        steps={[
          {
            title: copy.doesDraftTitle,
            body: copy.doesDraftBody,
          },
          {
            title: copy.doesVoicemailTitle,
            body: copy.doesVoicemailBody,
          },
          {
            title: copy.doesTaskTitle,
            body: copy.doesTaskBody,
          },
          {
            title: copy.doesIntakeTitle,
            body: copy.doesIntakeBody,
          },
        ]}
      />

      <TruthStripSection
        heading={copy.factsEyebrow}
        items={[
          {
            text: copy.factsNeverSends,
            good: true,
          },
          {
            text: copy.factsDefaults,
          },
          {
            text: copy.factsCaps,
          },
          {
            text: copy.factsModels,
          },
        ]}
      />

      <PricingSnippet>
        <p>
          {copy.pricingBefore} <PlanPrice plan="starter" />/mo on Starter for up
          to 3 people, <PlanPrice plan="pro" />/mo on Pro for up to 15. The
          monthly caps are the reason there is no meter to watch. What Lou reads
          and stores is set out in our{" "}
          <Link
            href="/legal/privacy"
            className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
          >
            {copy.privacyLink}
          </Link>{" "}
          and the{" "}
          <Link
            href="/legal/subprocessors"
            className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
          >
            {copy.subprocessorsLink}
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
            label: copy.relatedPrivacyTitle,
            href: "/legal/privacy",
            hint: copy.relatedPrivacyBody,
          },
          {
            label: copy.relatedSubprocessorsTitle,
            href: "/legal/subprocessors",
            hint: copy.relatedSubprocessorsBody,
          },
        ]}
      />

      <FeatureFaq
        heading={copy.faqTitle}
        faqs={[
          {
            q: copy.faqSendQ,
            a: copy.faqSendA,
          },
          {
            q: copy.faqTrainQ,
            a: copy.faqTrainA,
          },
          {
            q: copy.faqOffQ,
            a: copy.faqOffA,
          },
          {
            q: copy.faqCapQ,
            a: copy.faqCapA,
          },
          {
            q: copy.faqIntakeQ,
            a: copy.faqIntakeA,
          },
          {
            q: copy.faqBusinessQ,
            a: copy.faqBusinessA,
          },
        ]}
      />

      <FeatureCta
        heading={copy.ctaTitle}
        sub={`${copy.ctaSubBefore} ${ACTIVATION_CLAIM}${copy.ctaSubAfter}`}
      />
    </>
  );
}
