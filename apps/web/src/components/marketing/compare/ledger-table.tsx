import { cn } from "@/lib/utils";

/**
 * HONESTY LEDGER, columnar form (DESIGN-DIRECTION v4 §5.3): the mono table
 * treatment used as the centerpiece of every compare page and the "same crew,
 * priced elsewhere" table. Spline Sans Mono figures, Frost row striping, NO
 * rules (Law 10), per-cell sourced notes in ink-55 so the dating and sourcing
 * are structural, not a footnote a writer might forget.
 *
 * The Loonext column header is cobalt (the marketing voice), but the cells
 * never shout: emphasis is weight, not color, so the facts stay louder than
 * the styling. Horizontal scroll is contained; the page body never scrolls
 * sideways.
 *
 * Server component; it renders only what the page passes it, and every page's
 * data is dated and sourced at the call site.
 */

export interface LedgerCell {
  /** The figure or phrase in the cell, e.g. "$29 flat" or "Not published". */
  value: string;
  /** Per-cell source or assumption, small ink-55 text under the value. */
  note?: string;
}

export interface LedgerTableRow {
  /** The dimension being compared, e.g. "Monthly software". */
  label: string;
  /** One cell per column, in column order. */
  cells: (LedgerCell | string)[];
  /** Total rows render with the Frost well + semibold figures. */
  total?: boolean;
}

export interface LedgerColumn {
  label: string;
  /** Small line under the column label, e.g. "as of July 2026". */
  sub?: string;
  /** True marks the Loonext column (cobalt label). */
  highlight?: boolean;
}

function asCell(cell: LedgerCell | string): LedgerCell {
  return typeof cell === "string" ? { value: cell } : cell;
}

export function LedgerTable({
  columns,
  rows,
  caption,
  className,
}: {
  columns: LedgerColumn[];
  rows: LedgerTableRow[];
  /** sr-only <caption> naming the table for screen readers. */
  caption: string;
  className?: string;
}) {
  return (
    <div className={cn("fr-card overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-[22%] px-5 py-4">
                <span className="sr-only">Line item</span>
              </th>
              {columns.map((col) => (
                <th key={col.label} scope="col" className="px-5 py-4 align-top">
                  <span
                    className={cn(
                      "font-body-mkt block text-[0.9375rem] font-semibold",
                      col.highlight
                        ? "text-[color:var(--fr-cobalt)]"
                        : "text-[color:var(--fr-ink)]",
                    )}
                  >
                    {col.label}
                  </span>
                  {col.sub ? (
                    <span className="fr-eyebrow mt-1 block normal-case tracking-normal text-[color:var(--fr-ink-55)]">
                      {col.sub}
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.label}
                className={cn(
                  // Frost striping carries the separation; no rules (Law 10).
                  row.total
                    ? "bg-[color:var(--fr-frost)]"
                    : i % 2 === 1 && "bg-[color:var(--fr-frost)]/60",
                )}
              >
                <th
                  scope="row"
                  className={cn(
                    "px-5 py-4 text-left align-top font-body-mkt text-[0.8125rem] font-medium text-[color:var(--fr-ink-55)]",
                    row.total && "font-semibold text-[color:var(--fr-ink)]",
                  )}
                >
                  {row.label}
                </th>
                {row.cells.map((raw, j) => {
                  const cell = asCell(raw);
                  const highlight = columns[j]?.highlight;
                  return (
                    <td key={j} className="px-5 py-4 align-top">
                      <span
                        className={cn(
                          "fr-mono-data block leading-snug text-[color:var(--fr-ink)]",
                          (row.total || highlight) && "font-semibold",
                        )}
                      >
                        {cell.value}
                      </span>
                      {cell.note ? (
                        <span className="font-body-mkt mt-1 block text-[0.75rem] leading-snug text-[color:var(--fr-ink-55)]">
                          {cell.note}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
