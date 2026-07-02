/**
 * TradeThread (trades track) — a STATIC, server-rendered thread that reuses the
 * heroperf-owned thread primitives (thread-demo/thread-primitives + thread-frame)
 * as read-only building blocks, and adds the ONE thing the shared ThreadDemo
 * can't show: the D14 mark-done state (line-through + petrol check badge).
 *
 * The animated live thread on each trade page is the shared <ThreadDemo> (the
 * signature moment, reused). This component is the trades-owned static
 * illustration used specifically by /for/contractors to make the
 * "each text is a task the crew marks done" scenario concrete (DECISIONS D14 —
 * the message itself is the task; there is NO jobs feature). It renders the
 * completed thread at rest with a plain "Example — real interface" label, so it
 * needs no client JS.
 *
 * Done-state tokens match the app's real DoneBadge (components/thread/
 * message-bubble.tsx): text `line-through opacity-55`, a `bg-primary/10`
 * petrol check pill with the "Done · Name · time" tooltip text.
 */

import { CircleCheck } from "lucide-react";

import type {
  InboundBeat,
  NoteBeat,
  OutboundBeat,
  ThreadScript,
} from "@/components/marketing/thread-demo/script";
import { ThreadFrame } from "@/components/marketing/thread-demo/thread-frame";
import {
  EventLine,
  InboundBubble,
  NoteBubble,
  OutboundBubble,
} from "@/components/marketing/thread-demo/thread-primitives";
import { cn } from "@/lib/utils";

/** The petrol check badge a done message carries (D14, matches the app). */
function DoneBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
      title={label}
    >
      <CircleCheck aria-hidden className="size-3" strokeWidth={2} />
      {label}
    </span>
  );
}

/**
 * A done wrapper: dims + strikes through the primitive's bubble and appends the
 * D14 badge. We overlay the strikethrough via a utility on the wrapper so we
 * don't need to fork the shared bubble primitives (they stay heroperf-owned).
 */
function DoneWrap({
  children,
  label,
  align,
}: {
  children: React.ReactNode;
  label: string;
  align: "start" | "end";
}) {
  return (
    <div className="flex flex-col gap-1">
      {/* Dim the whole beat and strike through only the message text. The
          shared bubble primitives put message text in a `.break-words` div
          (never the timestamp/delivery line), so this selector strikes the
          copy without touching the meta — matching the app's D14 treatment. */}
      <div className="opacity-55 [&_.break-words]:line-through">{children}</div>
      <div className={cn("flex", align === "end" ? "justify-end" : "justify-start")}>
        <DoneBadge label={label} />
      </div>
    </div>
  );
}

export interface TradeThreadProps {
  script: ThreadScript;
  framing?: "desktop" | "phone";
  /** Beat ids to render in the D14 done state. */
  doneIds?: readonly string[];
  /** Per-beat done-badge label ("Done · Name · time"). */
  doneLabels?: Record<string, string>;
  className?: string;
  bodyClassName?: string;
}

export function TradeThread({
  script,
  framing = "desktop",
  doneIds = [],
  doneLabels = {},
  className,
  bodyClassName,
}: TradeThreadProps) {
  const doneSet = new Set(doneIds);

  return (
    <ThreadFrame
      framing={framing}
      contact={script.contact}
      status={script.finalStatus}
      assignee={script.assignee}
      className={className}
    >
      <div className={cn("flex flex-col gap-3 px-3 py-4", bodyClassName)}>
        {script.beats.map((beat) => {
          const done = doneSet.has(beat.id);
          const label = doneLabels[beat.id] ?? "Done";

          if (beat.kind === "event") {
            return <EventLine key={beat.id} beat={beat} />;
          }

          let bubble: React.ReactNode;
          let align: "start" | "end" = "start";
          if (beat.kind === "inbound") {
            bubble = <InboundBubble beat={beat as InboundBeat} />;
            align = "start";
          } else if (beat.kind === "outbound") {
            bubble = (
              <OutboundBubble
                beat={beat as OutboundBeat}
                state={(beat as OutboundBeat).delivered}
              />
            );
            align = "end";
          } else {
            bubble = <NoteBubble beat={beat as NoteBeat} />;
            align = "end";
          }

          if (!done) return <div key={beat.id}>{bubble}</div>;
          return (
            <DoneWrap key={beat.id} label={label} align={align}>
              {bubble}
            </DoneWrap>
          );
        })}
      </div>

      <div className="border-t border-border px-3 py-2">
        <span className="text-[12px] text-muted-foreground">
          Example — real interface. Tap any message to mark it done; the whole
          crew sees what&apos;s handled.
        </span>
      </div>
    </ThreadFrame>
  );
}
