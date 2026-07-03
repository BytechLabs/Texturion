"use client";

/**
 * ThreadDemo (Track B), the shared live-thread component.
 *
 * The signature moment (BLUEPRINT §0.1): a real React component that renders a
 * JobText conversation in the app's visual language and animates a scripted
 * exchange on the app's motion grammar (200ms fade + 4px rise). Built ONCE,
 * parameterized by script, and reused by the hero (§3.1, autoplay), the §3.4
 * deep-dive (steppable), the dark band (§3.7), and bento tiles 1 & 5 (§3.6).
 *
 * - `mode="auto"`: plays once on viewport entry, then offers Replay (hero).
 * - `mode="static"`: renders the completed thread with a Play affordance
 *   (reduced-motion / no-JS fallback the server pre-renders, identical to what
 *   the LCP paints, §3.1).
 * Reduced motion collapses `auto` to `static` behavior automatically.
 */

import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { ThreadBeat, ThreadScript } from "./script";
import { ThreadFrame } from "./thread-frame";
import {
  EventLine,
  InboundBubble,
  NoteBubble,
  OutboundBubble,
} from "./thread-primitives";
import { useThreadPlayer } from "./use-thread-player";

/** One beat, wrapped in the reveal animation (opacity + 4px rise, G5). */
function Beat({
  beat,
  delivery,
  animate,
}: {
  beat: ThreadBeat;
  delivery: "sending" | "sent" | "delivered";
  /** When false (static/reduced), render at rest with no transition. */
  animate: boolean;
}) {
  return (
    <div
      className={cn(
        animate && "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 motion-safe:ease-out",
      )}
    >
      {beat.kind === "inbound" && <InboundBubble beat={beat} />}
      {beat.kind === "outbound" && (
        <OutboundBubble beat={beat} state={delivery} />
      )}
      {beat.kind === "note" && <NoteBubble beat={beat} />}
      {beat.kind === "event" && <EventLine beat={beat} />}
    </div>
  );
}

export interface ThreadDemoProps {
  script: ThreadScript;
  framing?: "desktop" | "phone";
  mode?: "auto";
  /** Push banner for the phone framing (dark band). */
  pushBanner?: { title: string; body: string };
  /** Extra classes for the frame. */
  className?: string;
  /** Body min-height so the reveal animates inside a reserved box (CLS-safe). */
  bodyClassName?: string;
  /** Hide the built-in controls (e.g. when a parent drives stepping). */
  hideControls?: boolean;
}

export function ThreadDemo({
  script,
  framing = "desktop",
  pushBanner,
  className,
  bodyClassName,
  hideControls,
}: ThreadDemoProps) {
  const [armed, setArmed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Arm on viewport entry (one-shot), the hero autoplays once when scrolled to.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    // Already (even partly) in view on mount, arm immediately. The hero sits
    // above the fold, so this fires without waiting on the observer, and a tall
    // frame never gets starved by a fractional threshold.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setArmed(true);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setArmed(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArmed(true);
          obs.disconnect();
        }
      },
      // Any intersection (a tall frame rarely reaches a high threshold at the
      // top of the page); the reveal box is already reserved so it's CLS-safe.
      { threshold: 0.01, rootMargin: "0px 0px -10% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const player = useThreadPlayer(script, { autoStart: true, armed });

  // Status advances to the script's final status once fully revealed.
  const status =
    player.revealed >= script.beats.length ? script.finalStatus : "new";
  const assignee =
    player.activeStep != null && player.activeStep >= 3
      ? script.assignee
      : undefined;

  const visibleBeats = script.beats.slice(0, player.revealed);

  return (
    <div ref={rootRef}>
      <ThreadFrame
        framing={framing}
        contact={script.contact}
        status={status}
        assignee={assignee}
        pushBanner={pushBanner}
        className={className}
      >
        <div
          className={cn(
            "flex flex-col gap-3 overflow-hidden px-3 py-4",
            bodyClassName,
          )}
        >
          {visibleBeats.map((beat) => (
            <Beat
              key={beat.id}
              beat={beat}
              delivery={
                beat.kind === "outbound"
                  ? (player.delivery[beat.id] ?? "sending")
                  : "delivered"
              }
              // Animate only while actively playing forward (not on the
              // static/reduced first paint).
              animate={player.playing || player.revealed < script.beats.length}
            />
          ))}
        </div>

        {!hideControls && (
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
            <span className="text-[12px] text-muted-foreground">
              {player.complete
                ? "That's the whole conversation."
                : player.playing
                  ? "Playing…"
                  : "A text just landed."}
            </span>
            <ThreadControls player={player} />
          </div>
        )}
      </ThreadFrame>
    </div>
  );
}

function ThreadControls({
  player,
}: {
  player: ReturnType<typeof useThreadPlayer>;
}) {
  if (player.complete) {
    return (
      <button
        type="button"
        onClick={player.replay}
        className="tap-target inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden />
        Play it again
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={player.playing ? player.pause : player.play}
      aria-label={player.playing ? "Pause the demo" : "Play the demo"}
      className="tap-target inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {player.playing ? (
        <>
          <Pause className="size-3.5" strokeWidth={1.75} aria-hidden />
          Pause
        </>
      ) : (
        <>
          <Play className="size-3.5" strokeWidth={1.75} aria-hidden />
          Play
        </>
      )}
    </button>
  );
}
