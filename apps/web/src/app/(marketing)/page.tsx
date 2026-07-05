/**
 * Home page: "Quiet daylight" (v3-spec, BINDING; supersedes the "Open all
 * night" nocturne after client rejection). ROOT / resolves here;
 * (marketing)/layout.tsx supplies <Nav/> + <Footer/> + fonts + the shared
 * RevealActivator, so this file composes ONLY the ordered sections.
 *
 * The page is light, calm, and minimal: white/porcelain grounds, hairline
 * rules, one petrol accent, the amber unread dot, and exactly ONE dark band
 * (the final CTA). Motion is limited to the shared [data-reveal] rise, the
 * hero message's single soft landing, the delivery-tick steps, and the
 * final-CTA odometer roll; everything else is static. No-JS and reduced
 * motion both get the identical resolved server markup.
 *
 * Section order (footer comes from the layout):
 *  - NightHero          #tonight      calm 7/5 split, one thread card, LCP H1 text
 *  - AfterDark          #after-dark   three problem cards
 *  - NightShift         #night-shift  the five-step story + resolved thread card
 *  - DaylightFeatures   #day          six crew-tool cards
 *  - Pricing            #pricing      flat-price cards + the mono cost table
 *  - ApprovalClock      #approval     the carrier-approval day-tick board
 *  - Faq                #faq          native-disclosure FAQ
 *  - FinalCta           #start        the one dark band: odometer + composer CTA
 *
 * <NightCss/> mounts the small shared motion/style block once (land, ticks,
 * unread pulse, odometer roll). LCP: the hero H1 text node, full color from
 * first paint. Hero + the first band after it stay undeferred; everything
 * below defers via <Section defer intrinsic>.
 *
 * <HomeJsonLd/> is the WebSite + SoftwareApplication node, rendered once here
 * per the SEO-lane contract. Metadata: buildMetadata carries the deck's page
 * title/description; the deck's OG title/description differ from the meta
 * pair, so openGraph/twitter are overridden wholesale below (overriding
 * replaces the whole object, hence type/siteName/url re-included; the
 * canonical survives via the spread). og:image is auto-wired by Next from
 * (marketing)/opengraph-image.tsx; never hardcode image URLs here.
 */

import type { Metadata } from "next";

import { HomeJsonLd } from "@/components/marketing/home-json-ld";
import { buildMetadata } from "@/lib/marketing/seo";
import { absoluteUrl } from "@/lib/marketing/site";
import { NightCss } from "@/components/marketing/night/night-css";
import { NightHero } from "@/components/marketing/night/hero";
import { AfterDark } from "@/components/marketing/night/after-dark";
import { NightShift } from "@/components/marketing/night/night-shift";
import { DaylightFeatures } from "@/components/marketing/night/daylight-features";
import { Pricing } from "@/components/marketing/night/pricing";
import { ApprovalClock } from "@/components/marketing/night/approval-clock";
import { Faq } from "@/components/marketing/night/faq";
import { FinalCta } from "@/components/marketing/night/final-cta";

export const metadata: Metadata = {
  ...buildMetadata({
    title: "JobText: shared text inbox for your crew, $29 a month flat",
    description:
      "One local business number the whole crew texts from. Every customer text answered, assigned, and closed. $29 a month flat for the team, not per user.",
    path: "/",
    absoluteTitle: true,
  }),
  openGraph: {
    type: "website",
    siteName: "JobText",
    url: absoluteUrl("/"),
    title: "Your best lead texts at 9:47 pm.",
    description:
      "JobText is a shared text inbox for service businesses. One local number, the whole crew, $29 a month flat. Inbound texts are free.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Your best lead texts at 9:47 pm.",
    description:
      "JobText is a shared text inbox for service businesses. One local number, the whole crew, $29 a month flat. Inbound texts are free.",
  },
};

export default function HomePage() {
  return (
    <>
      <HomeJsonLd />
      {/* The one shared motion/style block (land, ticks, unread pulse,
          odometer roll). Mounted exactly once, above the first section. */}
      <NightCss />
      <NightHero />
      <AfterDark />
      <NightShift />
      <DaylightFeatures />
      <Pricing />
      <ApprovalClock />
      <Faq />
      <FinalCta />
    </>
  );
}
