"use client";

/**
 * S1 hero replay island (v3 "Quiet daylight", spec §4.2): the smallest
 * possible motion trigger, zero deps.
 *
 * The server markup is the finished scene — the LCP paints resolved and
 * no-JS / reduced-motion users simply keep it. For motion-tolerant users this
 * sets data-anim="replay" on #tonight once after hydration; under the v3
 * night-css contract ARMING IS FIRING (the old data-on two-phase switchboard
 * is gone), so the fill-mode:both keyframes under the section play from frame
 * zero: the inbound bubble soft-LANDs, the unread dot double-pulses, the
 * ticks step queued → sent → delivered.
 *
 * Every rule this enables is additionally gated behind
 * @media (prefers-reduced-motion: no-preference) in night-css, so the
 * matchMedia bail here is belt-and-braces. Re-setting the same attribute
 * value never restarts a CSS animation, so StrictMode double-effects and
 * remounts are harmless.
 */

import { useEffect } from "react";

export function HeroReplay() {
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      return;
    }
    document.getElementById("tonight")?.setAttribute("data-anim", "replay");
  }, []);

  return null;
}
