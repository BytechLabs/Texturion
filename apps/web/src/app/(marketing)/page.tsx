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
 *  - TruthBar     S2                the Starter display figure + three chips
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

import { HomePageBody } from "@/components/marketing/home-page";
import { formatMoney, PLAN_PRICE_CENTS } from "@loonext/shared";
import type { Metadata } from "next";

import { buildMetadata } from "@/lib/marketing/seo";
import { absoluteUrl } from "@/lib/marketing/site";

/**
 * #328 — the ONE price figure on this page that cannot follow the visitor.
 *
 * Everything the page RENDERS (the truth bar, the plan cards, the calculator)
 * reads the site-wide country and shows CAD to a Canadian. Metadata cannot:
 * `metadata` is evaluated on the server, once, for one URL, and the country
 * signal is a client-side choice in localStorage. There is nothing to read.
 *
 * Three ways out, and why this is the one:
 *   - Geo-detect in `generateMetadata` from the Cloudflare country header.
 *     Rejected. It is a SECOND country signal that would disagree with the
 *     first — a visitor who told us "Canada" would get a CAD page under a USD
 *     description, or the reverse — and it makes the LCP page dynamic. Worse,
 *     the requests that matter most here come from link scrapers on datacentre
 *     IPs, whose country means nothing.
 *   - Drop the figure. It is the strongest hook in the description ("flat for
 *     the team, not per user" only lands attached to a number).
 *   - Pin it to USD and derive it. What we do. The figure is still wrong for a
 *     Canadian reading a SERP snippet, but it is wrong by one currency rather
 *     than wrong forever: when the USD price moves, this moves with it.
 */
const STARTER_USD = formatMoney(PLAN_PRICE_CENTS.usd.starter, "usd");

const OG_TITLE = "Somebody texted your business at 9:04 last night.";
const OG_DESCRIPTION =
  "Loonext gives your business a local number and one shared inbox for the texts and calls that reach it, answered by whoever on the crew is free. " +
  `${STARTER_USD} a month flat for the team, not per user.`;

export const metadata: Metadata = {
  ...buildMetadata({
    // SERP title: short enough to survive Google's ~60-char cut, category
    // words buyers actually search, and no number-count claim (Pro carries
    // two numbers and crews can buy more, so "one number" oversells the
    // constraint). The share headline stays OG_TITLE below.
    // #491: was "the shared text inbox for service crews". Calling has been
    // included on every plan since D36-D43, and the SERP title is the single
    // line most buyers ever read about what this is.
    title: "Loonext: the shared line for service crews",
    description:
      "One business number for texts and calls, in an inbox the whole crew works from any phone. Reply, answer, assign, turn it into a job, close it. " +
      `${STARTER_USD} a month flat for the team, not per user.`,
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
  return <HomePageBody locale="en" />;
}
