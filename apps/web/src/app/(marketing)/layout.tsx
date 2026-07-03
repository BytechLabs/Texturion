import { Footer } from "@/components/marketing/footer";
import { Nav } from "@/components/marketing/nav";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { RevealActivator } from "@/components/marketing/ui/reveal-activator";
import { organizationJsonLd } from "@/lib/marketing/seo";
import { basteleur, hankenGrotesk, commitMono } from "@/lib/marketing/fonts";
import { MARKETING_FONT_PRELOADS } from "@/lib/marketing/font-preloads";

/**
 * The MARKETING type trio (DESIGN-DIRECTION §3), locked by the /fontlab render
 * pass: Basteleur (display), Hanken Grotesk (body), Commit Mono (data). The
 * next/font/local instances are defined once in `@/lib/marketing/fonts`; here we
 * mount their combined `.variable` classNames on the (marketing) route-group
 * subtree so the marketing headline/body/mono utilities resolve them. The APP
 * stays calm Inter-only (the two-surfaces rule), nothing outside this subtree
 * can resolve --font-display / --font-body-mkt / --font-mono-mkt.
 */

/**
 * The (marketing) route group shell (BLUEPRINT §12, Track A contract): lean,
 * Nav + children + Footer only, with NONE of the app's provider weight
 * (TanStack Query, tooltips, toaster, service worker live in app-providers.tsx,
 * mounted by the signed-in groups). ThemeProvider stays global in the root
 * layout, so dark mode still works here (the dark band, the footer toggle).
 *
 * Organization JSON-LD is emitted once here so it covers every marketing page
 * (§11.2). WebSite + SoftwareApplication (home/pricing-specific) are provided as
 * helpers in lib/marketing/seo.ts for those pages to render.
 *
 * The trio's `.variable` classNames scope --font-display / --font-body-mkt /
 * --font-mono-mkt to this subtree (MARKETING-ONLY) without touching the app's
 * Inter. `.font-body-mkt` sets Hanken Grotesk as the marketing body face here so
 * marketing prose reads in the warm grotesque, not Inter.
 *
 * ROOT / resolves into this group via (marketing)/page.tsx (Track B).
 */
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Mounts --font-display / --font-body-mkt / --font-mono-mkt on the (marketing)
    // subtree only (the two-surfaces rule); the app stays Inter.
    <div
      className={`mkt-scope ${basteleur.variable} ${hankenGrotesk.variable} ${commitMono.variable} font-body-mkt flex min-h-svh flex-col`}
    >
      {/* PRELOAD the LCP hero face (Basteleur Bold, the weight the H1 is set in).
          next/font doesn't emit this with inlineCss on. With font-display:optional
          the preload is what lets Bold make the ~100 ms block window so the hero
          lettering renders instead of the fallback on warm loads. ONLY the LCP face
          is preloaded: preloading the demoted above-the-fold faces (Moonlight/
          Hanken) only contends for the critical path with no LCP benefit, so they
          upgrade in-window from the inlined @font-face instead (gen-font-preloads
          .mjs). React 19 hoists this <link> into <head>; the manifest is generated
          post-build and is empty on the first build pass. */}
      {MARKETING_FONT_PRELOADS.map((href) => (
        <link
          key={href}
          rel="preload"
          as="font"
          type="font/woff2"
          href={href}
          crossOrigin="anonymous"
        />
      ))}
      {/* No-JS fail-safe: reveal every scroll-reveal element when JS is off, so
          content is never permanently hidden without the RevealActivator. */}
      <noscript>
        <style>{`[data-reveal]{opacity:1 !important;transform:none !important;}`}</style>
      </noscript>
      <JsonLd data={organizationJsonLd()} />
      {/* One shared IntersectionObserver drives every [data-reveal] (§1.5). */}
      <RevealActivator />
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
