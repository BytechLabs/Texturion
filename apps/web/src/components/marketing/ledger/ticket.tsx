/**
 * Ticket / status-spine motif primitives (iteration 5, ART-DIRECTION §2).
 *
 * The job-ticket grammar is the brand fingerprint (REFERENCES §1.3, anti-bland
 * #6): a card with a thin petrol "status spine" down the left edge, a tabular
 * ticket-meta line (ID + timestamp + assignee), and — on genuine product-state
 * changes only — the FILED stamp. These are the pieces that recur across the
 * hero, the deep-dive, the bento, and the dark band so twelve sections read as
 * ONE instrument.
 *
 * Anti-fatigue (§2.3): the status-spine and stamp are reserved for real product
 * moments; plain copy cards stay border-only. Server components (no JS).
 */

import { cn } from "@/lib/utils";

/** Status → spine color (§2.1): amber = unresolved, petrol = resolved. */
type SpineStatus = "unfiled" | "filed" | "muted";

const SPINE_COLOR: Record<SpineStatus, string> = {
  unfiled: "bg-amber-400 dark:bg-amber-500",
  filed: "bg-primary",
  muted: "bg-stone-300 dark:bg-stone-700",
};

/**
 * The status spine — a 2px vertical rule down a ticket's left edge. The single
 * most repeated brand element (§2.1). Rendered inside a `relative` ticket.
 */
export function StatusSpine({
  status,
  className,
}: {
  status: SpineStatus;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute inset-y-0 left-0 w-[2px] rounded-l-[10px] transition-colors duration-200",
        SPINE_COLOR[status],
        className,
      )}
    />
  );
}

/**
 * The tabular ticket-meta line (§2.1): a mono-flavored ID, a timestamp, and an
 * assignee — all in the 13px tabular ledger-meta style. This is the recurring
 * ledger-row identity carried across every product surface (REFERENCES #9).
 * Segments are joined with a middot; every field is tabular.
 */
export function TicketMeta({
  id,
  status,
  assignee,
  time,
  className,
}: {
  /** e.g. "#0119" — reuses the seed number range (§2.1). */
  id: string;
  /** e.g. "filed" / "new" — the felt-not-named ledger state. */
  status?: string;
  /** e.g. "Dale" — the assignee first name. */
  assignee?: string;
  /** e.g. "2:14 PM". */
  time?: string;
  className?: string;
}) {
  const parts = [id, status, assignee, time].filter(Boolean) as string[];
  return (
    <p
      className={cn(
        "jt-meta tabular-nums text-muted-foreground",
        className,
      )}
    >
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden className="px-1.5 text-stone-300 dark:text-stone-600">·</span>}
          <span className={i === 0 ? "text-foreground/70" : undefined}>{part}</span>
        </span>
      ))}
    </p>
  );
}

/**
 * A ledger row: a bordered white ticket wearing its status spine, ready to hold
 * a header (meta) and content. The recurring product-surface shell (§2, #9).
 */
export function LedgerRow({
  status = "filed",
  className,
  children,
}: {
  status?: SpineStatus;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[10px] border border-border bg-card pl-3",
        className,
      )}
    >
      <StatusSpine status={status} />
      {children}
    </div>
  );
}
