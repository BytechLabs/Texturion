import { Footer } from "@/components/marketing/footer";
import { Nav } from "@/components/marketing/nav";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { RevealActivator } from "@/components/marketing/ui/reveal-activator";
import { organizationJsonLd } from "@/lib/marketing/seo";
import { fraunces } from "@/lib/marketing/fonts";

/**
 * Fraunces — the MARKETING display face (VISUALS-V2 §5). A warm old-style serif
 * that carries the "personality, warmth, a little wonk" the rework demands, on
 * marketing HEADLINES only. The next/font instance is defined once in
 * `@/lib/marketing/fonts` (shared with the hero, which applies its className to
 * the LCP H1 so the subset gets preloaded — see that file). Here we mount its
 * `.variable` (`--font-display`) on the (marketing) route-group subtree so the
 * headline utilities resolve it — the APP stays calm Inter-only (VISUALS-V2 §5,
 * the two-surfaces rule), and nothing outside this subtree can resolve it.
 */

/**
 * The (marketing) route group shell (BLUEPRINT §12, Track A contract): lean —
 * Nav + children + Footer only, with NONE of the app's provider weight
 * (TanStack Query, tooltips, toaster, service worker live in app-providers.tsx,
 * mounted by the signed-in groups). ThemeProvider stays global in the root
 * layout, so dark mode still works here (the dark band, the footer toggle).
 *
 * Organization JSON-LD is emitted once here so it covers every marketing page
 * (§11.2). WebSite + SoftwareApplication (home/pricing-specific) are provided as
 * helpers in lib/marketing/seo.ts for those pages to render.
 *
 * The Fraunces `.variable` className scopes `--font-display` to this subtree
 * (MARKETING-ONLY display font, VISUALS-V2 §5) without touching the app's Inter.
 *
 * ROOT / resolves into this group via (marketing)/page.tsx (Track B).
 */
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`${fraunces.variable} flex min-h-svh flex-col bg-background`}>
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
