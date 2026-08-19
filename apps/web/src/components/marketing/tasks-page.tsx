/**
 * /features/tasks, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * WHY THIS PAGE EXISTS (#491). Tasks have shipped as a whole app tab — list,
 * board, calendar and map, per docs/TASKS-V2.md — and the marketing site not
 * only omitted them, /for/contractors actively told buyers there was "no
 * separate screen, no board, no counts to maintain". This is the positive
 * half of that correction.
 *
 * THE LINE THIS PAGE HOLDS is the one in the FAQ: a job that came out of a
 * conversation, not a construction suite. Every absence named here (Gantt,
 * dependencies, dispatch, time tracking, invoicing) is a real absence, and
 * naming them is what makes the presences believable.
 *
 * D64: a task promotes a SOURCE, and the source is a message OR a call. That
 * is the sentence the whole page is built around — it is what makes this
 * different from a to-do app somebody also has open.
 */

import { tasksCopy } from "@/i18n/marketing/tasks";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import Link from "next/link";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
import { TaskBoardVisual } from "@/components/marketing/features/task-board-visual";
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
import { activationClaim } from "@/lib/marketing/activation";

const PATH = "/features/tasks";

export function TasksPageBody({ locale = "en" }: { locale?: MarketingLocale }) {
  const copy = tasksCopy(locale);
  const french = locale === "fr-CA";
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.breadcrumbHome, path: french ? "/fr" : "/" },
          { name: copy.breadcrumbSelf, path: french ? "/fr/taches" : PATH },
        ])}
      />

      <FeatureHero
        dateline={copy.dateline}
        title={copy.h1}
        sub={copy.heroSub}
        panel={
          <PanelFrame
            caption={copy.boardCaption}
            ariaLabel={copy.boardAria}
          >
            <TaskBoardVisual locale={locale} />
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
        eyebrow={copy.viewsEyebrow}
        heading={copy.viewsTitle}
        steps={[
          {
            title: copy.viewListTitle,
            body: copy.viewListBody,
          },
          {
            title: copy.viewCalendarTitle,
            body: copy.viewCalendarBody,
          },
          {
            title: "Map",
            body: copy.viewMapBody,
          },
          {
            title: copy.viewThreadTitle,
            body: copy.viewThreadBody,
          },
        ]}
      />

      <TruthStripSection
        heading={copy.factsEyebrow}
        items={[
          {
            text: copy.factsOne,
            good: true,
          },
          {
            text: copy.factsTwo,
          },
          {
            text: copy.factsThree,
          },
          {
            text: copy.factsFour,
          },
        ]}
      />

      <PricingSnippet>
        <p>
          {copy.pricingBefore}{" "}
          <PlanPrice plan="starter" />
          {copy.pricingStarterAfter}{" "}
          <PlanPrice plan="pro" />
          {copy.pricingProAfter}{" "}
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
            label: copy.relatedAssistantTitle,
            href: "/features/assistant",
            hint: copy.relatedAssistantBody,
          },
          {
            label: copy.relatedContractorsTitle,
            href: "/for/contractors",
            hint: copy.relatedContractorsBody,
          },
        ]}
      />

      <FeatureFaq
        heading={copy.faqTitle}
        faqs={[
          {
            q: copy.faqReplacementQ,
            a: copy.faqReplacementA,
          },
          {
            q: copy.faqDoneQ,
            a: copy.faqDoneA,
          },
          {
            q: copy.faqAssignQ,
            a: copy.faqAssignA,
          },
          {
            q: copy.faqLeaverQ,
            a: copy.faqLeaverA,
          },
          {
            q: copy.faqPhoneQ,
            a: copy.faqPhoneA,
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
