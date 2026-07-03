/**
 * SectionNumber — the tabular section number (`01`…`12`) that opens every home
 * band as its inline eyebrow: a petrol index + a short rule + a plain label,
 * above the H2. It's the page's numbered rhythm — the one device that makes
 * twelve sections read as a single sequence — rendered identically on mobile and
 * desktop, once per section (VISUALS-V2 §1: no duplicated gutter tick).
 *
 * Server component. Pure DOM/CSS.
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
