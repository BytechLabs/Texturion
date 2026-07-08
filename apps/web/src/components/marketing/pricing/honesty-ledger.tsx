import { cn } from "@/lib/utils";

/**
 * HONESTY LEDGER, definition form (DESIGN-DIRECTION v4 §5.3): the mono table
 * treatment for "every cost, before you pay". Spline Sans Mono figures, Frost
 * row striping, NO rules (Law 10), sourced footnotes in ink-55. This is the
 * stacked term/figure/detail shape used on /pricing; the columnar shape lives
 * in components/marketing/compare/ledger-table.tsx.
 *
 * Server component.
 */

export interface LedgerEntry {
  /** The cost being named, e.g. "Your plan" or "That's the whole list." */
  term: string;
  /** The pulled-out mono figure, e.g. "$29 or $79/mo". Omit when the row is prose. */
  figure?: string;
  /** The plain-words explanation under the term. */
  detail: string;
}

export function HonestyLedger({
  entries,
  className,
}: {
  entries: LedgerEntry[];
  className?: string;
}) {
  return (
    <dl className={cn("fr-card overflow-hidden", className)}>
      {entries.map((entry, i) => (
        <div
          key={entry.term}
          className={cn(
            "px-6 py-5 sm:px-8",
            // Frost row striping (§5.3), never a hairline.
            i % 2 === 1 && "bg-[color:var(--fr-frost)]",
          )}
        >
          <dt className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="font-body-mkt text-[0.9375rem] font-semibold text-[color:var(--fr-ink)]">
              {entry.term}
            </span>
            {entry.figure ? (
              <span className="fr-mono-data text-[color:var(--fr-ink)]">
                {entry.figure}
              </span>
            ) : null}
          </dt>
          <dd className="mt-1.5 text-[0.875rem] leading-relaxed text-[color:var(--fr-ink-70)]">
            {entry.detail}
          </dd>
        </div>
      ))}
    </dl>
  );
}
