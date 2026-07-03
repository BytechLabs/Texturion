/**
 * DispatchDeskStatic (iteration 5, HERO-CONCEPT §2, §3, §5).
 *
 * The server-rendered State-B (FILED) desk — a completed, filed, assigned,
 * done conversation. This is what the LCP paints beside the H1, what no-JS
 * paints, and what reduced-motion paints; it fully pitches on its own (§5: the
 * completed ticket is always the floor). The interactive island hydrates AFTER
 * first paint and only then resets to State A so the visitor can drive it.
 *
 * Pure DOM/CSS, no hooks — a plain server component. The ticket wears the ledger
 * status spine (petrol = resolved), the tabular ticket-meta line, and the FILED
 * stamp (present, un-animated here — the press only plays on the visitor's own
 * tap in the island).
 */

import { StatusSpine, TicketMeta } from "@/components/marketing/ledger/ticket";
import { FiledStamp } from "@/components/marketing/ledger/filed-stamp";

import { DEFAULT_ASSIGNEE, DISPATCH } from "./dispatch-data";
import { ResolvedConversation } from "./desk-parts";

export function DispatchDeskStatic() {
  return (
    <div className="relative">
      {/* Unfiled counter — resolved to 0 in the finished state. */}
      <div className="mb-3 flex items-center justify-between">
        <span className="jt-meta tabular-nums text-muted-foreground">
          Unfiled: 0
        </span>
        <FiledStamp />
      </div>

      {/* The filed ticket — square (no tilt), petrol spine, resolved meta. */}
      <div className="relative overflow-hidden rounded-[12px] border border-border bg-card pl-3 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]">
        <StatusSpine status="filed" />

        {/* Ticket header — the recurring ledger-row meta grammar (§2.1, #9). */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <TicketMeta
            id={DISPATCH.ticketId}
            status="filed"
            assignee={DEFAULT_ASSIGNEE.name}
            time={DISPATCH.filedTime}
          />
        </div>

        {/* The clean conversation. */}
        <div className="px-4 py-4">
          <ResolvedConversation assignee={DEFAULT_ASSIGNEE} drawn={false} />
        </div>
      </div>

      <p className="jt-meta mt-3 text-muted-foreground">
        {DISPATCH.resolvedCaption}
      </p>
    </div>
  );
}
