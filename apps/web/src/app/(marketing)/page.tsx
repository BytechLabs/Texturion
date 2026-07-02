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
 * Section order + density wave (§3):
 *  3.1  Hero (signature live-thread)        — dense/signature
 *  3.1b Product showcase (framed inbox shot)— proof reveal (VISUALS §3)
 *  3.2  Truth bar ($29 as art)              — sparse
 *  3.3  The problem (three pains)           — sparse–med
 *  3.4  Inbox deep-dive (annotated)         — dense
 *  3.5  How it works + first-week timeline  — med
 *  3.6  Features bento (2 live-DOM tiles)   — dense
 *  3.7  Missed-text math (breather)         — sparse
 *  3.8  Dark band — built for the truck     — dense
 *  3.9  Pricing + slider + usage meter      — med
 *  3.10 Canada + compliance (interleaved)   — med
 *  3.11 FAQ                                 — sparse
 *  3.12 Final CTA (founder + security)      — sparse
 */

import type { Metadata } from "next";

import { HomeJsonLd } from "@/components/marketing/home-json-ld";
import { buildMetadata } from "@/lib/marketing/seo";
import { Hero } from "@/components/marketing/home/hero";
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
      <Hero />
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
