/**
 * TradePage (trades track) — the ONE shared trade-page template component
 * (BLUEPRINT §5). Every /for/<trade> page is this component, driven entirely by
 * a typed `TradeContent` object, so the six pages share a skeleton but ZERO
 * sentences (§5 scaled-content guard: "shared skeleton fine; shared sentences
 * not"). All prose, jargon, example threads, use cases, saved replies, and FAQ
 * come from the page's own content object — nothing is hard-coded here.
 *
 * Section order mirrors the COPY §P plumbers master (the validated §5 template):
 *   hero → "sound familiar?" pain → how JobText fits (live thread demo) →
 *   use cases → saved-replies pack → features strip → pricing teaser → FAQ →
 *   final CTA.
 *
 * Reuses the shared building blocks (Container, Section, Reveal, GlowBackdrop,
 * ThreadDemo, Button) — one motion grammar, one source of truth. Fully static
 * (§11.4): the only client islands are the reused ThreadDemo + Reveal, which
 * hydrate after first paint. Metadata + BreadcrumbList JSON-LD are emitted by
 * the page files, not here (each page owns its own SEO per the track contract).
 */

import Link from "next/link";
import { ArrowRight, Check, HelpCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Container } from "@/components/marketing/ui/container";
import { GlowBackdrop } from "@/components/marketing/ui/glow-backdrop";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { ThreadDemo } from "@/components/marketing/thread-demo/thread-demo";
import type { ThreadScript } from "@/components/marketing/thread-demo/script";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* The template API — the ONLY thing the six pages differ by.                  */
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
  /** The message body — the copy-ready text. */
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
  /** Trade slug ("plumbers") — used for keys/anchors, not shown. */
  slug: string;
  /** Display name for breadcrumbs / prose the page files build, e.g. "Plumbers". */
  displayName: string;

  /** Hero. */
  eyebrow: string;
  h1: string;
  heroSub: string;
  /** Truth line under the CTAs (trade-flavored, factual). */
  heroTruthLine: string;

  /** "Sound familiar?" pain section. */
  painH2: string;
  /** Paragraphs of pain copy (rendered as <p>s). */
  painBody: string[];

  /** How JobText fits — the live thread demo. */
  threadH2: string;
  /** One-line framing above the demo. */
  threadLede: string;
  /** The trade-specific scripted thread (reuses the shared ThreadDemo). */
  script: ThreadScript;

  /**
   * A trade-relevant supporting graphic (a spot illustration or infographic)
   * shown beside the "how JobText fits" copy — so each trade page carries the
   * unique thread demo (hero) PLUS at least one supporting visual (VISUALS §3
   * trade-page rule), instead of rendering the same thread twice. Every trade
   * page supplies one; the caller wraps its own art with a caption if wanted.
   */
  supportingGraphic: React.ReactNode;

  /** Use cases. */
  useCasesH2: string;
  useCases: TradeUseCase[];

  /** Saved-replies pack (6 real, copy-ready templates — unique data per trade). */
  savedRepliesH2: string;
  /** One-line intro sentence for the pack. */
  savedRepliesIntro: string;
  savedReplies: SavedReply[];

  /** Features strip mapped to the trade. */
  featuresH2: string;
  features: TradeFeature[];

  /** Pricing teaser. */
  pricingH2: string;
  pricingBody: string;

  /** FAQ (trade-specific). */
  faqH2: string;
  faqs: TradeFaq[];

  /** Final CTA. */
  finalH2: string;
  finalSub: string;

  /**
   * Optional extra section rendered between the thread demo and the use cases —
   * used by /for/contractors for the D14 mark-done illustration. Keeps the
   * template general without special-casing a trade inside it.
   */
  afterThread?: React.ReactNode;
}

/* -------------------------------------------------------------------------- */
/* Shared CTAs + microcopy (structural chrome, not trade copy — a button label */
/* and a guarantee line are the same product fact on every page; the §5 guard  */
/* is about marketing PROSE, and none is shared).                              */
/* -------------------------------------------------------------------------- */

const PRIMARY_CTA = "Start for $29";
const GUARANTEE_MICRO = "$29/mo flat · Month to month · 30-day money-back guarantee";

function CtaRow() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Button asChild size="lg">
        <Link href="/signup">
          {PRIMARY_CTA}
          <ArrowRight strokeWidth={1.75} aria-hidden />
        </Link>
      </Button>
      <Button asChild size="lg" variant="outline">
        <Link href="/pricing">See pricing</Link>
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The template.                                                               */
/* -------------------------------------------------------------------------- */

