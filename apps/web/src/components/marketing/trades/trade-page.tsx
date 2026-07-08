/**
 * TradePage (trades crew), the ONE shared trade-page template on the v4
 * "FIRST RESPONSE" identity (DESIGN-DIRECTION v4, BINDING; COPY-DECK v2).
 * Every /for/<trade> page is this component driven by a typed `TradeContent`
 * object: the six pages share a skeleton and ZERO sentences. All prose,
 * jargon, the scripted thread, saved replies, and FAQ come from the page's
 * own content object, each staging that trade's own worst minute.
 *
 * Template order (DESIGN-DIRECTION v4 §6 TRADE):
 *   Dateline Header (the trade's after-hours moment, matching the thread)
 *   → pain → the static EXAMPLE CONVERSATION thread in a PanelFrame
 *   → use cases (work cards) → saved-replies pack in the template picker
 *   → features strip → pricing snippet (+ Truth Strips) → trade FAQ
 *   → final CTA (Frost band; the cobalt band is home-only).
 *
 * System notes:
 *  - Assembled ONLY from the fr kit (FrSection/FrCard/Dateline/CtaButton/
 *    PanelFrame/MonoFigure/ConvergedField); nothing bespoke off-kit.
 *  - The ConvergedField "mark" is the sole decorative header motif on
 *    subpages (coverage map); aria-hidden, no second canvas anywhere.
 *  - Law 2: the thread and the picker render with app tokens inside
 *    PanelFrame's `.app-scope`; marketing cobalt stays outside the frames.
 *  - Law 6: no em-dashes anywhere, including aria-labels and captions.
 *  - Law 10: no hairline rules; separation is space, radius, Frost.
 *  - Fully static: zero client islands, zero tab stops added by the demos.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import {
  ConvergedField,
  CtaButton,
  Dateline,
  FrCard,
  FrSection,
  MonoFigure,
  PanelFrame,
} from "@/components/marketing/fr";
import {
  PRIMARY_CTA_LABEL,
  SECONDARY_CTA_LABEL,
  SIGNUP_HREF,
} from "@/components/marketing/nav-links";
import { Check } from "lucide-react";

import type { SavedReply } from "./saved-replies-picker";
import { SavedRepliesPicker } from "./saved-replies-picker";
import type { TradeScript } from "./scripts";
import { TradeThread } from "./trade-thread";

/* -------------------------------------------------------------------------- */
/* The template API, the ONLY thing the six pages differ by.                   */
/* -------------------------------------------------------------------------- */

export interface TradeUseCase {
  /** Short title, e.g. "Photo triage before you roll a truck." */
  title: string;
  /** One to three sentences, trade-specific. */
  body: string;
}

export interface TradeFeature {
  title: string;
  body: string;
}

export interface TradeFaq {
  q: string;
  a: string;
}

/** One §5.4 Truth Strip line: mono fact, green tick when the news is good. */
export interface TradeTruthLine {
  text: ReactNode;
  /** Adds the Answered-Green tick (green whitelist: good news only). */
  good?: boolean;
}

export interface TradeContent {
  /** Trade slug ("plumbers"), used for keys/anchors, not shown. */
  slug: string;
  /** Display name for breadcrumbs the page files build, e.g. "Plumbers". */
  displayName: string;

  /** The dateline chip: the trade's worst minute (coverage map, exact). */
  dateline: string;
  /** COPY-DECK v2 H1 for this trade. */
  h1: string;
  heroSub: string;
  /** Mono truth line under the CTA row (trade-flavored, factual). */
  heroTruth: string;

  painH2: string;
  painBody: string[];

  threadH2: string;
  threadLede: string;
  script: TradeScript;
  /** Content-describing accessible name for the thread PanelFrame. */
  threadAriaLabel: string;

  useCasesH2: string;
  useCases: TradeUseCase[];

  savedRepliesH2: string;
  savedRepliesIntro: string;
  savedReplies: SavedReply[];
  /** Content-describing caption under the picker frame. */
  savedRepliesCaption: string;

  featuresH2: string;
  features: TradeFeature[];

  pricingH2: string;
  pricingBody: string;
  /**
   * Extra Truth Strip lines under the pricing card (§5.4). The two standard
   * lines (receiving free; the US $58-first-month registration fact) render
   * on every trade page; these are trade-specific additions (for example
   * the contractors "texting, not project management" line).
   */
  truthLines?: TradeTruthLine[];

  faqH2: string;
  faqs: TradeFaq[];

  finalH2: string;
  finalSub: string;
}

/* -------------------------------------------------------------------------- */
/* Shared microcopy (structural chrome, not trade copy).                       */
/* -------------------------------------------------------------------------- */

