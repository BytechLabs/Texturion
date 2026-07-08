import { cn } from "@/lib/utils";

/**
 * FR CHIPS (DESIGN-DIRECTION v4 §5.1, §5.2, fixtures).
 *
 * <Dateline>   The page-opening fact chip: Dispatch Ink ground, white mono
 *              uppercase text, 6px radius. ONE per page, and it ALWAYS
 *              carries a load-bearing fact for that page (e.g.
 *              "9:04 PM · TUESDAY", "$58 FIRST MONTH (US) · $29 AFTER").
 *              Never decoration. Pages with no load-bearing fact get no
 *              chip; legal pages use tone="frost" for the
 *              "Plain English summary" chip (ink text).
 *
 * <Eyebrow>    The section eyebrow: Frost ground, mono ink text, uppercase
 *              (e.g. "SEE IT WORK", "DO THE MATH").
 *
 * <DemoChip>   The ONLY content label the site may attach to a demo (Law 1):
 *              a terse mono chip reading exactly SCRIPTED DEMO, or
 *              EXAMPLE CONVERSATION on trade pages. It labels the
 *              conversation as scripted; it never mentions the interface,
 *              the site, or realism.
 *
 * Usage:
 *   <Dateline>9:04 PM · TUESDAY</Dateline>
 *   <Dateline tone="frost">Plain English summary</Dateline>
 *   <Eyebrow>See it work</Eyebrow>
 *   <DemoChip variant="example-conversation" />
 */

export function Dateline({
  children,
  tone = "ink",
  className,
}: {
  children: React.ReactNode;
  /** "ink" (default, the dateline) or "frost" (the legal summary chip). */
  tone?: "ink" | "frost";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "fr-eyebrow inline-flex items-center rounded-[6px] px-2.5 py-1.5",
        tone === "ink"
          ? "bg-[color:var(--fr-ink)] text-white"
          : "bg-[color:var(--fr-frost)] text-[color:var(--fr-ink)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "fr-eyebrow inline-flex items-center rounded-[6px] bg-[color:var(--fr-frost)] px-2.5 py-1.5 text-[color:var(--fr-ink)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The exact permitted label strings (Law 1). Nothing else, ever. */
export const DEMO_CHIP_LABELS = {
  "scripted-demo": "SCRIPTED DEMO",
  "example-conversation": "EXAMPLE CONVERSATION",
} as const;

export type DemoChipVariant = keyof typeof DEMO_CHIP_LABELS;

export function DemoChip({
  variant = "scripted-demo",
  className,
}: {
  variant?: DemoChipVariant;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "fr-eyebrow inline-flex items-center rounded-[6px] bg-[color:var(--fr-frost)] px-2.5 py-1.5 text-[color:var(--fr-ink)]",
        className,
      )}
    >
      {DEMO_CHIP_LABELS[variant]}
    </span>
  );
}
