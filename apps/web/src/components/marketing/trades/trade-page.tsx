/**
 * TradePage (trades track), the ONE shared trade-page template component
 * (BLUEPRINT §5), rebuilt to the "Caught" marketing identity (DESIGN-DIRECTION,
 * BINDING). Every /for/<trade> page is this component, driven entirely by a
 * typed `TradeContent` object, so the six pages share a skeleton but ZERO
 * sentences (§5 scaled-content guard). All prose, jargon, example threads, use
 * cases, saved replies, and FAQ come from the page's own content object.
 *
 * Identity (DESIGN-DIRECTION §2-§4):
 *  - Each page opens on a duotone hero photo of the trade + a composed <Display>
 *    headline (the page authors the marker/emph/accent word). The scripted
 *    thread demo is the second, live centerpiece just below.
 *  - Structure comes from GROUND changes (the pale petrol-grey --paper panel to
 *    the one deep-petrol band and back) and display-lettering rhythm, NOT from a
 *    counter (§0: no section numbers).
 *  - True mono eyebrows only, no fake "live" dots or "FILED" stamps (§0).
 *  - CTA copy is "Start for $29", kept identical through the flow (§6).
 *
 * Section order: hero (duotone photo + composed headline) -> the scripted thread
 * -> "sound familiar?" pain (real photo) -> how Loonext fits (supporting photo)
 * -> use cases -> saved-replies pack -> features strip -> pricing teaser -> FAQ
 * -> deep-petrol final CTA.
 *
 * Fully static (§11.4): the only client islands are the reused ThreadDemo +
 * Reveal, which hydrate after first paint. Metadata + BreadcrumbList JSON-LD are
 * emitted by the page files (each page owns its own SEO).
 */

import Link from "next/link";
import { ArrowRight, HelpCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Container } from "@/components/marketing/ui/container";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { Display, MarkerCheck } from "@/components/marketing/display";
import { PhotoFrame } from "@/components/marketing/photo-frame";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";
import { ThreadDemo } from "@/components/marketing/thread-demo/thread-demo";
import type { ThreadScript } from "@/components/marketing/thread-demo/script";
import { Button } from "@/components/ui/button";

/* -------------------------------------------------------------------------- */
/* The template API, the ONLY thing the six pages differ by.                  */
/* -------------------------------------------------------------------------- */

export interface TradeUseCase {
  icon: LucideIcon;
  /** Short title, e.g. "Photo triage before you roll a truck." */
  title: string;
  /** One or two sentences, trade-specific. */
  body: string;
}

export interface SavedReply {
  /** Template name, e.g. "On my way". */
  name: string;
  /** The message body, the copy-ready text. */
  text: string;
}

export interface TradeFeature {
  icon: LucideIcon;
  title: string;
  body: string;
}

export interface TradeFaq {
  q: string;
  a: string;
}

export interface TradeContent {
  /** Trade slug ("plumbers"), used for keys/anchors, not shown. */
  slug: string;
  /** Display name for breadcrumbs / prose the page files build, e.g. "Plumbers". */
  displayName: string;

  /** Hero. */
  eyebrow: string;
  /** A composed <Display> headline (page authors the marker/emph/accent). */
  h1: ReactNode;
  heroSub: string;
  /** Truth chips under the CTAs (trade-flavored, factual). */
  heroTruthLine: string;
  /** The duotone hero photo for this trade (manifest id) + honest caption. */
  heroPhotoId: string;
  heroPhotoCaption: string;

  /** "Sound familiar?" pain section. */
  painH2: ReactNode;
  /** Paragraphs of pain copy (rendered as <p>s). */
  painBody: string[];
  /** A trade-relevant real duotone photo for the pain section. */
  painVisual: ReactNode;

  /** How Loonext fits, the live thread demo. */
  threadH2: ReactNode;
  /** One-line framing above the demo. */
  threadLede: string;
  /** The trade-specific scripted thread (reuses the shared ThreadDemo). */
  script: ThreadScript;

  /** A trade-relevant supporting graphic shown beside the "how Loonext fits" copy. */
  supportingGraphic: ReactNode;

  /** Use cases. */
  useCasesH2: ReactNode;
  useCases: TradeUseCase[];

  /** Saved-replies pack (6 real, copy-ready templates, unique data per trade). */
  savedRepliesH2: ReactNode;
  /** One-line intro sentence for the pack. */
  savedRepliesIntro: string;
  savedReplies: SavedReply[];

  /** Features strip mapped to the trade. */
  featuresH2: ReactNode;
  features: TradeFeature[];

  /** Pricing teaser. */
  pricingH2: string;
  pricingBody: string;

  /** FAQ (trade-specific). */
  faqH2: ReactNode;
  faqs: TradeFaq[];

