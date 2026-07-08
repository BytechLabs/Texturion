"use client";

/**
 * Thread deep-dive, home §S4 "The fix, shown" (v4 "FIRST RESPONSE").
 *
 * Slows the canonical water-heater conversation down and annotates the
 * mechanics: the reader steps the beats and the left-column captions
 * highlight in sync. The island MOUNTS in the completed state, pixel-equal to
 * the server-rendered <ThreadDeepDiveStatic>, so the swap never moves layout;
 * "Step through it" restarts the conversation at beat one. Reduced motion
 * keeps the completed thread and renders no step controls.
 *
 * The thread renders inside the foundation <PanelFrame> so the product keeps
 * its own tokens (Law 2); the step controls are marketing chrome and live
 * OUTSIDE the frame, in cobalt. The only label is the SCRIPTED DEMO chip
 * (Law 1), which the PanelFrame carries.
 */

import { ChevronRight, Play, RotateCcw } from "lucide-react";
import { useState } from "react";

import { PanelFrame } from "@/components/marketing/fr";
import { cn } from "@/lib/utils";

import type { ThreadBeat, ThreadScript } from "./script";
import { ThreadFrame } from "./thread-frame";
import {
  DEEP_DIVE_BODY_CLASSES,
  DEEP_DIVE_CAPTIONS,
  DeepDiveCaption,
  DeepDiveHeader,
  DeepDiveInlineCta,
} from "./thread-deep-dive-static";
import {
  EventLine,
  InboundBubble,
  NoteBubble,
  OutboundBubble,
} from "./thread-primitives";
import { useReducedMotion } from "./use-reduced-motion";

function Beat({ beat, animate }: { beat: ThreadBeat; animate: boolean }) {
  return (
    <div
      className={cn(
        animate &&
          "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 motion-safe:ease-out",
      )}
    >
      {beat.kind === "inbound" && <InboundBubble beat={beat} />}
      {beat.kind === "outbound" && (
        <OutboundBubble beat={beat} state={beat.delivered} />
      )}
      {beat.kind === "note" && <NoteBubble beat={beat} />}
      {beat.kind === "event" && <EventLine beat={beat} />}
    </div>
  );
}

const STEP_BUTTON =
  "font-body-mkt inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-semibold transition-colors duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]";

export function ThreadDeepDive({ script }: { script: ThreadScript }) {
  const reduced = useReducedMotion();
  const total = script.beats.length;
  // Mount complete (identical to the static frame); stepping is opt-in.
  const [revealed, setRevealed] = useState(total);
  const [engaged, setEngaged] = useState(false);

  const visible = script.beats.slice(0, revealed);
  const done = revealed >= total;

  // Active caption = highest step among revealed beats.
  let activeStep: number | null = null;
  for (let i = 0; i < revealed && i < total; i++) {
    const s = script.beats[i].step;
    if (s != null) activeStep = s;
  }

  const status = done ? script.finalStatus : "new";
  const assignee =
    activeStep != null && activeStep >= 3 ? script.assignee : undefined;

  const start = () => {
    setEngaged(true);
    setRevealed(1);
  };
  const advance = () => setRevealed((r) => Math.min(r + 1, total));

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-12">
      {/* Left: sticky captions, sync-highlighted while stepping. */}
      <div className="lg:sticky lg:top-28">
        <DeepDiveHeader />
        <ol className="mt-8 space-y-1">
          {DEEP_DIVE_CAPTIONS.map((caption, i) => {
            const step = i + 1;
            const state = !engaged
              ? "rest"
              : activeStep === step
                ? "active"
                : activeStep != null && step < activeStep
                  ? "past"
                  : "rest";
            return (
              <DeepDiveCaption
                key={caption}
                step={step}
                caption={caption}
                state={state}
              />
            );
          })}
        </ol>
      </div>

      {/* Right: the annotated, steppable thread inside the product frame. */}
      <div>
        <PanelFrame
          chromeUrl="loonext.com/inbox"
          chip="scripted-demo"
          ariaLabel="A Reyes Plumbing conversation in the Loonext inbox"
        >
          <ThreadFrame
            framing="desktop"
            contact={script.contact}
            status={status}
            assignee={assignee}
          >
            <div className={DEEP_DIVE_BODY_CLASSES}>
              {visible.map((beat, i) => (
                <Beat
                  key={beat.id}
                  beat={beat}
                  animate={!reduced && engaged && i === revealed - 1}
                />
              ))}
            </div>
          </ThreadFrame>
        </PanelFrame>

        {/* Marketing controls, OUTSIDE the frame (cobalt is the marketing
            voice; it never enters the product embed). */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <DeepDiveInlineCta />
          {!reduced &&
            (!engaged || done ? (
              <button
                type="button"
                onClick={start}
                className={cn(
                  STEP_BUTTON,
                  engaged
                    ? "text-[color:var(--fr-cobalt)] hover:bg-[color:var(--fr-frost)]"
                    : "bg-[color:var(--fr-cobalt)] text-white hover:bg-[color:var(--fr-cobalt-deep)]",
                )}
              >
                {engaged ? (
                  <>
                    <RotateCcw
                      className="size-3.5"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    Play it again
                  </>
                ) : (
                  <>
                    <Play className="size-3.5" strokeWidth={1.75} aria-hidden />
                    Step through it
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={advance}
                className={cn(
                  STEP_BUTTON,
                  "bg-[color:var(--fr-cobalt)] text-white hover:bg-[color:var(--fr-cobalt-deep)]",
                )}
              >
                Next
                <ChevronRight
                  className="size-3.5"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

export default ThreadDeepDive;
