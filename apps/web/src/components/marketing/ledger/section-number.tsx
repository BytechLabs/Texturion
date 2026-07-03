/**
 * SectionNumber (iteration 5, ART-DIRECTION §2.2 / REFERENCES anti-bland #4).
 *
 * The tabular section number (`01`…`12`) that rides the ledger spine at every
 * section boundary — the single most-repeated brand element and the primary
 * anti-bland device. On desktop it sits on a short descending petrol-ticked
 * stone rule in the left margin; on mobile it collapses to the inline
 * `01`-style eyebrow above the H2 (same fingerprint, no margin cost).
 *
 * Server component. Pure DOM/CSS, `aria-hidden` on the decorative rule.
 */

import { cn } from "@/lib/utils";

/** Zero-pad to two digits — the tabular ledger index (`01`, `02`, … `12`). */
export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * The inline numbered eyebrow — a petrol section number + an optional label,
 * in the 13px tabular ledger-meta style. This is what every section H2 carries
 * (mobile-always, desktop-optional beside the margin spine).
 */
export function SectionEyebrow({
  n,
  label,
  className,
}: {
  n: number;
  label?: string;
  className?: string;
}) {
  return (
    <p className={cn("jt-meta flex items-center gap-2 text-primary", className)}>
      <span className="tabular-nums">{pad2(n)}</span>
      <span aria-hidden className="h-px w-6 bg-primary/40" />
      {label && <span className="text-muted-foreground">{label}</span>}
    </p>
  );
}

/**
 * The desktop margin spine tick — a short descending ruled rule with the number
 * seated on it. Absolutely positioned into the section's left gutter; rendered
 * only at lg+ where there is margin room (§2.2: "desktop richness, never a
 * mobile layout cost"). Decorative.
 */
export function SpineTick({ n }: { n: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 hidden select-none lg:block"
    >
      <div className="flex flex-col items-center gap-3">
        <span className="jt-meta tabular-nums text-primary">{pad2(n)}</span>
        <span className="jt-spine-rule h-24 w-px" />
      </div>
    </div>
  );
}
