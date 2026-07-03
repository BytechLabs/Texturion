/**
 * DispatchHero (iteration 5) — the signature "Dispatch Desk" hero.
 * Build-ready spec: HERO-CONCEPT.md (followed exactly). Identity: ART-DIRECTION.
 *
 * A SPLIT hero. LEFT = the pitch, pure text, the guaranteed LCP, server-rendered
 * on first paint. RIGHT = the DISPATCH DESK, an interactive object the visitor
 * drives: a raw, panicked customer text lands as UNFILED, and the visitor FILES
 * it in one tap. The wow and the 5-second clarity test land in the same frame.
 *
 * LCP discipline (HERO-CONCEPT §2, non-negotiable):
 *  - The H1 TEXT is the guaranteed LCP — plain text, no raster anywhere in the
 *    hero (the desk is DOM/CSS/SVG). The atmosphere is a CSS-gradient layer
 *    behind the LCP box, never over text, never blurred on the LCP region.
 *  - The desk SERVER-RENDERS its finished State B (DispatchDeskStatic) — a filed,
 *    assigned, done conversation — so LCP paint / no-JS / reduced-motion are all
 *    the same meaningful ticket. The interactive island hydrates AFTER first
 *    paint (LazyDispatchDesk, eager=idle) and only then resets to State A.
 *
 * This is a Server Component; the only client pieces are the lazy desk island
 * and the magnetic CTA, both of which hydrate after the LCP.
 *
 * Ownership: hero track. Exports <DispatchHero/>. Does not touch page.tsx.
 */

import { GlowBackdrop } from "@/components/marketing/ui/glow-backdrop";
import { Container } from "@/components/marketing/ui/container";
import { SectionEyebrow, SpineTick } from "@/components/marketing/ledger/section-number";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";

import { DispatchDeskStatic } from "./dispatch-desk-static";
import { LazyDispatchDesk } from "./lazy-dispatch-desk";
import { MagneticCta } from "./magnetic-cta";

export function DispatchHero() {
  return (
    <section className="relative overflow-hidden pb-16 pt-28 sm:pb-20 sm:pt-32">
      {/* The ONE morning-light two-wash (ART-DIRECTION §3.2): petrol low-left,
          amber upper-right, behind the LCP box — never over text, never blurred,
          never animated. Reuses the committed GlowBackdrop (marketing-glow). */}
      <GlowBackdrop />

      <Container className="relative">
        {/* The `01` ledger spine tick in the left margin (§2.2 / HERO §1). */}
        <SpineTick n={1} />

        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14">
          {/* LEFT — the pitch. The LCP lives here (H1 text). */}
          <div>
            <SectionEyebrow n={1} label="Shared text inbox for your crew" />

            {/* The LCP: H1 text, ledger-ruled baseline, one highlight-swipe on
                "job". clamp(44px,5.5vw,72px) via the marketing-scoped jt-hero-h1
                (globals.css untouched). fetchpriority is implicit for text. */}
            <h1 className="jt-hero-h1 mt-4 text-balance border-b border-primary/25 pb-4 text-foreground">
              Every customer text becomes a{" "}
              <span className="jt-swipe text-foreground">job</span> your whole
              crew can see.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              One business number. One shared inbox.{" "}
              <span className="font-medium text-foreground">
                $29 flat for the whole crew.
              </span>
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              <MagneticCta />
              <ArrowLink href="#how-it-works" anchor>
                See how it works ↓
              </ArrowLink>
            </div>

            {/* Risk-reducer near the CTA (§7 / CONVERSION §2). */}
            <p className="jt-meta mt-3 text-muted-foreground">
              Month to month · 30-day money-back
            </p>

            {/* Truth line — win-first US/CA timing (§7, SPEC §4.1). */}
            <p className="mt-6 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">
                Get your number today.
              </span>{" "}
              Receiving texts and texting Canada work right away; US texting
              turns on in about a week once carriers approve.
            </p>
          </div>

          {/* RIGHT — the dispatch desk. Server-renders State B (the LCP-safe,
              no-JS, reduced-motion floor); the island hydrates after first paint
              and resets to State A so the visitor can file the job themselves. */}
          <div className="relative">
            <LazyDispatchDesk fallback={<DispatchDeskStatic />} />
          </div>
        </div>
      </Container>
    </section>
  );
}
