/**
 * Home page (Track B) — composes the BLUEPRINT §3 sections in the canonical
 * density-wave order (§1.4). Renders ONLY the ordered sections; Track A's
 * (marketing)/layout.tsx supplies <Nav/> + <Footer/> and the route-group
 * wiring (CONTRACT). ROOT / resolves here.
 *
 * The page is fully static (BLUEPRINT §11.4): every section is a server
 * component except the small client islands (the thread demos, the three
 * interactives), which hydrate after first paint. The LCP is the hero H1 text
 * over a server-rendered thread — no raster hero image (§3.1).
 *
 * <HomeJsonLd/> is Track A's WebSite + SoftwareApplication node, rendered once
 * here per Track A's SEO-lane contract (their component, invoked by this page).
 *
 * Ledger identity (iteration 5, ART-DIRECTION.md): the page is one authored
 * "job ledger" — every band is a <LedgerSection> numbered on the spine 01…12
 * (the primary anti-bland device, REFERENCES anti-bland #4), and the signature
 * Dispatch Desk hero (HERO-CONCEPT.md) replaces the iteration-4 two-phones hero.
 * The section order + density wave are unchanged (BLUEPRINT §3 / §1.4); iter 5
 * layers on the spine numbering, silhouette variety, the recurring ledger-row
 * grammar, the two sanctioned 132px numerals, the FILED stamp, one dark band +
 * one petrol-flood close, and the seven REFERENCES elevate items.
 *
 * Section order, spine number, and silhouette (anti-bland #1 — no two adjacent
 * bands share a shape):
 *  01 Dispatch Desk hero        — participatory live ticket
 *     Product showcase          — framed inbox-shot proof reveal
 *  02 Truth bar ($29 as art)    — expressive numeral
 *  03 The problem               — ruled ledger-entry trio (asymmetric)
 *  04 Inbox deep-dive           — live-product split
 *  05 How it works + timeline   — infographic + the 2nd numeral (Day 0)
 *  06 Features bento            — asymmetric bento w/ switchable live tile
 *  07 Missed-text math          — sparse breather + calculator
 *  08 Dark band                 — dark product/night band
 *  09 Pricing + slider          — pricing w/ live proof
 *  10 Canada + compliance       — interleaved editorial
 *  11 FAQ                       — ledger-row accordion
 *  12 Final CTA                 — petrol-flood close
 */

import type { Metadata } from "next";

import { HomeJsonLd } from "@/components/marketing/home-json-ld";
import { buildMetadata } from "@/lib/marketing/seo";
import { DispatchHero } from "@/components/marketing/hero-dispatch";
import { LedgerStyles } from "@/components/marketing/ledger";
import { ProductShowcase } from "@/components/marketing/home/product-showcase";
import { TruthBar } from "@/components/marketing/home/truth-bar";
import { Problem } from "@/components/marketing/home/problem";
import { InboxDeepDive } from "@/components/marketing/home/inbox-deep-dive";
import { HowItWorks } from "@/components/marketing/home/how-it-works";
import { Bento } from "@/components/marketing/home/bento";
import { MissedTextMath } from "@/components/marketing/home/missed-text-math";
import { DarkBand } from "@/components/marketing/home/dark-band";
import { PricingPreview } from "@/components/marketing/home/pricing-preview";
import { CanadaCompliance } from "@/components/marketing/home/canada-compliance";
import { Faq } from "@/components/marketing/home/faq";
import { FinalCta } from "@/components/marketing/home/final-cta";

export const metadata: Metadata = buildMetadata({
  title: "JobText — Shared text inbox for your crew | $29/mo flat",
  description:
    "One local business number your whole crew can text from — reply, assign, tag, and close together. Flat $29/mo for the team, month to month, no sales calls. US & Canada.",
  path: "/",
  absoluteTitle: true,
});

export default function HomePage() {
  return (
    <>
      <HomeJsonLd />
      {/* The marketing-scoped ledger identity styles (FILED stamp, highlight-
          swipe, spine, arrow-expand). One inert <style>, zero JS; globals.css
          and components/ui are untouched (iteration-5 constraint). */}
      <LedgerStyles />
      {/* 01 — the signature Dispatch Desk hero (HERO-CONCEPT.md). Replaces the
          iteration-4 two-phones hero. Composes at the top per the ownership. */}
      <DispatchHero />
      <ProductShowcase />
      <TruthBar />
      <Problem />
      <InboxDeepDive />
      <HowItWorks />
      <Bento />
      <MissedTextMath />
      <DarkBand />
      <PricingPreview />
      <CanadaCompliance />
      <Faq />
      <FinalCta />
    </>
  );
}
