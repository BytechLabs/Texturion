import { ConsentBanner } from "@/components/marketing/consent";
import { CountryProvider } from "@/components/marketing/country";
import { Footer } from "@/components/marketing/footer";
import { GoogleTagManager } from "@/components/marketing/google-tag-manager";
import { LedgerStyles } from "@/components/marketing/ledger";
import { Nav } from "@/components/marketing/nav";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { RevealActivator } from "@/components/marketing/ui/reveal-activator";
import { golosText } from "@/lib/app/fonts";
import { organizationJsonLd } from "@/lib/marketing/seo";
import { body, display, mono } from "@/lib/marketing/fonts";

/**
 * The MARKETING v4 type trio (DESIGN-DIRECTION §3, "FIRST RESPONSE"):
 * Bricolage Grotesque (display), Hanken Grotesk (body), Spline Sans Mono
 * (data). The next/font/google instances are defined once in
 * `@/lib/marketing/fonts`; here we mount their `.variable` classNames on the
 * (marketing) route-group subtree so --font-display / --font-body /
 * --font-mono resolve for the marketing utilities. The APP keeps its own
 * faces (the two-surfaces rule); nothing outside this subtree can resolve
 * the marketing font variables. next/font emits the font preload links
 * itself (no manual preload manifest).
 */

/**
 * The (marketing) route group shell (BLUEPRINT §12, Track A contract): lean,
 * Nav + children + Footer only, with NONE of the app's provider weight
 * (TanStack Query, tooltips, toaster, service worker live in app-providers.tsx,
 * mounted by the signed-in groups). ThemeProvider stays global in the root
 * layout; the marketing scope pins itself light in globals.css (v4: the site
 * is Signal White on every page; the only dark surfaces are the dateline chip
 * and the footer band, plus local `.dark` regions for dark-mode product
 * embeds inside phone frames).
 *
 * Organization JSON-LD is emitted once here so it covers every marketing page
 * (§11.2). WebSite + SoftwareApplication (home/pricing-specific) are provided
 * as helpers in lib/marketing/seo.ts for those pages to render.
 *
 * ROOT / resolves into this group via (marketing)/page.tsx (Track B).
 */
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Mounts --font-display / --font-body / --font-mono on the (marketing)
    // subtree only (the two-surfaces rule); the app keeps its own faces.
    // --font-golos joins them for exactly one thing: the brand wordmark
    // (#206) in the nav and footer is Golos Text SemiBold by rule.
    <div
      className={`mkt-scope ${display.variable} ${body.variable} ${mono.variable} ${golosText.variable} font-body-mkt flex min-h-svh flex-col`}
    >
      {/* No-JS fail-safe: reveal every scroll-reveal element when JS is off, so
          content is never permanently hidden without the RevealActivator. */}
      <noscript>
        <style>{`[data-reveal]{opacity:1 !important;transform:none !important;}`}</style>
      </noscript>
      {/* #124: Google Tag Manager — marketing pages only, gated on
          NEXT_PUBLIC_GTM_ID (off in dev/CI). Never mounted by the app groups.
          The ConsentBanner shares the same gate: it asks (once) whether GTM
          tags may set cookies, and the loader's Consent Mode v2 default stays
          denied until the visitor says yes. Overlay, never inserts (CLS 0). */}
      <GoogleTagManager />
      <ConsentBanner />
      <JsonLd data={organizationJsonLd()} />
      {/* The shared drawn-affordance CSS (.jt-meta, .jt-arrow-link, the
          delivered check): mounted here because ArrowLink and the meta voice
          appear on subpages (canada, compare, features, trades), not just the
          home page that used to carry this style block. */}
      <LedgerStyles />
      {/* One shared IntersectionObserver drives every [data-reveal] (§4). */}
      <RevealActivator />
      {/* One site-wide country (owner ruling v1): the nav CountrySelector, the
          home HeroCountryChooser, the branch helpers, and the /pricing toggle
          all read this single provider, so every surface moves the same state.
          SSR default is "us"; a returning visitor's choice is adopted from
          localStorage after hydration. */}
      <CountryProvider>
        <Nav />
        {/* id="content" is the nav skip link's target; keep it in sync with
            nav.tsx's .frn-skip href. */}
        <main id="content" className="flex-1">
          {children}
        </main>
        <Footer />
      </CountryProvider>
    </div>
  );
}