  /** Final CTA. */
  finalH2: ReactNode;
  finalSub: string;

  /**
   * Optional extra section rendered between the thread demo and the use cases,
   * used by /for/contractors for the D14 mark-done illustration.
   */
  afterThread?: ReactNode;
}

/* -------------------------------------------------------------------------- */
/* Shared CTAs + microcopy (structural chrome, not trade copy).               */
/* -------------------------------------------------------------------------- */

const GUARANTEE_MICRO = "$29/mo flat · Month to month · 30-day money-back guarantee";

function CtaRow() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
      <Button asChild size="lg" className="w-full sm:w-auto">
        <Link href="/signup">
          Start for $29
          <ArrowRight strokeWidth={1.75} aria-hidden />
        </Link>
      </Button>
      <ArrowLink href="/pricing">See pricing</ArrowLink>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The template.                                                               */
/* -------------------------------------------------------------------------- */

export function TradePage({ content }: { content: TradeContent }) {
  return (
    <>
      {/* Hero: composed headline over a real duotone photo of the trade. The
          text is the LCP; the photo sits beside it, framed once. No amber wash,
          no fake indicators. */}
      <section className="relative overflow-hidden pb-14 pt-28 sm:pb-20 sm:pt-32">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] lg:gap-16">
            <div>
              <p className="font-mono-mkt flex items-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
                <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
                {content.eyebrow}
              </p>
              <Display as="h1" size="hero" className="mt-5 text-balance">
                {content.h1}
              </Display>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--ink-70)]">
                {content.heroSub}
              </p>
              <div className="mt-8">
                <CtaRow />
              </div>
              <p className="font-mono-mkt mt-6 max-w-xl text-[13px] leading-relaxed text-[color:var(--graphite)]">
                {content.heroTruthLine}
              </p>
            </div>

            <Reveal className="relative">
              <PhotoFrame
                id={content.heroPhotoId}
                priority
                aspect="4 / 3"
                sizes="(min-width: 1024px) 44vw, 92vw"
                caption={{ label: content.heroPhotoCaption }}
              />
            </Reveal>
          </div>
        </Container>
      </section>

      {/* "Sound familiar?": the pain in the trade's own words, beside a real
          duotone photo of the trade (asymmetric split; copy leads). On the
          half-step-lighter panel ground (a ground change). */}
      <Section bleed className="bg-[color:var(--paper-2)] py-16 sm:py-24" defer intrinsic={560}>
        <Container>
          <div className="mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
            <div>
              <Display as="h2" size="h2">
                {content.painH2}
              </Display>
              <div className="mt-6 space-y-5">
                {content.painBody.map((para, i) => (
                  <Reveal key={i} delay={Math.min(i, 3) * 60}>
                    <p className="text-lg leading-relaxed text-[color:var(--ink-70)]">
                      {para}
                    </p>
                  </Reveal>
                ))}
              </div>
            </div>
            <Reveal className="relative">{content.painVisual}</Reveal>
          </div>
        </Container>
      </Section>

      {/* How Loonext fits: the trade's own catch, played out. The scripted
          thread is the live-DOM centerpiece; a supporting duotone photo sits
          beside the framing copy. Back on the paper ground. */}
      <Section defer intrinsic={640}>
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center lg:gap-16">
            <div>
              <Display as="h2" size="h2">
                {content.threadH2}
              </Display>
              <p className="mt-5 text-lg leading-relaxed text-[color:var(--ink-70)]">
                {content.threadLede}
              </p>
              <ArrowLink href="/features/shared-inbox" className="mt-6">
                See how the shared inbox works
              </ArrowLink>
            </div>
            <Reveal className="relative">{content.supportingGraphic}</Reveal>
          </div>

          <Reveal className="relative mx-auto mt-14 max-w-2xl">
            <ThreadDemo
              script={content.script}
              framing="desktop"
              bodyClassName="min-h-[360px]"
            />
          </Reveal>
        </div>
      </Section>

      {/* Optional extra beat (contractors D14 mark-done illustration). */}
      {content.afterThread}

      {/* Use cases: where texting earns its keep in this trade. */}
      <Section defer intrinsic={640}>
        <div className="mx-auto max-w-5xl">
          <Display as="h2" size="h2" className="max-w-3xl">
            {content.useCasesH2}
          </Display>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {content.useCases.map((uc, i) => (
              <Reveal key={uc.title} delay={Math.min(i, 3) * 60}>
                <div className="flex h-full flex-col rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-6">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-[color:var(--petrol-12)] text-[color:var(--petrol)]">
                    <uc.icon className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-[color:var(--ink)]">
                    {uc.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                    {uc.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* Saved-replies pack: 6 copy-ready, trade-specific templates. Ground
          change to the lighter panel. */}
      <Section bleed className="bg-[color:var(--paper-2)] py-16 sm:py-24" defer intrinsic={720}>
        <Container>
          <div className="mx-auto max-w-4xl">
            <Display as="h2" size="h2">
              {content.savedRepliesH2}
            </Display>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[color:var(--ink-70)]">
              {content.savedRepliesIntro}
            </p>
            <ol className="mt-10 space-y-4">
              {content.savedReplies.map((r) => (
                <li
                  key={r.name}
                  className="flex flex-col gap-1.5 rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper)] p-5 sm:flex-row sm:items-start sm:gap-5"
                >
                  <div className="flex shrink-0 items-center gap-2 sm:w-44">
                    <MarkerCheck
                      color="petrol"
                      draw={false}
                      className="size-5 shrink-0"
                    />
                    <span className="text-[14px] font-semibold text-[color:var(--ink)]">
                      {r.name}
                    </span>
                  </div>
                  <p className="text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                    &ldquo;{r.text}&rdquo;
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-[13px] leading-relaxed text-[color:var(--graphite)]">
              These ship as ready-to-edit saved replies you can send in two taps
              , type &ldquo;/&rdquo; in the composer, pick one, send.
            </p>
          </div>
        </Container>
      </Section>

      {/* Features strip: mapped to how this trade works. */}
      <Section defer intrinsic={480}>
        <div className="mx-auto max-w-5xl">
          <Display as="h2" size="h2" className="max-w-3xl">
            {content.featuresH2}
          </Display>
          <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {content.features.map((f) => (
              <div key={f.title} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--petrol-12)] text-[color:var(--petrol)]">
                  <f.icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
                </span>
                <div>
                  <h3 className="text-[16px] font-semibold text-[color:var(--ink)]">
                    {f.title}
                  </h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                    {f.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Pricing teaser: the $29 in the work-order mono, links to full pricing. */}
      <Section bleed className="bg-[color:var(--paper-2)] py-16 sm:py-24" defer intrinsic={420}>
        <Container>
          <div className="mx-auto max-w-3xl rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper)] p-6 sm:p-10">
            <div className="flex items-baseline gap-3">
              <span className="font-mono-mkt text-[56px] font-semibold leading-none tabular-nums text-[color:var(--petrol)]">
                $29
              </span>
              <span className="text-lg text-[color:var(--ink-70)]">
                /mo · the whole crew
              </span>
            </div>
            <h2 className="font-display mt-6 text-[24px] font-bold leading-tight tracking-[-0.005em] text-[color:var(--ink)]">
              {content.pricingH2}
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
              {content.pricingBody}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
              <ArrowLink href="/pricing">See full pricing</ArrowLink>
              <span className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--ink-70)]">
                <MarkerCheck color="petrol" draw={false} className="size-4" />
                Receiving texts and photos is always free
              </span>
            </div>
          </div>
        </Container>
      </Section>

      {/* Trade FAQ: no FAQPage JSON-LD (§11.2). */}
      <Section defer intrinsic={520}>
        <div className="mx-auto max-w-3xl">
          <Display as="h2" size="h2" className="text-center">
            {content.faqH2}
          </Display>
          <div className="mt-12 divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
            {content.faqs.map((item) => (
              <details key={item.q} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-[17px] font-medium text-[color:var(--ink)] [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <HelpCircle
                    className="size-5 shrink-0 text-[color:var(--graphite)] transition-transform duration-200 group-open:rotate-12"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </summary>
                <p className="pb-5 pr-8 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </Section>

      {/* Final CTA band: the ONE deep-petrol ground per page (§3 "used once"). */}
      <Section
        bleed
        className="relative overflow-hidden bg-[color:var(--deep)] py-16 text-[color:var(--paper)] sm:py-24"
        defer
        intrinsic={420}
      >
        <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
          <h2 className="font-display text-balance text-[30px] font-bold leading-[1.08] tracking-[-0.005em] text-[color:var(--paper)] sm:text-[44px]">
            {content.finalH2}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-[color:var(--paper)]/85">
            {content.finalSub}
          </p>
          <div className="mt-8 flex justify-center">
            <Button
              asChild
              size="lg"
              className="bg-[color:var(--paper)] text-[color:var(--deep)] hover:bg-white"
            >
              <Link href="/signup">
                Start for $29
                <ArrowRight strokeWidth={1.75} aria-hidden />
              </Link>
            </Button>
          </div>
          <p className="font-mono-mkt mt-4 text-[13px] text-[color:var(--paper)]/70">
            {GUARANTEE_MICRO}
          </p>
        </div>
      </Section>
    </>
  );
}
