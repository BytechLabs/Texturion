import { Footer } from "@/components/marketing/footer";
import { Nav } from "@/components/marketing/nav";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { organizationJsonLd } from "@/lib/marketing/seo";

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
 * ROOT / resolves into this group via (marketing)/page.tsx (Track B).
 */
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <JsonLd data={organizationJsonLd()} />
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
