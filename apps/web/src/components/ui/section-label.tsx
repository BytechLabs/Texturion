import { cn } from "@/lib/utils";

/**
 * #733: the one small heading over a group, a column or a list: 11px, semibold,
 * uppercase, 0.06em tracking, muted. Every such label in the app reads the same,
 * so a person learns it once. `text-app-muted` rather than the lighter
 * `text-app-muted-2`, because labels also sit on tinted bands where the lighter
 * token falls under 4.5:1 in dark mode.
 *
 * `section-label.test.ts` fails when a hand-rolled uppercase, tracked class string
 * appears anywhere else; chips (rounded, with a fill) are their own pattern.
 */
export const SECTION_LABEL_CLASS =
  "text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted";

export function SectionLabel({
  as: Tag = "h2",
  count,
  className,
  id,
  children,
}: {
  as?: "h2" | "h3" | "p" | "span" | "div";
  /** A count beside the label; zero or absent shows nothing. */
  count?: number;
  className?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag id={id} className={cn("flex items-baseline gap-2", SECTION_LABEL_CLASS, className)}>
      {children}
      {count !== undefined && count > 0 && <span className="tabular-nums">{count}</span>}
    </Tag>
  );
}
