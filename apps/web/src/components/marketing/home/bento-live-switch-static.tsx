/**
 * BentoLiveSwitchStatic, the server-rendered fallback for the switchable live
 * tile. Renders the first panel ("Assign & track") as a completed static thread
 * with both tab labels visible (the first pre-selected), so the surface is
 * meaningful and the switch is discoverable with JS off / reduced-motion /
 * before hydration. The interactive island swaps in after first paint.
 *
 * DESIGN-DIRECTION §0: no ledger-row header, no `#0119 · filed` ticket costume.
 * The real product state lives in the thread frame itself (status pill,
 * assignee). Pure server DOM, no hooks. The tab buttons are inert here.
 */

import { cn } from "@/lib/utils";
import { StaticThread } from "@/components/marketing/thread-demo/static-thread";
import { ASSIGN_TILE_SCRIPT } from "@/components/marketing/thread-demo/script";

const TABS = ["Assign & track", "Photos, both ways"] as const;

export function BentoLiveSwitchStatic() {
  return (
    <div className="panel-card flex h-full flex-col rounded-[14px] p-5">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TABS.map((tab, i) => (
          <span
            key={tab}
            className={cn(
              "font-mono-mkt rounded-full px-3 py-1 text-[13px] font-medium",
              i === 0
                ? "bg-[color:var(--petrol-12)] text-[color:var(--deep)]"
                : "text-[color:var(--graphite)]",
            )}
          >
            {tab}
          </span>
        ))}
      </div>

      <div className="flex-1">
        <div className="min-h-[220px]">
          <StaticThread
            script={ASSIGN_TILE_SCRIPT}
            framing="desktop"
            bodyClassName="flex flex-col gap-3 px-3 py-4 min-h-[200px]"
          />
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-[17px] font-semibold text-[color:var(--ink)]">
          Assign and track.
        </h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-[color:var(--ink-70)]">
          Every conversation has one owner and one status: new, open, waiting,
          or closed. At a glance, you know what&apos;s handled and what&apos;s
          not.
        </p>
        <p className="mt-3 rounded-lg bg-[color:var(--petrol-12)]/50 px-3 py-2 text-[13px] leading-relaxed text-[color:var(--ink)]">
          Two locations, or an office line and a field line? Pro gives you two
          separate numbers, each with its own inbox.
        </p>
      </div>
    </div>
  );
}
