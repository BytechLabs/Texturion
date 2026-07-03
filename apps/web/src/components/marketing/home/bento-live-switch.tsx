"use client";

/**
 * BentoLiveSwitch (iteration 5, REFERENCES craft #7 / ELEVATE #5, anti-bland #7).
 *
 * The back-half participatory switch: instead of two static live-thread crops,
 * the visitor toggles ONE anchored panel between "Assign & track" and "Photos,
 * both ways" — Clay's "let the visitor drive one thing" applied after the dark
 * band so the second half stays driven, not read. Each panel is the SAME ledger
 * row grammar (ID + status spine + assignee) as the hero and deep-dive (#9), so
 * the product surface reads as one instrument.
 *
 * PERF: it renders both threads as static DOM (StaticThread — no player, no
 * timers) and just cross-fades which is visible; this is a tiny island (state =
 * one index) with no thread-player runtime. Server-renders the first panel as
 * the fallback (BentoLiveSwitchStatic), so no-JS / reduced-motion / pre-hydration
 * all get a meaningful live surface. CLS-safe: a reserved min-height box.
 */

import { useState } from "react";

import { cn } from "@/lib/utils";
import { StaticThread } from "@/components/marketing/thread-demo/static-thread";
import { StatusSpine, TicketMeta } from "@/components/marketing/ledger/ticket";
import {
  ASSIGN_TILE_SCRIPT,
  PHOTOS_TILE_SCRIPT,
} from "@/components/marketing/thread-demo/script";

const PANELS = [
  {
    key: "assign",
    tab: "Assign & track",
    script: ASSIGN_TILE_SCRIPT,
    id: "#0119",
    meta: { status: "filed", assignee: "Dale" },
    title: "Assign and track.",
    body:
      "Every conversation has one owner and one status — new, open, waiting, or closed. At a glance, you know what's handled and what's not.",
  },
  {
    key: "photos",
    tab: "Photos, both ways",
    script: PHOTOS_TILE_SCRIPT,
    id: "#0123",
    meta: { status: "closed", assignee: "Dale" },
    title: "Photos, both ways.",
    body:
      "Customers text you a picture of the problem; you text back a photo of the finished job. Receiving photos is always free.",
  },
] as const;

export function BentoLiveSwitch() {
  const [active, setActive] = useState(0);
  const panel = PANELS[active];

  return (
    <div className="flex h-full flex-col rounded-[10px] border border-border bg-card p-5">
      {/* The switch — the participatory control, framed as ledger tabs. */}
      <div
        className="mb-3 flex flex-wrap gap-1.5"
        role="tablist"
        aria-label="Live inbox examples"
      >
        {PANELS.map((p, i) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "tap-target rounded-full px-3 py-1 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              i === active
                ? "bg-primary/10 text-teal-800 dark:text-primary"
                : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {p.tab}
          </button>
        ))}
      </div>

      <div className="flex-1">
        {/* The recurring ledger-row header — same grammar as hero/deep-dive. */}
        <div className="relative mb-2 overflow-hidden rounded-[8px] border border-border bg-card pl-2.5">
          <StatusSpine status={panel.meta.status === "filed" ? "filed" : "muted"} />
          <div className="px-2.5 py-1.5">
            <TicketMeta
              id={panel.id}
              status={panel.meta.status}
              assignee={panel.meta.assignee}
            />
          </div>
        </div>

        <div className="min-h-[220px] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200" key={panel.key}>
          <StaticThread
            script={panel.script}
            framing="desktop"
            bodyClassName="flex flex-col gap-3 px-3 py-4 min-h-[200px]"
          />
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-[17px] font-semibold text-foreground">
          {panel.title}
        </h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
          {panel.body}
        </p>
        {active === 0 && (
          <p className="mt-3 rounded-lg bg-primary/5 px-3 py-2 text-[13px] leading-relaxed text-foreground">
            Two locations, or an office line and a field line? Pro gives you two
            separate numbers, each with its own inbox.
          </p>
        )}
      </div>
    </div>
  );
}

export default BentoLiveSwitch;