export function TradePage({ content }: { content: TradeContent }) {
  return (
    <>
      {/* Hero — the ONE petrol/amber atmosphere behind the LCP box. */}
      <section className="relative overflow-hidden pb-16 pt-28 sm:pb-24 sm:pt-32">
        <GlowBackdrop />
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
            <div>
              <p className="text-[13px] font-semibold text-primary">
                {content.eyebrow}
              </p>
              <h1 className="display-hero mt-4 text-balance text-foreground">
                {content.h1}
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                {content.heroSub}
              </p>
              <div className="mt-8">
                <CtaRow />
              </div>
              <p className="mt-6 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                {content.heroTruthLine}
              </p>
            </div>

            {/* The live-DOM centerpiece — the trade's own scripted thread. */}
            <div className="relative">
              <ThreadDemo
                script={content.script}
                framing="desktop"
                bodyClassName="min-h-[360px]"
              />
            </div>
          </div>
        </Container>
      </section>

      {/* "Sound familiar?" — the pain in the trade's own words. */}
      <Section>
        <div className="mx-auto max-w-3xl">
          <h2 className="display-h2 text-foreground">{content.painH2}</h2>
          <div className="mt-6 space-y-5">
            {content.painBody.map((para, i) => (
              <Reveal key={i} delay={Math.min(i, 3) * 60}>
                <p className="text-lg leading-relaxed text-muted-foreground">
                  {para}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* How JobText fits — a trade-relevant supporting graphic beside the copy.
          The unique scripted thread is the hero centerpiece (§0.1); this beat
          carries the page's second, distinct visual (VISUALS §3). Light wash. */}
      <Section
        bleed
        className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
      >
        <Container>
          <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16">
            <div>
              <h2 className="display-h2 text-foreground">{content.threadH2}</h2>
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
                {content.threadLede}
              </p>
              <Link
                href="/features/shared-inbox"
                className="mt-6 inline-flex items-center gap-1 text-[14px] font-medium text-primary underline-offset-4 hover:underline"
              >
                See how the shared inbox works
                <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
              </Link>
            </div>
            <Reveal className="relative">{content.supportingGraphic}</Reveal>
          </div>
        </Container>
      </Section>

      {/* Optional extra beat (contractors D14 mark-done illustration). */}
      {content.afterThread}

      {/* Use cases — where texting earns its keep in this trade. */}
      <Section>
        <div className="mx-auto max-w-5xl">
          <h2 className="display-h2 max-w-3xl text-foreground">
            {content.useCasesH2}
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {content.useCases.map((uc, i) => (
              <Reveal key={uc.title} delay={Math.min(i, 3) * 60}>
                <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <uc.icon className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-foreground">
                    {uc.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                    {uc.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* Saved-replies pack — 6 copy-ready, trade-specific templates. */}
      <Section
        bleed
        className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
      >
        <Container>
          <div className="mx-auto max-w-4xl">
            <h2 className="display-h2 text-foreground">
              {content.savedRepliesH2}
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              {content.savedRepliesIntro}
            </p>
            <ol className="mt-10 space-y-4">
              {content.savedReplies.map((r, i) => (
                <li
                  key={r.name}
                  className="flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-start sm:gap-5"
                >
                  <div className="flex shrink-0 items-center gap-2 sm:w-44">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-semibold tabular-nums text-primary">
                      {i + 1}
                    </span>
                    <span className="text-[14px] font-semibold text-foreground">
                      {r.name}
                    </span>
                  </div>
                  <p className="text-[15px] leading-relaxed text-muted-foreground">
                    &ldquo;{r.text}&rdquo;
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-[13px] leading-relaxed text-muted-foreground">
              These ship as ready-to-edit saved replies you can send in two taps
              — type &ldquo;/&rdquo; in the composer, pick one, send.
            </p>
          </div>
        </Container>
      </Section>

      {/* Features strip — mapped to how this trade works. */}
      <Section>
        <div className="mx-auto max-w-5xl">
          <h2 className="display-h2 max-w-3xl text-foreground">
            {content.featuresH2}
          </h2>
          <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {content.features.map((f) => (
              <div key={f.title} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
                </span>
                <div>
                  <h3 className="text-[16px] font-semibold text-foreground">
                    {f.title}
                  </h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
                    {f.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Pricing teaser — links to full pricing. */}
      <Section
        bleed
        className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
      >
        <Container>
          <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 sm:p-10">
            <div className="flex items-baseline gap-3">
              <span className="text-[56px] font-semibold leading-none tabular-nums text-primary">
                $29
              </span>
              <span className="text-lg text-muted-foreground">
                /mo · the whole crew
              </span>
            </div>
            <h2 className="mt-6 text-2xl font-semibold text-foreground">
              {content.pricingH2}
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
              {content.pricingBody}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-1 text-[15px] font-medium text-primary underline-offset-4 hover:underline"
              >
                See full pricing
                <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
              </Link>
              <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Check className="size-4 text-success" strokeWidth={2} aria-hidden />
                Receiving texts and photos is always free
              </span>
            </div>
          </div>
        </Container>
      </Section>

      {/* Trade FAQ — no FAQPage JSON-LD (§11.2). */}
      <Section>
        <div className="mx-auto max-w-3xl">
          <h2 className="display-h2 text-center text-foreground">
            {content.faqH2}
          </h2>
          <div className="mt-12 divide-y divide-border border-y border-border">
            {content.faqs.map((item) => (
              <details key={item.q} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-[17px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <HelpCircle
                    className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-12"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </summary>
                <p className="pb-5 pr-8 text-[15px] leading-relaxed text-muted-foreground">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </Section>

      {/* Final CTA band — second allowed wash. */}
      <Section
        bleed
        className={cn(
          "bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24",
        )}
      >
        <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
          <h2 className="display-h2 text-foreground">{content.finalH2}</h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {content.finalSub}
          </p>
          <div className="mt-8 flex justify-center">
            <Button asChild size="lg">
              <Link href="/signup">
                {PRIMARY_CTA}
                <ArrowRight strokeWidth={1.75} aria-hidden />
              </Link>
            </Button>
          </div>
          <p className="mt-4 text-[13px] tabular-nums text-muted-foreground">
            {GUARANTEE_MICRO}
          </p>
        </div>
      </Section>
    </>
  );
}
