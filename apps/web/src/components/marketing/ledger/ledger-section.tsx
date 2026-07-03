/**
 * LedgerSection — a <Section> that carries the numbered rhythm of the home page.
 *
 * Every home band is wrapped in one of these with its `01…12` index. The index
 * is rendered ONCE, by each section's inline <SectionEyebrow> beside its H2 —
 * the same fingerprint on mobile and desktop, no duplication. (VISUALS-V2 §1:
 * the earlier desktop "margin spine tick" duplicated that number in the gutter
 * and read homemade — it collided with the inline eyebrow at content width — so
 * it's removed; the clean numbered eyebrow is the whole device now.)
 *
 * This still reuses the <Section> primitive verbatim (rhythm, `cv-defer`, anchor
 * ids). Server component. `n` is retained on the props for call-site symmetry and
 * so the section knows its own index, even though the eyebrow renders it inline.
 */

import { cn } from "@/lib/utils";
import { Section } from "@/components/marketing/ui/section";

interface LedgerSectionProps {
  /**
   * The tabular section index (1–12). Kept on the contract so call sites read as
   * `n={3}` and the section documents its own place in the sequence; the number
   * itself is painted inline by each section's <SectionEyebrow>, not here.
   */
  n: number;
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  id?: string;
  bleed?: boolean;
  defer?: boolean;
  intrinsic?: number;
  /** Accepted for call-site compatibility; no longer paints a margin tick. */
  noSpine?: boolean;
}

export function LedgerSection(props: LedgerSectionProps) {
  const { children, className, containerClassName, id, bleed, defer, intrinsic } =
    props;
  return (
    <Section
      id={id}
      bleed={bleed}
      defer={defer}
      intrinsic={intrinsic}
      className={cn("relative", className)}
      containerClassName={containerClassName}
    >
      {children}
    </Section>
  );
}
