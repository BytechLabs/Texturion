"use client";

import * as React from "react";

import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Restrained motion wrappers (APP-UI-ELEVATION.md §2.5, §4). Thin, reduced-
 * motion-aware React shells over the CSS keyframes in globals.css so the
 * consuming tracks get the spec's feedback/closure motion without re-authoring
 * it. Motion here always means feedback or closure, never decoration (§2.5).
 *
 * All three animations are pure CSS classes the globals.css
 * `prefers-reduced-motion: reduce` base rule already zeroes — the wrappers add
 * nothing that rule does not cover. `useReducedMotion` is provided for the rare
 * JS-driven case (a FLIP re-sort, a scripted timeout) that must additionally
 * no-op, mirroring lib/motion.ts's imperative check but reactive to changes.
 */

/**
 * Reactive `prefers-reduced-motion` hook. SSR-safe (returns false on the
 * server and first client render, then syncs). Use in components that branch
 * their render on the preference; for one-shot imperative checks inside an
 * event handler, prefer `prefersReducedMotion()` from lib/motion.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * MessageArrival (§4) — 200ms fade + 4px rise for a message landing in the
 * thread. Wrap the newest bubble; older bubbles render without it. Pair the
 * scroll region with `aria-live="polite"` so the arrival is announced.
 */
export function MessageArrival<T extends React.ElementType = "div">({
  as,
  animate = true,
  className,
  children,
  ...rest
}: {
  as?: T;
  /** Only the just-arrived message animates; historical ones pass false. */
  animate?: boolean;
  className?: string;
  children?: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<T>, "as" | "className" | "children">) {
  const Comp = (as ?? "div") as React.ElementType;
  return (
    <Comp
      className={cn(animate && "app-motion-message-in", className)}
      {...rest}
    >
      {children}
    </Comp>
  );
}

/**
 * useLeaveTransition (§4) — the optimistic "row leaves" closure for
 * close/reopen/assign/mark-spam/archive. Call `leave(onDone)` to play the
 * 150ms slide+fade and then run `onDone` (move focus to the next item, drop the
 * row). Under reduced motion it calls `onDone` immediately — nothing lost, only
 * the in-between frames. Returns `{ leaving, leave }`; apply the `leaving`
 * class to the row.
 *
 *   const { leaving, leave } = useLeaveTransition();
 *   // on close: runCloseMutation(); leave(() => focusNext());
 *   <li className={cn(leaving && "app-motion-row-leave")} ...>
 */
export function useLeaveTransition() {
  const [leaving, setLeaving] = React.useState(false);
  const ROW_LEAVE_MS = 150;

  const leave = React.useCallback((onDone?: () => void) => {
    if (prefersReducedMotion()) {
      onDone?.();
      return;
    }
    setLeaving(true);
    window.setTimeout(() => {
      onDone?.();
    }, ROW_LEAVE_MS);
  }, []);

  return { leaving, leave } as const;
}
