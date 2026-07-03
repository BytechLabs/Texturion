/**
 * BentoLiveSwitchStatic (iteration 5) — the server-rendered fallback for the
 * switchable live tile (REFERENCES craft #7). Renders the first panel ("Assign &
 * track") as a completed static thread with the ledger-row header and BOTH tab
 * labels visible (the first pre-selected), so the surface is meaningful and the
 * switch is discoverable with JS off / reduced-motion / before hydration. The
 * interactive island swaps in after first paint and makes the tabs live.
 *
 * Pure server DOM, no hooks. The tab buttons are inert here (real controls in
 * the island).
 */

import { cn } from "@/lib/utils";
import { StaticThread } from "@/components/marketing/thread-demo/static-thread";
import { StatusSpine, TicketMeta } from "@/components/marketing/ledger/ticket";
import { ASSIGN_TILE_SCRIPT } from "@/components/marketing/thread-demo/script";

const TABS = ["Assign & track", "Photos, both ways"] as const;

export function BentoLiveSwitchStatic() {
  return (
    <div className="flex h-full flex-col rounded-[10px] border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TABS.map((tab, i) => (
          <span
            key={tab}
            className={cn(
              "rounded-full px-3 py-1 text-[13px] font-medium",
              i === 0
                ? "bg-primary/10 text-teal-800 dark:text-primary"
                : "text-muted-foreground",
            )}
          >
            {tab}
          </span>
        ))}
      </div>

      <div className="flex-1">
        <div className="relative mb-2 overflow-hidden rounded-[8px] border border-border bg-card pl-2.5">
          <StatusSpine status="filed" />
          <div className="px-2.5 py-1.5">
            <TicketMeta id="#0119" status="filed" assignee="Dale" />
          </div>
        </div>

        <div className="min-h-[220px]">
          <StaticThread
            script={ASSIGN_TILE_SCRIPT}
            framing="desktop"
            bodyClassName="flex flex-col gap-3 px-3 py-4 min-h-[200px]"
          />
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-[17px] font-semibold text-foreground">
          Assign and track.
        </h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
          Every conversation has one owner and one status — new, open, waiting,
          or closed. At a glance, you know what&apos;s handled and what&apos;s
          not.
        </p>
        <p className="mt-3 rounded-lg bg-primary/5 px-3 py-2 text-[13px] leading-relaxed text-foreground">
          Two locations, or an office line and a field line? Pro gives you two
          separate numbers, each with its own inbox.
        </p>
      </div>
    </div>
  );
}
