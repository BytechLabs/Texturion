import { MarketingShell } from "@/components/marketing/shell";

/**
 * The French marketing group (D138).
 *
 * A second route group rather than a locale segment, and a second layout rather
 * than one that reads the path — because a Next layout receives `children` and
 * nothing else, so the only place the language can come from is WHICH layout
 * rendered. The frame itself is shared with `(marketing)`; only this line
 * differs.
 *
 * Route groups do not appear in the URL, so the pages under `fr/` serve
 * `/fr/…`. Anything under `/fr` without a page here 404s, which is D138 Rule 4:
 * a French URL serving English tells a Quebec reader the French was withdrawn.
 */
export default function MarketingFrLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <MarketingShell locale="fr-CA">{children}</MarketingShell>;
}
