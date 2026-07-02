/**
 * <ArtReveal> — the optional once-on-scroll reveal for an illustration or
 * infographic (VISUALS §2 motion: "subtle reveal option", 300ms, reduced-motion
 * shows the final frame).
 *
 * Thin convenience wrapper over the existing <Reveal> island so art placements
 * get a consistent, opt-in draw-in without every art file re-implementing an
 * observer. Art is static/final-frame by default (LCP-safe, SSR-correct); wrap it
 * in <ArtReveal> where a section wants the gentle rise-in. Because it delegates to
 * <Reveal>, it inherits the exact §1.5 grammar (opacity 0→1 + translateY 12px→0)
 * and the reduced-motion guarantee.
 */

import { Reveal } from "@/components/marketing/ui/reveal";
import { cn } from "@/lib/utils";

export function ArtReveal({
  children,
  className,
  /** Stagger delay in ms (§1.5: 60ms per item, capped by the caller). */
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className={cn(className)}>
      {children}
    </Reveal>
  );
}
