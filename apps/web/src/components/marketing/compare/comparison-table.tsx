/**
 * Comparison-table component (compare track, BLUEPRINT §6), the per-row
 * side-by-side table used by all three /compare/* pages.
 *
 * Design rules baked in so every page stays honest by construction:
 * - The Loonext column is visually distinguished (petrol header, tinted body)
 *   but never louder than the facts; the competitor column header carries the
 *   "as of July 2026" stamp so the dating is impossible to miss (§6).
 * - EVERY cell is a `Cell`: a plain string OR a value plus an optional `note`
 *   (the per-cell source / assumption). Notes render as small muted text under
 *   the value, this is the mechanism that makes per-cell sourcing (§13.7)
 *   structural, not a footnote a writer might forget.
 * - `emphasis` on a cell marks the "advantage" value (petrol, medium weight) so
 *   the Loonext win reads at a glance without inventing a checkmark the fact
 *   can't support.
 * - Horizontal scroll is contained (§ page body never scrolls horizontally).
 *
 * No fabricated head-to-head stats live here, the component only renders what
 * the page passes it, and every page's data is traced in the source list.
 * Server component (no interactivity).
 */

import { cn } from "@/lib/utils";

export interface Cell {
  /** The value shown in the cell, e.g. "$29/mo flat" or "Not published". */
  value: string;
  /** Per-cell source or assumption, rendered small + muted under the value. */
  note?: string;
  /** Marks the standout value in the row (petrol, medium weight). */
  emphasis?: boolean;
}

export interface ComparisonRow {
  /** Row label (the dimension being compared), e.g. "Price". */
  label: string;
  /** Loonext's cell (truthful to SPEC §1–2). */
  loonext: Cell;
  /** The competitor's cell (dated + sourced). */
  competitor: Cell;
}

function CellContent({ cell }: { cell: Cell }) {
  return (
    <>
      <span
        className={cn(
          "block text-[14px] leading-snug tabular-nums",
          cell.emphasis
            ? "font-semibold text-[color:var(--petrol)]"
            : "font-medium text-[color:var(--ink)]",
        )}
      >
        {cell.value}
      </span>
      {cell.note && (
        <span className="mt-1 block text-[12px] leading-snug text-[color:var(--ink-70)]">
          {cell.note}
        </span>
      )}
    </>
  );
}

export function ComparisonTable({
  competitorName,
  rows,
  /** Stamp shown under the competitor header; dated per §6. */
  asOf = "as of July 2026",
  /** When true, adds an sr-only <caption> naming the comparison + date. */
  caption = false,
}: {
  competitorName: string;
  rows: ComparisonRow[];
  asOf?: string;
  caption?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[color:var(--hairline)]">
      <table className="w-full min-w-[640px] border-collapse text-left">
        {caption && (
          <caption className="sr-only">
            {`Loonext compared with ${competitorName}, ${asOf}.`}
          </caption>
        )}
        <thead>
          <tr className="border-b border-[color:var(--hairline)]">
            <th
              scope="col"
              className="w-[26%] p-4 text-[13px] font-medium text-[color:var(--graphite)]"
            >
              {/* dimension column, intentionally unlabeled header */}
            </th>
            <th
              scope="col"
              className="w-[37%] border-l border-[color:var(--hairline)] bg-[color:var(--petrol-12)] p-4 align-top"
            >
              <span className="block text-[15px] font-semibold text-[color:var(--petrol)]">
                Loonext
              </span>
              {/* A descriptor sub-label, NOT a table figure, so Public Sans per
                  §3 (mono is figures/prices/timestamps only), not Martian Mono. */}
              <span className="font-body-mkt mt-0.5 block text-[12px] font-normal text-[color:var(--graphite)]">
                shared text inbox
              </span>
            </th>
            <th
              scope="col"
              className="w-[37%] border-l border-[color:var(--hairline)] p-4 align-top"
            >
              <span className="block text-[15px] font-semibold text-[color:var(--ink)]">
                {competitorName}
              </span>
              <span className="font-mono-mkt mt-0.5 block text-[12px] font-normal text-[color:var(--graphite)]">
                {asOf}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              className="border-b border-[color:var(--hairline)] last:border-b-0"
            >
              <th
                scope="row"
                className="p-4 align-top text-[13px] font-medium text-[color:var(--graphite)]"
              >
                {row.label}
              </th>
              <td className="border-l border-[color:var(--hairline)] bg-[color:var(--petrol-12)] p-4 align-top">
                <CellContent cell={row.loonext} />
              </td>
              <td className="border-l border-[color:var(--hairline)] p-4 align-top">
                <CellContent cell={row.competitor} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
