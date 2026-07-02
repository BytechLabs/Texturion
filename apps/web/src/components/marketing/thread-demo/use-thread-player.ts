"use client";

/**
 * Thread player engine (Track B).
 *
 * Drives the scripted reveal of a ThreadScript on the app's real motion grammar
 * (DESIGN.md G5 / BLUEPRINT §1.5: 200ms fade + 4px rise per message). Beats
 * arrive on a timer; outbound beats pass through a Sending… → Sent → Delivered
 * transition so the delivery states animate exactly like the app.
 *
 * Respects prefers-reduced-motion: when reduced, the hook reports every beat as
 * already visible and every delivery state terminal, and never schedules
 * timers — the caller renders the completed thread statically with a Play
 * affordance (BLUEPRINT §1.5, §3.1). The same completed thread is what the
 * server pre-renders for LCP / no-JS.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { DeliveryState, ThreadScript } from "./script";

/** Beat-to-beat cadence (ms). Kept calm — this is a demo, not a chat race. */
const BEAT_DELAY = 1500;
/** Extra dwell before an outbound bubble flips Sending… → Delivered. */
const SEND_SETTLE = 900;

export interface ThreadPlayerState {
  /** Number of beats currently revealed (drives which beats render). */
  revealed: number;
  /** Delivery state per outbound beat id (sending → sent → delivered). */
  delivery: Record<string, DeliveryState>;
  /** True while beats are actively arriving. */
  playing: boolean;
  /** True once the whole script has finished at least once. */
  complete: boolean;
  /** The step (1-based) of the most recently revealed captioned beat, if any. */
  activeStep: number | null;
  play: () => void;
  pause: () => void;
  replay: () => void;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

function terminalDelivery(script: ThreadScript): Record<string, DeliveryState> {
  const map: Record<string, DeliveryState> = {};
  for (const beat of script.beats) {
    if (beat.kind === "outbound") map[beat.id] = beat.delivered;
  }
  return map;
}

/**
 * @param autoStart when true (and motion is allowed), the thread begins playing
 *   as soon as `armed` is set — used by the hero to autoplay once on viewport
 *   entry. The deep-dive passes false and drives via step controls.
 */
export function useThreadPlayer(
  script: ThreadScript,
  { autoStart, armed }: { autoStart: boolean; armed: boolean },
): ThreadPlayerState {
  const reduced = useReducedMotion();
  const total = script.beats.length;

  const [revealed, setRevealed] = useState(0);
  const [delivery, setDelivery] = useState<Record<string, DeliveryState>>({});
  const [playing, setPlaying] = useState(false);
  const [complete, setComplete] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  // Reveal beat `index` (0-based); schedule the outbound send animation and the
  // next beat. Recursive via setTimeout so pausing simply stops scheduling.
  const revealFrom = useCallback(
    (index: number) => {
      if (index >= total) {
        setPlaying(false);
        setComplete(true);
        return;
      }
      const beat = script.beats[index];
      setRevealed(index + 1);

      if (beat.kind === "outbound") {
        setDelivery((d) => ({ ...d, [beat.id]: "sending" }));
        timers.current.push(
          setTimeout(() => {
            setDelivery((d) => ({ ...d, [beat.id]: beat.delivered }));
          }, SEND_SETTLE),
        );
      }

      const delay = beat.kind === "outbound" ? BEAT_DELAY + SEND_SETTLE : BEAT_DELAY;
      timers.current.push(setTimeout(() => revealFrom(index + 1), delay));
    },
    [script.beats, total],
  );

  const play = useCallback(() => {
    if (reduced) return;
    clearTimers();
    setComplete(false);
    setPlaying(true);
    // Resume from where we paused, or start fresh if finished.
    const start = revealed >= total ? 0 : revealed;
    if (start === 0) {
      setDelivery({});
    }
    revealFrom(start);
  }, [reduced, clearTimers, revealed, total, revealFrom]);

  const pause = useCallback(() => {
    clearTimers();
    setPlaying(false);
  }, [clearTimers]);

  const replay = useCallback(() => {
    clearTimers();
    setRevealed(0);
    setDelivery({});
    setComplete(false);
    setPlaying(true);
    timers.current.push(setTimeout(() => revealFrom(0), 200));
  }, [clearTimers, revealFrom]);

  // Reduced motion: show the finished thread immediately, never animate.
  useEffect(() => {
    if (reduced) {
      clearTimers();
      setRevealed(total);
      setDelivery(terminalDelivery(script));
      setComplete(true);
      setPlaying(false);
    }
  }, [reduced, total, script, clearTimers]);

  // Autoplay once when armed (viewport entry) and motion is allowed.
  const startedRef = useRef(false);
  useEffect(() => {
    if (reduced || !armed || !autoStart || startedRef.current) return;
    startedRef.current = true;
    revealFrom(0);
    setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, armed, autoStart]);

  useEffect(() => clearTimers, [clearTimers]);

  // Active step = the highest captioned beat among the revealed ones.
  let activeStep: number | null = null;
  for (let i = 0; i < revealed && i < total; i++) {
    const s = script.beats[i].step;
    if (s != null) activeStep = s;
  }

  return {
    revealed,
    delivery,
    playing,
    complete,
    activeStep,
    play,
    pause,
    replay,
  };
}
