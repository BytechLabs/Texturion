"use client";

/**
 * CaughtThread, the interactive "catch" island (DESIGN-DIRECTION §3 Signature,
 * §5 Motion). The page's one orchestrated motion moment: the customer message
 * arrives, then a crew name ATTACHES (the claim), then the reply lands. It plays
 * ONCE on load and is the page's whole motion budget.
 *
 * Reduced motion (§5): renders the caught state statically, immediately, no
 * replay. The static server frame (CaughtThreadStatic) is identical to the
 * finished state here, so the swap is invisible; this island only adds the
 * one-time staged reveal for motion users, plus a quiet "Play it again" replay.
 *
 * Built from the same thread shape as the static frame (one frame language, §4).
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { CAUGHT } from "./caught-data";

type Stage = 0 | 1 | 2 | 3; // 0 none, 1 inbound, 2 claim, 3 reply

function Avatar({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-full bg-[color:var(--petrol)] text-[11px] font-semibold text-white",
        className,
      )}
    >
      {initials}
    </span>
  );
}

const RISE = "transition-[opacity,transform] duration-300 ease-out";

export function CaughtThread() {
  // Default to the fully-caught state so SSR/first-mount matches the static
  // frame and reduced-motion users see it immediately.
  const [stage, setStage] = useState<Stage>(3);
  const timers = useRef<number[]>([]);

  const play = () => {
    // Respect reduced motion: jump straight to the finished state.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStage(3);
      return;
    }
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStage(0);
    timers.current.push(
      window.setTimeout(() => setStage(1), 120),
      window.setTimeout(() => setStage(2), 900),
      window.setTimeout(() => setStage(3), 1600),
    );
  };

  useEffect(() => {
    play();
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  const show = (min: Stage) => stage >= min;

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-[14px] border border-[color:var(--hairline)] bg-[color:var(--card,#fff)] shadow-[0_24px_64px_-34px_rgba(11,79,73,0.4)]">
        <div className="flex items-center justify-between gap-2 border-b border-[color:var(--hairline)] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Avatar initials={CAUGHT.customer.initials} />
            <div className="leading-tight">
              <p className="text-[14px] font-semibold text-[color:var(--ink)]">
                {CAUGHT.customer.name}
              </p>
              <p className="font-mono-mkt text-[12px] text-[color:var(--graphite)]">
                {CAUGHT.customer.number}
              </p>
            </div>
          </div>
          <span className="font-mono-mkt text-[12px] text-[color:var(--graphite)]">
            {CAUGHT.inboundTime}
          </span>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div
            className={cn(
              "max-w-[86%]",
              RISE,
              show(1) ? "opacity-100" : "translate-y-1 opacity-0",
            )}
          >
            <div className="rounded-[4px_16px_16px_16px] bg-[color:var(--paper)] px-3.5 py-2.5 text-[15px] leading-snug text-[color:var(--ink)]">
              {CAUGHT.inbound}
            </div>
          </div>

          <div
            className={cn(
              "flex items-center gap-2 py-0.5 text-[13px] text-[color:var(--graphite)]",
              RISE,
              show(2) ? "opacity-100" : "translate-y-1 opacity-0",
            )}
          >
            <Avatar initials={CAUGHT.crew.initials} className="size-5 text-[9px]" />
            <span>
              <span className="font-semibold text-[color:var(--deep)]">
                {CAUGHT.crew.name}
              </span>{" "}
              claimed this. On it.
            </span>
          </div>

          <div
            className={cn(
              "ml-auto max-w-[86%]",
              RISE,
              show(3) ? "opacity-100" : "translate-y-1 opacity-0",
            )}
          >
            <div className="rounded-[16px_4px_16px_16px] bg-[color:var(--deep)] px-3.5 py-2.5 text-[15px] leading-snug text-white">
              {CAUGHT.reply}
            </div>
            <p className="mt-1 pr-1 text-right font-mono-mkt text-[11px] text-[color:var(--graphite)]">
              {CAUGHT.replyTime} · Delivered
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="font-mono-mkt text-[13px] text-[color:var(--graphite)]">
          {CAUGHT.caption}
        </p>
        <button
          type="button"
          onClick={play}
          className="font-mono-mkt shrink-0 rounded-[6px] px-2 py-1 text-[12px] font-medium text-[color:var(--petrol)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--petrol)]"
        >
          Play it again
        </button>
      </div>
    </div>
  );
}
