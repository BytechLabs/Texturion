/**
 * /features/templates-and-tags, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * Dateline `TYPE / · TAP · SENT` → H1 "Stop retyping the same five texts."
 * → the real template picker (variables + preview) in a Panel Frame → tags
 * with the real tag pills + the mark-done behavior → use cases → Truth
 * Strip: templates are per-business, editable, and never auto-send →
 * pricing snippet → unique FAQ → Frost CTA band.
 *
 * The done-mark is described accurately as a per-MESSAGE check, never a job
 * or a task manager. Every number is a verified product/billing fact.
 */

import { templatesCopy } from "@/i18n/marketing/templates";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { CountryOnly } from "@/components/marketing/country";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
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
import { SavedRepliesVisual } from "@/components/marketing/features/saved-replies-visual";
import { TagsDoneVisual } from "@/components/marketing/features/tags-done-visual";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";
import { activationClaimShort } from "@/lib/marketing/activation";

const PATH = "/features/templates-and-tags";

export function TemplatesPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = templatesCopy(locale);
  const french = locale === "fr-CA";
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.breadcrumbHome, path: french ? "/fr" : "/" },
          { name: copy.breadcrumbSelf, path: french ? "/fr/modeles-etiquettes" : PATH },
        ])}
      />

      <FeatureHero
        dateline={copy.dateline}
        title={copy.h1}
        sub={copy.heroSub}
        panel={
          <PanelFrame
            caption={copy.repliesCaption}
            ariaLabel={copy.repliesAria}
          >
            <SavedRepliesVisual locale={locale} />
          </PanelFrame>
        }
      />

      <FeatureSection
        ground="frost"
        eyebrow={copy.repliesEyebrow}
        heading={copy.repliesTitle}
      >
        <p>
          {copy.repliesBodyOne}
        </p>
        <p>
          {copy.repliesBodyTwo}
        </p>
      </FeatureSection>

      <FeatureSection
        eyebrow={copy.tagsEyebrow}
        heading={copy.tagsTitle}
        visual={
          <PanelFrame
            caption={copy.tagsCaption}
            ariaLabel={copy.tagsAria}
          >
            <TagsDoneVisual locale={locale} />
          </PanelFrame>
        }
        flip
      >
        <p>
          {copy.tagsBodyOne}
        </p>
        <p>
          {copy.tagsBodyTwo}
        </p>
      </FeatureSection>

      <UseCaseSteps
        eyebrow={copy.useEyebrow}
        heading={copy.useTitle}
        steps={[
          {
            title: copy.useOnMyWayTitle,
            body: copy.useOnMyWayBody,
          },
          {
            title: copy.useQuotesTitle,
            body: copy.useQuotesBody,
          },
          {
            title: copy.useThreadTitle,
            body: copy.useThreadBody,
          },
        ]}
      />

      <FeatureSection
        eyebrow={copy.importEyebrow}
        heading={copy.importTitle}
      >
        <p>
          {copy.importBodyOne}
        </p>
        <p>
          {copy.importBodyTwo}
        </p>
      </FeatureSection>

      <TruthStripSection
        heading={copy.factsEyebrow}
        items={[
          {
            text: copy.factsEditable,
            good: true,
          },
          {
            text: copy.factsNeverAuto,
          },
          {
            text: copy.factsDoneMark,
          },
        ]}
      />

      <PlainDetails
        heading={copy.edgesEyebrow}
        lead={copy.edgesTitle}
        items={[
          {
            term: copy.edgesShortcutTitle,
            detail:
              copy.edgesShortcutBody,
          },
          {
            term: copy.edgesDoneTitle,
            detail:
              copy.edgesDoneBody,
          },
          {
            term: copy.edgesImportTitle,
            detail:
              copy.edgesImportBody,
          },
        ]}
      />

      <PricingSnippet>
        <p>
          {copy.pricingBefore} <PlanPrice plan="starter" />
          {copy.pricingStarterAfter} <PlanPrice plan="pro" />
          {copy.pricingProAfter}
        </p>
        <CountryOnly country="us">
          <p>
            {copy.pricingUsBefore} <RegistrationFee /> {copy.pricingUsMiddle}{" "}
            <FirstMonthTotal plan="starter" /> {copy.pricingUsAnd}{" "}
            <PlanPrice plan="starter" />.
          </p>
        </CountryOnly>
        <CountryOnly country="ca">
          <p>
            {copy.pricingCaBefore}{" "}
            <PlanPrice plan="starter" /> {copy.pricingUsIs} <PlanPrice plan="starter" /> {copy.pricingUsAfter}
          </p>
        </CountryOnly>
      </PricingSnippet>

      <RelatedLinks
        heading={copy.relatedEyebrow}
        intro={copy.relatedTitle}
        links={[
          {
            label: copy.relatedCleanersTitle,
            href: "/for/cleaners",
            hint: copy.relatedCleanersBody,
          },
          {
            label: copy.relatedPlumbersTitle,
            href: "/for/plumbers",
            hint: copy.relatedPlumbersBody,
          },
          {
            label: copy.relatedInboxTitle,
            href: "/features/shared-inbox",
            hint: copy.relatedInboxBody,
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
            q: copy.faqUseQ,
            a: copy.faqUseA,
          },
          {
            q: copy.faqNameQ,
            a: copy.faqNameA,
          },
          {
            q: copy.faqTagsQ,
            a: copy.faqTagsA,
          },
          {
            q: copy.faqAutoQ,
            a: copy.faqAutoA,
          },
          {
            q: copy.faqDoneQ,
            a: copy.faqDoneA,
          },
          {
            q: copy.faqImportQ,
            a: copy.faqImportA,
          },
        ]}
      />

      <FeatureCta
        heading={copy.ctaTitle}
        sub={`${copy.ctaSubBefore} ${activationClaimShort(locale)}${copy.ctaSubAfter}`}
      />
    </>
  );
}
