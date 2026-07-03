/**
 * Home page (Track B), composes the BLUEPRINT §3 sections in the canonical
 * density-wave order (§1.4). Renders ONLY the ordered sections; Track A's
 * (marketing)/layout.tsx supplies <Nav/> + <Footer/> and the route-group
 * wiring (CONTRACT). ROOT / resolves here.
 *
 * The page is fully static (BLUEPRINT §11.4): every section is a server
 * component except the small client islands (the thread demos, the three
 * interactives), which hydrate after first paint. The LCP is the hero H1 text
 * over a server-rendered thread, no raster hero image (§3.1).
 *
 * <HomeJsonLd/> is Track A's WebSite + SoftwareApplication node, rendered once
 * here per Track A's SEO-lane contract (their component, invoked by this page).
 *
 * The "Caught" identity (DESIGN-DIRECTION.md, BINDING): the page opens on the
 * signature Caught hero (the customer text that would have been missed, now
 * caught and claimed by a name) and everything else stays quiet around it.
 * Structure comes from GROUND changes (paper to the one deep-petrol band and
 * back) and display-lettering rhythm, NOT from a numbered spine (§0: the ledger
 * 01…12 numbering, the FILED stamp, and fake indicators are removed).
 *
 * Section order (real content logic: a text arrives, someone catches it, the job
 * gets done, here is the price, start), with no two adjacent bands sharing a
 * silhouette. Structure is carried by GROUND changes and display-lettering
 * rhythm, NOT a counter:
 *  - Caught hero            the signature: a message lands, a name attaches
 *    Product showcase       framed inbox-shot proof reveal
 *  - Truth bar ($29 as art) the one expressive numeral
 *  - The problem            asymmetric register + duotone photo
 *  - Inbox deep-dive        the same catch, slowed down (real product demo)
 *  - How it works + timeline steps + the Day 0 numeral
 *  - Features bento         asymmetric bento with a switchable live tile
 *  - Missed-text math       sparse breather + calculator
 *  - Built for the truck    real dark-mode screenshot on paper (the ONE deep
 *                           ground is reserved for the final close)
 *  - Pricing + slider       petrol-tinted panel with live proof
 *  - Canada + compliance    interleaved editorial, flipped silhouettes
 *  - FAQ                    accordion
 *  - Final CTA              the one deep-petrol flood close
 */

import type { Metadata } from "next";

import { HomeJsonLd } from "@/components/marketing/home-json-ld";
import { buildMetadata } from "@/lib/marketing/seo";
import { CaughtHero } from "@/components/marketing/hero-caught";
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
  title: "JobText. Shared text inbox for your crew | $29/mo flat",
  description:
    "One local business number your whole crew can text from, reply, assign, tag, and close together. Flat $29/mo for the team, month to month, no sales calls. US & Canada.",
  path: "/",
  absoluteTitle: true,
});

export default function HomePage() {
  return (
    <>
      <HomeJsonLd />
      {/* Marketing-scoped CSS for the remaining drawn affordances (the delivered
          check, the arrow-expand CTA). One inert <style>, zero JS; globals.css
          and components/ui are untouched. The ledger costume (FILED stamp, spine
          numbering, pulse/ghost) is removed per DESIGN-DIRECTION §0. */}
      <LedgerStyles />
      {/* The signature "Caught" hero (DESIGN-DIRECTION §2, §3), the customer
          text that would have been missed, now caught and claimed by a name.
          The one place the site spends its boldness. */}
      <CaughtHero />
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
