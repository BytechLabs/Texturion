/**
 * A labeled section on the landing screen: small uppercase label + count, then
 * the calm card list.
 *
 * `count` is omitted for ambient sections (Recent calls) — a history count is
 * not a workload number.
 *
 * #287: extracted from `for-you-view.tsx` when the outstanding-quotes queue
 * became its own module. One definition rather than two, because two sections
 * on one screen with separately-maintained chrome is the exact drift the
 * dashboard's measure headings had (#540).
 */
export function Section({
  label,
  count,
  children,
  id,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
  /** #540: what the summary strip's tile links to. */
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <h2 className={cn(SECTION_LABEL_CLASS, "flex items-baseline gap-2 px-1 pb-2")}>
        {label}
        {count !== undefined && count > 0 && (
          <span className="tabular-nums">{count}</span>
        )}
      </h2>
      <div className="overflow-hidden rounded-app-card border border-app-line bg-app-paper">
        {children}
      </div>
    </section>
  );
}
import { SECTION_LABEL_CLASS } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";
