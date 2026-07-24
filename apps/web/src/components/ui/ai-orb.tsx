"use client";

import { cn } from "@/lib/utils";

/**
 * THE AI MARK. Every AI surface in the product wears this and nothing else —
 * reply drafting, task address and due-date inference, and anything added
 * later. One shape, one motion vocabulary, so a crew learns "this is the
 * assistant" once and recognizes it everywhere.
 *
 * It is a ring of dots, not a sparkle. Sparkles are what every other product
 * uses; a dotted orb is ours, it reads at 14px, and it animates honestly:
 *
 *   idle      the ring rests, dots evenly lit. Nothing is happening.
 *   thinking  dots brighten in sequence around the ring, a pulse travelling —
 *             the model is deciding.
 *   working   the whole ring rotates. Something is being produced.
 *   done      the ring settles to a single brief bloom.
 *
 * Motion is CSS only (no JS ticker, no layout thrash) and is dropped entirely
 * under prefers-reduced-motion, where each state is still distinguishable by
 * opacity alone.
 */
export type AiOrbState = "idle" | "thinking" | "working" | "done";

const DOTS = 8;

export function AiOrb({
  state = "idle",
  size = 18,
  className,
}: {
  state?: AiOrbState;
  /** Pixel box. 14–16 inside dense controls, 18–22 as a standalone mark. */
  size?: number;
  className?: string;
}) {
  const radius = size / 2 - size * 0.11;
  const dot = Math.max(size * 0.13, 2);

  return (
    <span
      className={cn("ai-orb relative inline-block shrink-0", className)}
      data-state={state}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {Array.from({ length: DOTS }, (_, index) => {
        const angle = (index / DOTS) * 2 * Math.PI - Math.PI / 2;
        return (
          <span
            key={index}
            className="ai-orb-dot"
            style={{
              width: dot,
              height: dot,
              left: `calc(50% + ${Math.cos(angle) * radius}px - ${dot / 2}px)`,
              top: `calc(50% + ${Math.sin(angle) * radius}px - ${dot / 2}px)`,
              // Each dot's turn in the travelling pulse.
              animationDelay: `${(index / DOTS) * 1.1}s`,
            }}
          />
        );
      })}
    </span>
  );
}

/**
 * The orb plus a state label, for a strip above a control ("Drafting…").
 * Keeps the wording and the mark together so no surface invents its own.
 */
export function AiStatus({
  state,
  label,
  className,
}: {
  state: AiOrbState;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <AiOrb state={state} size={14} />
      <span>{label}</span>
    </span>
  );
}
