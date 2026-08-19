import { MarketingShell } from "@/components/marketing/shell";

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
 * ROOT / resolves into this group via (marketing)/page.tsx (Track B).
 *
 * D138: the frame itself moved to `components/marketing/shell.tsx` so the
 * French group can render the identical one in the other language. A Next
 * layout cannot read the pathname, so which language a page is in has to come
 * from which layout rendered it — and the two layouts share a shell rather
 * than a copy, because a copy is how the English footer and the French one
 * come to differ by a `<div>`.
 */
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <MarketingShell locale="en">{children}</MarketingShell>;
}