/**
 * The trade-thread caption (COPY-DECK v2 §/for/plumbers, master): describes
 * the CONTENT (what tapping a message does in the product), never the
 * artifact.
 */
export const THREAD_CAPTION =
  "Tap any message to mark it done. The whole crew sees what's handled.";

const FINAL_MICROCOPY = "$29/mo flat · Month to month · 30-day money-back";

/* -------------------------------------------------------------------------- */
/* §5.4 TRUTH STRIP: Frost ground, 3px cobalt left edge, mono text, green      */
/* tick where the news is good. The one learnable shape for candor.            */
/* -------------------------------------------------------------------------- */

function TruthStrip({ line }: { line: TradeTruthLine }) {
  return (
    <div className="flex items-start gap-2.5 rounded-r-[6px] border-l-[3px] border-[color:var(--fr-cobalt)] bg-[color:var(--fr-frost)] px-4 py-3">
      {line.good ? (
        <Check
          className="mt-px size-4 shrink-0 text-[color:var(--fr-green)]"
          strokeWidth={2.5}
          aria-hidden
        />
      ) : null}
      <p className="fr-mono-data text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink)]">
        {line.text}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The template.                                                               */
/* -------------------------------------------------------------------------- */

export function TradePage({ content }: { content: TradeContent }) {
  return (
    <>
      {/* DATELINE HEADER (§5.1): the converged-arrival mark (the subpage's
          only decorative motif), the worst-minute chip, H1, sub, CTA row,
          mono truth line. */}
      <FrSection ground="white" className="pb-12 md:pb-16">
        <ConvergedField variant="mark" className="h-9 w-auto md:h-10" />
        <div className="mt-10 max-w-3xl">
          <Dateline>{content.dateline}</Dateline>
          <h1 className="fr-h1 mt-6 text-[color:var(--fr-ink)]">
            {content.h1}
          </h1>
          <p className="fr-body mt-6 max-w-2xl text-[color:var(--fr-ink-70)]">
            {content.heroSub}
          </p>
          <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
            <CtaButton href={SIGNUP_HREF}>{PRIMARY_CTA_LABEL}</CtaButton>
            <CtaButton href="/pricing" variant="secondary">
              {SECONDARY_CTA_LABEL}
            </CtaButton>
          </div>
          <p className="fr-mono-data mt-7 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
            {content.heroTruth}
          </p>
        </div>
      </FrSection>

      {/* THE PAIN: the trade's own failure mode, in its own words. */}
      <FrSection ground="frost">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">{content.painH2}</h2>
          <div className="space-y-5 lg:pt-2">
            {content.painBody.map((para) => (
              <p
                key={para.slice(0, 32)}
                className="fr-body text-[color:var(--fr-ink-70)]"
              >
                {para}
              </p>
            ))}
          </div>
        </div>
      </FrSection>

      {/* THE EXAMPLE CONVERSATION: the worst minute, played out in the
          product. Real thread patterns with app tokens inside the frame;
          the only label is the EXAMPLE CONVERSATION chip (Law 1). */}
      <FrSection ground="white">
        <div className="max-w-2xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            {content.threadH2}
          </h2>
          <p className="fr-body mt-5 text-[color:var(--fr-ink-70)]">
            {content.threadLede}
          </p>
        </div>
        <PanelFrame
          chromeUrl="loonext.com/inbox"
          chip="example-conversation"
          caption={THREAD_CAPTION}
          ariaLabel={content.threadAriaLabel}
          className="mx-auto mt-12 w-full max-w-[36rem]"
        >
          <TradeThread script={content.script} />
        </PanelFrame>
      </FrSection>

      {/* USE CASES: §5.5 work cards, outcomes in the buyer's words. */}
      <FrSection ground="frost">
        <h2 className="fr-h2 max-w-3xl text-[color:var(--fr-ink)]">
          {content.useCasesH2}
        </h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {content.useCases.map((uc, i) => (
            <FrCard key={uc.title} className="p-6 sm:p-7">
              <span
                className="fr-mono-data flex size-8 items-center justify-center rounded-full bg-[color:var(--fr-cobalt)] text-white"
                aria-hidden
              >
                {i + 1}
              </span>
              <h3 className="fr-h3 mt-5 text-[color:var(--fr-ink)]">
                {uc.title}
              </h3>
              <p className="font-body-mkt mt-2.5 text-base leading-relaxed text-[color:var(--fr-ink-70)]">
                {uc.body}
              </p>
            </FrCard>
          ))}
        </div>
      </FrSection>

      {/* SAVED-REPLIES PACK: the trade's pack staged in the product's
          template picker (app tokens inside the frame). */}
      <FrSection ground="white">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16">
          <div>
            <h2 className="fr-h2 text-[color:var(--fr-ink)]">
              {content.savedRepliesH2}
            </h2>
            <p className="fr-body mt-5 text-[color:var(--fr-ink-70)]">
              {content.savedRepliesIntro}
            </p>
            <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
              Type <span className="fr-mono-data">/</span> in the composer,
              tap one, send. Every template is editable before it goes out,
              and <span className="fr-mono-data">{"{first_name}"}</span> fills
              in the customer&apos;s name by itself.
            </p>
          </div>
          <PanelFrame
            caption={content.savedRepliesCaption}
            ariaLabel={content.savedRepliesCaption}
            className="w-full"
          >
            <SavedRepliesPicker replies={content.savedReplies} />
          </PanelFrame>
        </div>
      </FrSection>

      {/* FEATURES STRIP: mapped to how this trade works. Typographic. */}
      <FrSection ground="frost">
        <h2 className="fr-h2 max-w-3xl text-[color:var(--fr-ink)]">
          {content.featuresH2}
        </h2>
        <div className="mt-12 grid gap-x-14 gap-y-10 sm:grid-cols-2">
          {content.features.map((f) => (
            <div key={f.title}>
              <h3 className="font-body-mkt text-[1.0625rem] font-bold leading-snug text-[color:var(--fr-ink)]">
                {f.title}
              </h3>
              <p className="font-body-mkt mt-2 text-base leading-relaxed text-[color:var(--fr-ink-70)]">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </FrSection>

      {/* PRICING SNIPPET: the price as art (mono law), then Truth Strips. */}
      <FrSection ground="white">
        <FrCard className="mx-auto max-w-3xl p-7 sm:p-12">
          <MonoFigure
            value="$29"
            suffix="/mo · the whole crew"
            size="display"
          />
          <h2 className="fr-h3 mt-7 text-[color:var(--fr-ink)]">
            {content.pricingH2}
          </h2>
          <p className="font-body-mkt mt-3 text-base leading-relaxed text-[color:var(--fr-ink-70)]">
            {content.pricingBody}
          </p>
          <div className="mt-6 space-y-2.5">
            <TruthStrip
              line={{
                text: "Receiving texts and photos: free, unlimited, on every plan.",
                good: true,
              }}
            />
            <TruthStrip
              line={{
                text: "US shops: a one-time $29 to register with the phone companies. $58 the first month, then $29 after.",
              }}
            />
            {(content.truthLines ?? []).map((line, i) => (
              <TruthStrip key={i} line={line} />
            ))}
          </div>
          <Link
            href="/pricing"
            className="font-body-mkt mt-6 inline-block font-semibold text-[color:var(--fr-cobalt)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
          >
            See full pricing. Every cost is on that page.
          </Link>
        </FrCard>
      </FrSection>

      {/* TRADE FAQ: native details, Frost wells, no hairlines. */}
      <FrSection ground="white" className="pt-0 md:pt-0">
        <h2 className="fr-h2 mx-auto max-w-3xl text-center text-[color:var(--fr-ink)]">
          {content.faqH2}
        </h2>
        <div className="mx-auto mt-12 max-w-3xl space-y-3">
          {content.faqs.map((item) => (
            <details
              key={item.q}
              className="group rounded-xl bg-[color:var(--fr-frost)] px-6 py-5"
            >
              <summary className="font-body-mkt flex cursor-pointer list-none items-center justify-between gap-4 text-left text-[1.0625rem] font-semibold text-[color:var(--fr-ink)] [&::-webkit-details-marker]:hidden">
                {item.q}
                <span
                  className="shrink-0 text-[color:var(--fr-ink-55)] transition-transform duration-200 ease-out group-open:rotate-45 motion-reduce:transition-none"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </FrSection>

      {/* FINAL CTA: Frost band (the cobalt band is home-only). One promise,
          one button, mono microcopy, nothing new. */}
      <FrSection ground="frost">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">{content.finalH2}</h2>
          <p className="fr-body mx-auto mt-5 max-w-xl text-[color:var(--fr-ink-70)]">
            {content.finalSub}
          </p>
          <div className="mt-9 flex justify-center">
            <CtaButton href={SIGNUP_HREF} size="lg">
              {PRIMARY_CTA_LABEL}
            </CtaButton>
          </div>
          <p className="fr-eyebrow mt-7 text-[color:var(--fr-ink-55)]">
            {FINAL_MICROCOPY}
          </p>
        </div>
      </FrSection>
    </>
  );
}
