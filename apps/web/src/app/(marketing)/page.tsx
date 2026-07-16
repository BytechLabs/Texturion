/**
 * Home page: v4 "FIRST RESPONSE" (DESIGN-DIRECTION v4 + COPY-DECK v2,
 * BINDING; supersedes the v3 "Quiet daylight" page). ROOT / resolves here;
 * (marketing)/layout.tsx supplies <Nav/> + <Footer/> + fonts + the shared
 * RevealActivator, so this file composes ONLY the ordered sections.
 *
 * The eleven-section arc (owner ruling 2026-07-07: S7 merged into S6 cell 9):
 *  - Hero         S1  #tonight      9:04 dateline, LCP H1, the Arrival Field
 *                                   (the site's ONLY live canvas, Law 3)
 *                                   docking into the real inbox
 *  - TruthBar     S2                $29 display figure + the three chips
 *  - Pattern      S3  #after-dark   the three pain cards (Frost band)
 *  - FixShown     S4  #see-it-work  the steppable water-heater thread in the
 *                                   product frame (app tokens, Law 2)
 *  - ThreeSteps   S5  #steps        signup-to-texting + first-week timeline
 *  - Bento        S6  #day          nine cells, four real-component anchors
 *  - DoTheMath    S8  #math         the calculator (the one Flare display)
 *  - TheDeal      S9  #deal         plan cards, Truth Strip, slider, meter
 *  - RulesCanada  S10 #rules        carrier proof points + the Canada card
 *  - Faq          S11 #faq          native-disclosure fair questions
 *  - FinalCta     S12 #start        the ONE cobalt band, static SVG backdrop
 *
 * <HomeJsonLd/> is the WebSite + SoftwareApplication node, rendered once here
 * per the SEO-lane contract. Metadata: buildMetadata carries the page
 * title/description (canonical https://loonext.com/, owner rule 12); the
 * OG/twitter pair leads with the 9:04 hook, so openGraph/twitter are
 * overridden wholesale below (overriding replaces the whole object, hence
 * type/siteName/url re-included; the canonical survives via the spread).
 * og:image is auto-wired by Next from (marketing)/opengraph-image.tsx; never
 * hardcode image URLs here.
 */

import type { Metadata } from "next";

import { HomeJsonLd } from "@/components/marketing/home-json-ld";
import { Hero } from "@/components/marketing/hero/hero";
import { Bento } from "@/components/marketing/home/bento";
import { DoTheMath } from "@/components/marketing/home/do-the-math";
import { Faq } from "@/components/marketing/home/faq";
import { FinalCta } from "@/components/marketing/home/final-cta";
import { FixShown } from "@/components/marketing/home/fix-shown";
import { Pattern } from "@/components/marketing/home/pattern";
import { RulesCanada } from "@/components/marketing/home/rules-canada";
import { TheDeal } from "@/components/marketing/home/the-deal";
import { ThreeSteps } from "@/components/marketing/home/three-steps";
import { TruthBar } from "@/components/marketing/home/truth-bar";
import { buildMetadata } from "@/lib/marketing/seo";
import { absoluteUrl } from "@/lib/marketing/site";

const OG_TITLE = "Somebody texted your business at 9:04 last night.";
const OG_DESCRIPTION =
  "Loonext gives your business a local number and a shared text inbox the whole crew answers from. $29 a month flat for the team, not per user.";

export const metadata: Metadata = {
  ...buildMetadata({
    // SERP title: short enough to survive Google's ~60-char cut, category
    // words buyers actually search, and no number-count claim (Pro carries
    // two numbers and crews can buy more, so "one number" oversells the
    // constraint). The share headline stays OG_TITLE below.
    title: "Loonext: the shared text inbox for service crews",
    description:
      "A local business number and a shared text inbox. The whole crew reads, replies, assigns, and closes from any phone. $29 a month flat for the team, not per user.",
    path: "/",
    absoluteTitle: true,
  }),
  openGraph: {
    type: "website",
    siteName: "Loonext",
    url: absoluteUrl("/"),
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
};

export default function HomePage() {
  return (
    <>
      <HomeJsonLd />
      <Hero />
      <TruthBar />
      <Pattern />
      <FixShown />
      <ThreeSteps />
      <Bento />
      <DoTheMath />
      <TheDeal />
      <RulesCanada />
      <Faq />
      <FinalCta />
    </>
  );
}
