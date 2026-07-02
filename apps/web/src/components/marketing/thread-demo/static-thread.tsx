/**
 * <StaticThread> — the COMPLETED thread, rendered as pure server DOM.
 *
 * This is the LCP-safe, no-JS, reduced-motion, and pre-hydration frame for every
 * live thread demo (BLUEPRINT §3.1: "the server-render ships the completed
 * thread as static DOM so the LCP and the no-JS/reduced-motion experience are
 * both the finished, meaningful thread"). It reuses the exact same thread
 * primitives (ThreadFrame + bubbles) the interactive islands use, so the static
 * frame and the hydrated island are visually identical — the swap is seamless.
 *
 * It carries NO client runtime: no "use client", no timers, no player. That is
 * the whole point — it renders on the server, ships zero island JS, and lets
 * <LazyIsland> defer the animated version's download/eval until it's needed.
 * The animated island only ever *replays* this same finished state.
 */

import { ThreadFrame } from "./thread-frame";
import {
  EventLine,
  InboundBubble,
  NoteBubble,
  OutboundBubble,
} from "./thread-primitives";
import type { ThreadScript } from "./script";

export interface StaticThreadProps {
  script: ThreadScript;
  framing?: "desktop" | "phone";
  /** Push banner for the phone framing (dark band). */
  pushBanner?: { title: string; body: string };
  className?: string;
  /** Body min-height so the frame matches the animated island (CLS-safe). */
  bodyClassName?: string;
  /** Optional footer row (e.g. the deep-dive controls hint / honesty label). */
  footer?: React.ReactNode;
}

export function StaticThread({
  script,
  framing = "desktop",
  pushBanner,
  className,
  bodyClassName,
  footer,
}: StaticThreadProps) {
  return (
    <ThreadFrame
      framing={framing}
      contact={script.contact}
      status={script.finalStatus}
      assignee={script.assignee}
      pushBanner={pushBanner}
      className={className}
    >
      <div className={bodyClassName ?? "flex flex-col gap-3 px-3 py-4"}>
        {script.beats.map((beat) => {
          switch (beat.kind) {
            case "inbound":
              return <InboundBubble key={beat.id} beat={beat} />;
            case "outbound":
              return (
                <OutboundBubble key={beat.id} beat={beat} state={beat.delivered} />
              );
            case "note":
              return <NoteBubble key={beat.id} beat={beat} />;
            case "event":
              return <EventLine key={beat.id} beat={beat} />;
            default:
              return null;
          }
        })}
      </div>
      {footer}
    </ThreadFrame>
  );
}
