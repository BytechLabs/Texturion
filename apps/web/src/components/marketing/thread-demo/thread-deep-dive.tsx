"use client";

/**
 * Thread deep-dive (Track B), §3.4 "What actually happens when a text lands".
 *
 * Not a second hero: the hero autoplays the spectacle; this slows the SAME
 * story down and annotates the mechanics (BLUEPRINT panel resolution). Reuses
 * the exact thread primitives; the reader steps the beats (or, reduced-motion,
 * sees them all at rest) and the left-column captions highlight in sync.
 *
 * The captions are the COPY.md §H4 step captions, verbatim.
 */

import { ChevronRight, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { Display } from "@/components/marketing/display";

import type { ThreadBeat, ThreadScript } from "./script";
import { ThreadFrame } from "./thread-frame";
import {
  EventLine,
  InboundBubble,
  NoteBubble,
  OutboundBubble,
} from "./thread-primitives";
import { useReducedMotion } from "./use-thread-player";

const CAPTIONS = [
  "A text to your business number becomes a conversation everyone can see.",
  "Leave a note for the team, customers never see notes.",
  "Assign it to whoever's closest. One owner, no double replies.",
  "Reply from any phone. Delivery is confirmed, in writing.",
  "Tag it the way you sell: quote sent, scheduled, won.",
] as const;

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

export function ThreadDeepDive({ script }: { script: ThreadScript }) {
  const reduced = useReducedMotion();
  const total = script.beats.length;
  // Reduced motion: reveal everything at rest immediately.
  const [revealed, setRevealed] = useState(total);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // With motion allowed, start at the first beat so the reader can step.
    setRevealed(reduced ? total : 1);
  }, [reduced, total]);

  const visible = script.beats.slice(0, revealed);
  const done = revealed >= total;

  // Active caption = highest step among revealed beats.
  let activeStep: number | null = null;
  for (let i = 0; i < revealed && i < total; i++) {
    const s = script.beats[i].step;
    if (s != null) activeStep = s;
  }

  const status = done ? script.finalStatus : "new";
  const assignee = activeStep != null && activeStep >= 3 ? script.assignee : undefined;

  const advance = () => {
    setRevealed((r) => {
      const next = Math.min(r + 1, total);
      // Keep the newest beat in view.
      requestAnimationFrame(() => {
        bodyRef.current?.scrollTo({
          top: bodyRef.current.scrollHeight,
          behavior: reduced ? "auto" : "smooth",
        });
      });
      return next;
    });
  };

  const restart = () => setRevealed(1);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-12">
      {/* Left: sticky captions */}
      <div className="lg:sticky lg:top-28">
        <p className="font-mono-mkt text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
          See it work
        </p>
        <Display as="h2" size="h2" className="mt-3">
          What happens when a text{" "}
          <Display.Mark>lands</Display.Mark>.
        </Display>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-[color:var(--ink-70)]">
          Here is the same conversation, slowed down. A customer texts your
          business number, and step by step, this is what your crew sees and
          does: assign it, note it, reply, confirm, tag.
        </p>

        <ol className="mt-8 space-y-1">
          {CAPTIONS.map((caption, i) => {
            const step = i + 1;
            const isActive = activeStep === step;
            const isPast = activeStep != null && step < activeStep;
            return (
              <li
                key={caption}
                className={cn(
                  "flex gap-3 rounded-lg px-3 py-2.5 transition-colors duration-200",
                  isActive && "bg-[color:var(--petrol-12)]/50",
                )}
              >
                <span
                  className={cn(
                    "font-mono-mkt mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums transition-colors duration-200",
                    isActive || isPast
                      ? "bg-[color:var(--petrol)] text-white"
                      : "bg-[color:var(--petrol-12)] text-[color:var(--petrol)]",
                  )}
                  aria-hidden
                >
                  {step}
                </span>
                <span
                  className={cn(
                    "text-[15px] leading-snug transition-colors duration-200",
                    isActive
                      ? "font-medium text-[color:var(--ink)]"
                      : "text-[color:var(--ink-70)]",
                  )}
                >
                  {caption}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Right: the annotated, steppable thread */}
      <div>
        <ThreadFrame
          framing="desktop"
          contact={script.contact}
          status={status}
          assignee={assignee}
        >
          <div
            ref={bodyRef}
            className="flex max-h-[420px] flex-col gap-3 overflow-y-auto px-3 py-4"
          >
            {visible.map((beat, i) => (
              <Beat
                key={beat.id}
                beat={beat}
                animate={!reduced && i === revealed - 1 && revealed > 1}
              />
            ))}
          </div>
          <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              {/* The ONE load-bearing honesty label (panel resolution). Muted
                  per §3.4, but stone-500/400 (not stone-400/500) so it clears
                  WCAG AA 4.5:1 in both themes (G11), a Lighthouse
                  color-contrast finding; a load-bearing label must be legible. */}
              <span className="text-[13px] text-stone-500 dark:text-stone-400">
                Demo, scripted conversation, real interface.
              </span>
              {!reduced &&
                (done ? (
                  <button
                    type="button"
                    onClick={restart}
                    className="tap-target inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden />
                    Play it again
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={advance}
                    className="tap-target inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary/5 px-3 py-1 text-[13px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {revealed === 1 ? (
                      <>
                        <Play className="size-3.5" strokeWidth={1.75} aria-hidden />
                        Step through it
                      </>
                    ) : (
                      <>
                        Next
                        <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden />
                      </>
                    )}
                  </button>
                ))}
            </div>
            {/* Inline CTA, closes the mid-page dead zone (§3.4), secondary weight. */}
            <a
              href="/signup"
              className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
            >
              Get your number →
            </a>
          </div>
        </ThreadFrame>
      </div>
    </div>
  );
}
