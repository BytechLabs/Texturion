/**
 * <ArtRoot> — the shared <svg> shell for every JobText illustration/infographic.
 *
 * Responsibilities (so individual art files stay pure drawing):
 * - installs the themed palette (grammar.ts ART_VARS) so `var(--art-*)` resolves
 *   correctly in both light and dark;
 * - wires accessibility: a `title` becomes `role="img"` + <title>; an empty/absent
 *   title marks the art `aria-hidden` (decorative);
 * - sets a consistent default stroke context (`strokeLinecap/Linejoin: round`, the
 *   grammar STROKE) so children can omit repetitive attributes;
 * - opts into the once-on-scroll reveal via a data attribute the CSS animates
 *   (see art.css-in-globals is NOT needed — we reuse the existing [data-reveal]
 *   grammar through <ArtReveal>).
 *
 * Server component (no client JS). The reveal motion is delegated to the existing
 * <Reveal> island when a caller wants it, keeping ArtRoot itself inert and
 * SSR/LCP-safe.
 */

import { cn } from "@/lib/utils";

import { ART_VARS, STROKE } from "./grammar";

export interface ArtRootProps {
  /** SVG viewBox, e.g. "0 0 240 180". */
  viewBox: string;
  children: React.ReactNode;
  className?: string;
  /** Accessible name. Empty/absent → decorative (aria-hidden). */
  title?: string;
  /** Extra class for consumers that need to target the svg (rare). */
}

export function ArtRoot({ viewBox, children, className, title }: ArtRootProps) {
  const decorative = !title;
  return (
    <svg
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      className={cn("block h-auto w-full", ART_VARS, className)}
    >
      {!decorative && <title>{title}</title>}
      {children}
    </svg>
  );
}
