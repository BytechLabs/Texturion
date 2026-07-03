/**
 * LedgerSection (iteration 5, ART-DIRECTION §2.2, §7 / REFERENCES anti-bland #4).
 *
 * A <Section> that threads the numbered ledger spine. Every home band is wrapped
 * in one of these with its `01…12` index, so a reader scrolling feels a single
 * ledger unspooling — the direct cure for "section after section". It reuses the
 * iteration-4 <Section> verbatim (rhythm, `cv-defer`, anchor ids) and only adds
 * the desktop margin spine tick; the inline numbered eyebrow is rendered by each
 * section beside its H2 via <SectionEyebrow>.
 *
 * The margin tick lives in the section's own left gutter on lg+ (spine is
 * desktop richness, §2.2). It is decorative/aria-hidden. Server component.
 */

import { cn } from "@/lib/utils";
import { Section } from "@/components/marketing/ui/section";

import { SpineTick } from "./section-number";

export function LedgerSection({
  n,
  children,
  className,
  containerClassName,
  id,
  bleed = false,
  defer = false,
  intrinsic,
  /** Suppress the desktop margin tick (bleed/dark/flood bands manage their own). */
  noSpine = false,
}: {
  /** The tabular section index (1–12) shown on the spine. */
  n: number;
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  id?: string;
  bleed?: boolean;
  defer?: boolean;
  intrinsic?: number;
  noSpine?: boolean;
}) {
  return (
    <Section
      id={id}
      bleed={bleed}
      defer={defer}
      intrinsic={intrinsic}
      className={cn("relative", className)}
      containerClassName={cn(!bleed && !noSpine && "relative", containerClassName)}
    >
      {/* Desktop margin spine tick — seats the section number on a ruled rule in
          the gutter. Hidden on mobile (the inline eyebrow carries it there). */}
      {!noSpine && !bleed && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 hidden lg:block"
        >
          {/* Nudge into the gutter left of the container's content edge. */}
          <div className="sticky top-24 -ml-2 xl:-ml-6">
            <SpineTick n={n} />
          </div>
        </div>
      )}
      {children}
    </Section>
  );
}
