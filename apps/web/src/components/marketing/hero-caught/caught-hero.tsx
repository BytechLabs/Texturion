/**
 * CaughtHero, the signature "Caught" hero (DESIGN-DIRECTION §2, §3). The one
 * place the site spends its boldness. It dramatizes the single most
 * characteristic thing in this world: the customer text that would have been
 * missed, now CAUGHT and claimed by a name so it gets handled.
 *
 * A split hero. LEFT = the pitch, the guaranteed LCP (H1 text, no raster), set
 * in the composed <Display> ("Caught" system): a marker-yellow highlight on the
 * promise word, a lighter emphasis cut, one petrol accent. RIGHT = the "caught"
 * thread (DOM/CSS), server-rendered in its finished caught state so the LCP paint
 * / no-JS / reduced-motion are all the same meaningful thread; the client island
 * hydrates after first paint and replays the one "catch" once for motion users.
 *
 * LCP discipline (unchanged from the prior hero):
 *  - H1 TEXT is the guaranteed LCP; no image anywhere in the hero. The atmosphere
 *    is a CSS-gradient layer behind the LCP box (GlowBackdrop), never over text.
 *  - The thread server-renders its finished state (CaughtThreadStatic).
 *  - a per-breakpoint min-height on the H1 (min-h-[4.1em] sm:min-h-[2.1em],
 *    matched to Basteleur's real rendered height) holds the box so the
 *    font-display:swap Basteleur face can never reflow the sections below.
 *
 * Server component; the only client piece is the lazy thread island.
 */

import { Display } from "@/components/marketing/display";
import { GlowBackdrop } from "@/components/marketing/ui/glow-backdrop";
import { Container } from "@/components/marketing/ui/container";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";

import { CaughtThreadStatic } from "./caught-thread-static";
import { LazyCaughtThread } from "./lazy-caught-thread";
import { CaughtCta } from "./caught-cta";

export function CaughtHero() {
  return (
    <section className="relative overflow-hidden pb-16 pt-28 sm:pb-20 sm:pt-32">
      {/* The one morning-light two-wash behind the LCP box (§3): petrol low-left,
          amber upper-right, never over text, never animated. */}
      <GlowBackdrop />

      <Container className="relative">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)] lg:gap-14">
          {/* LEFT, the pitch. The LCP lives here (H1 text). */}
          <div>
            <p className="font-mono-mkt flex items-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
              <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
              Shared text inbox for your crew
            </p>

            {/* The LCP: the composed "Caught" headline. Basteleur Bold body, the
                Moonlight emphasis cut on the promise, the marker swipe on
                "caught", one petrol accent.

                ZERO-CLS RESERVE: Basteleur is a WIDE heavy display face, so the
                headline wraps to MORE lines than any metric-adjusted system
                fallback (measured: 4 lines vs 2 at 375px, 2 vs 1 at >=640px).
                That means the H1 box GROWS when Basteleur swaps in and shoves the
                page down (the font-swap CLS the audit flagged). We reserve the
                Basteleur multi-line height up front (min-h per breakpoint): the
                narrower fallback renders inside the already-reserved taller box,
                and Basteleur fills it exactly on swap. Nothing below moves.
                The min-h units are em (scale with the clamp font-size). */}
            <Display
              as="h1"
              size="hero"
              className="mt-5 min-h-[4.1em] sm:min-h-[2.1em]"
            >
              Every customer text{" "}
              <Display.Mark>caught</Display.Mark>, not{" "}
              <Display.Emph>missed</Display.Emph>.
            </Display>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--ink-70)]">
              One business number your whole crew can text from. Reply, assign,
              and close together.{" "}
              <span className="font-medium text-[color:var(--ink)]">
                <span className="font-mono-mkt text-[color:var(--petrol)]">
                  $29
                </span>{" "}
                flat for the whole crew.
              </span>
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              <CaughtCta />
              <ArrowLink href="#how-it-works" anchor>
                See how it works
              </ArrowLink>
            </div>

            <p className="font-mono-mkt mt-4 text-[13px] text-[color:var(--graphite)]">
              Month to month. 30-day money-back.
            </p>

            {/* Truth line: win-first US/CA timing (§7). */}
            <p className="mt-6 max-w-xl text-[13px] leading-relaxed text-[color:var(--ink-70)]">
              <span className="font-medium text-[color:var(--ink)]">
                Get your number today.
              </span>{" "}
              Receiving texts and texting Canada work right away. US texting
              turns on in about a week, once carriers approve.
            </p>
          </div>

          {/* RIGHT, the caught thread. Server-renders the finished caught state
              (LCP-safe, no-JS, reduced-motion floor); the island hydrates after
              first paint and replays the one "catch" for motion users. */}
          <div className="relative">
            <LazyCaughtThread fallback={<CaughtThreadStatic />} />
          </div>
        </div>
      </Container>
    </section>
  );
}
