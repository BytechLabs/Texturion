/**
 * /features/shared-inbox, the flagship feature page, on the v4 "FIRST
 * RESPONSE" FEATURE template (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * Dateline `1 OWNER PER CONVERSATION` → H1 "Every customer text, in one
 * inbox the whole crew can see." → the real inbox staged mid-task (assign
 * menu open) in a Panel Frame → use cases (morning triage, one owner per
 * thread, search as memory) → Truth Strip (receiving texts is free and
 * unlimited; photos are free to receive and storage is free) → pricing
 * snippet → unique FAQ → Frost CTA band.
 *
 * Every number is a verified product/billing fact. buildMetadata +
 * BreadcrumbList JSON-LD; no FAQPage.
 */

import type { MarketingLocale } from "@/i18n/marketing/footer";
import { sharedInboxCopy } from "@/i18n/marketing/shared-inbox";
import Link from "next/link";

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
  PricingSnippet,
  RelatedLinks,
  TruthStripSection,
  UseCaseSteps,
} from "@/components/marketing/features/feature-page";
import { InboxListVisual } from "@/components/marketing/features/inbox-list-visual";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";
import { ACTIVATION_CLAIM } from "@/lib/marketing/activation";

const PATH = "/features/shared-inbox";

export function SharedInboxPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = sharedInboxCopy(locale);
  const french = locale === "fr-CA";
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.breadcrumbHome, path: french ? "/fr" : "/" },
          { name: copy.breadcrumbSelf, path: french ? "/fr/boite-partagee" : PATH },
        ])}
      />

      <FeatureHero
        dateline="1 OWNER PER CONVERSATION"
        title={copy.h1}
        sub={copy.heroSub}
        panel={
          <PanelFrame
            caption={copy.inboxCaption}
            ariaLabel={copy.inboxAria}
          >
            <InboxListVisual locale={locale} />
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

      {/* Signal White here, not the default Frost: "The core idea" band above
          is Frost, and bands alternate (Law 10; the ground change IS the
          separator). White also keeps the eyebrow's Frost chip legible. */}
      <UseCaseSteps
        ground="white"
        eyebrow={copy.useEyebrow}
        heading={copy.useTitle}
        steps={[
          {
            title: copy.useTriageTitle,
            body: copy.useTriageBody,
          },
          {
            title: copy.useOwnerTitle,
            body: copy.useOwnerBody,
          },
          {
            title: copy.useSearchTitle,
            body: copy.useSearchBody,
          },
        ]}
      />

      <FeatureSection
        eyebrow={copy.useNotesTitle}
        heading={copy.useNotesBody}
      >
        <p>
          {copy.notesBody}
        </p>
        <p>
          {copy.coreBodyThree}
        </p>
      </FeatureSection>

      <TruthStripSection
        heading={copy.factsEyebrow}
        items={[
          {
            text: copy.factsReceiving,
            good: true,
          },
          {
            text: copy.factsSeats,
          },
          {
            text: copy.factsCalling,
          },
        ]}
      />

      <PricingSnippet>
        <p>
          {copy.pricingBefore} <PlanPrice plan="starter" />/mo on Starter for up to 3
          people and one local number, <PlanPrice plan="pro" />/mo on Pro for up
          to 15 people and two numbers. Texting is
          included on a fair-use basis rather than a hard cap, sized so almost
          every crew stays comfortably inside it, and receiving texts is
          always free and unlimited. The concrete numbers live in our{" "}
          <Link
            href="/legal/fair-use"
            className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
          >
            {copy.fairUseLink}
          </Link>
          .
        </p>
        <CountryOnly country="us">
          <p>
            {copy.pricingUsFee} <RegistrationFee /> to register with
            the phone companies, charged once, ever, so the first month is{" "}
            <FirstMonthTotal plan="starter" /> and every month after is{" "}
            <PlanPrice plan="starter" />.
          </p>
        </CountryOnly>
        <CountryOnly country="ca">
          <p>
            Texting Canadian customers has no registration and no setup fee, so{" "}
            <PlanPrice plan="starter" /> is <PlanPrice plan="starter" /> {copy.pricingUsFeeAfter}
          </p>
        </CountryOnly>
      </PricingSnippet>

      <RelatedLinks
        heading={copy.relatedEyebrow}
        intro={copy.relatedTitle}
        links={[
          {
            label: copy.relatedPlumbersTitle,
            href: "/for/plumbers",
            hint: copy.relatedPlumbersBody,
          },
          {
            label: copy.relatedHvacTitle,
            href: "/for/hvac",
            hint: copy.relatedHvacBody,
          },
          {
            label: copy.relatedTemplatesTitle,
            href: "/features/templates-and-tags",
            hint: copy.relatedTemplatesBody,
          },
          {
            label: copy.relatedCompareTitle,
            href: "/compare/heymarket",
            hint: copy.relatedCompareBody,
          },
        ]}
      />

      <FeatureFaq
        heading={copy.faqTitle}
        faqs={[
          {
            q: copy.faqSeatsQ,
            a: copy.faqSeatsA,
          },
          {
            q: copy.faqDoubleQ,
            a: copy.faqDoubleA,
          },
          {
            q: copy.faqCustomerQ,
            a: copy.faqCustomerA,
          },
          {
            q: copy.faqLeaverQ,
            a: copy.faqLeaverA,
          },
          {
            q: copy.faqLiveQ,
            a: copy.faqLiveA,
          },
          {
            q: copy.faqSearchQ,
            a: copy.faqSearchA,
          },
        ]}
      />

      <FeatureCta
        heading={copy.ctaTitle}
        sub={`A local business number and a shared text inbox the whole team can see, ${ACTIVATION_CLAIM}. See the price.`}
      />
    </>
  );
}
