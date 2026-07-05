/**
 * "Quiet daylight" (v3) — the kit's motion CSS. ONE inert <style> block,
 * class prefix "nx-", mounted ONCE by the home-page integrator via <NightCss />.
 *
 * Exactly FOUR movements exist (v3 spec §4). Everything else on the page is
 * static or rides the shared [data-reveal] rise in globals.css:
 *
 *   1. LAND    .nx-land     the hero inbound message soft-lands once on load
 *   2. TICK    .nx-tick-*   queued -> sent -> delivered on one 800ms clock
 *   3. UNREAD  .nx-unread   the amber dot double-pulses, then holds steady
 *   4. ROLL    .nx-roll-*   the final-CTA phone-number odometer
 *
 * THE CONTRACT (v3):
 *  - The attribute-less default of every class is the FINISHED state: bubble
 *    landed, ticks delivered, dot steady, digits seated. No-JS and
 *    prefers-reduced-motion users read that resolved scene untouched.
 *  - Triggers are pure opt-in, two of them:
 *      [data-anim]             a client island (hero-replay / odometer) arms a
 *                              wrapper; every nx- animation under it plays
 *                              once from frame zero. Arming IS firing — the
 *                              old data-on / data-beat two-phase switchboard
 *                              is gone along with the transitions it staged
 *                              (an already-set data-on is simply inert).
 *      [data-revealed="true"]  the standard Reveal mechanism (reveal.tsx).
 *                              TICKS also fire when their <Reveal> wrapper
 *                              reveals, so static sections step them with no
 *                              extra island.
 *  - Stagger inside one fired subtree with inline --nx-delay; offset a tick
 *    run with --nx-tick-delay (default 200ms lets the land settle first).
 *  - Everything animates opacity/transform only, fires once, <= 900ms.
 *
 * Deleted in v3 (do not resurrect): the lamp engine (.nx-lamp*, .nx-glow-scope,
 * .nx-screen, .nx-spill, .nx-rim, .nx-clip), .nx-brighten, .nx-fade, .nx-rise
 * (Reveal covers rises), .nx-stamp, .nx-type + .nx-caret, .nx-qpulse, and the
 * generated pending-state machinery for data-on / data-beat-at.
 */

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

const CSS = `
/* ==== Resolved states (always on, motionless) ============================= */
/* TICK: three stacked state spans in one grid cell; resolved shows Delivered
   only. Petrol color comes from the kit markup, not from here. */
.nx-tick {
  display: inline-grid;
}
.nx-tick > span {
  grid-area: 1 / 1;
  justify-self: end;
  white-space: nowrap;
}
.nx-tick-q,
.nx-tick-s {
  opacity: 0;
}

/* ROLL: .nx-roll is a one-digit window; .nx-roll-strip stacks 0..target
   (target LAST) and sits pre-seated on the target via --nx-steps. .nx-roll-c
   keeps non-digit glyphs in the same 1em box so the line stays level. */
.nx-roll,
.nx-roll-c {
  display: inline-block;
  height: 1em;
  line-height: 1;
  vertical-align: bottom;
}
.nx-roll {
  overflow: hidden;
}
.nx-roll-strip {
  display: block;
  transform: translateY(calc(var(--nx-steps, 0) * -1em));
}
.nx-roll-d {
  display: block;
  height: 1em;
}

/* ==== The four movements (armed AND motion-tolerant only) ================= */
@media (prefers-reduced-motion: no-preference) {
  /* 1. LAND — opacity + 6px, 300ms, default 250ms delay (v3 spec §4.2). */
  [data-anim] .nx-land {
    animation: nx-land 300ms ${EASE} var(--nx-delay, 250ms) both;
  }

  /* 2. TICK — one shared 800ms step clock: queued at 0ms, sent at +400ms,
     delivered at +800ms. Fires under an armed island OR a revealed <Reveal>
     wrapper; --nx-tick-delay (inheritable) offsets the whole run. */
  :is([data-anim], [data-revealed="true"]) .nx-tick-q {
    animation: nx-tick-q 800ms step-end var(--nx-tick-delay, 200ms) both;
  }
  :is([data-anim], [data-revealed="true"]) .nx-tick-s {
    animation: nx-tick-s 800ms step-end var(--nx-tick-delay, 200ms) both;
  }
  :is([data-anim], [data-revealed="true"]) .nx-tick-d {
    animation: nx-tick-d 800ms step-end var(--nx-tick-delay, 200ms) both;
  }

  /* 3. UNREAD — the page's one repeater: two 700ms pulses, then the steady
     resolved dot. Hero only (only the hero island arms an ancestor). */
  [data-anim] .nx-unread {
    animation: nx-unread 700ms ease-in-out var(--nx-delay, 0ms) 2;
  }

  /* 4. ROLL — each strip re-runs 0 -> seated digit with one hard steps() per
     digit; stagger via --nx-delay (RollNumber's stagger prop sets it). */
  [data-anim] .nx-roll-strip {
    animation: nx-roll var(--nx-roll-ms, 900ms) steps(var(--nx-steps, 1), end)
      var(--nx-delay, 0ms) both;
  }

  /* -- Keyframes (opacity/transform only) -- */
  @keyframes nx-land {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  /* step-end holds each keyframe's start value, so these read as hard state
     flips: q visible 0-400ms, s 400-800ms, d from 800ms on. */
  @keyframes nx-tick-q {
    0% {
      opacity: 1;
    }
    50%,
    100% {
      opacity: 0;
    }
  }
  @keyframes nx-tick-s {
    0% {
      opacity: 0;
    }
    50% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  @keyframes nx-tick-d {
    0% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
  }
  @keyframes nx-unread {
    0%,
    100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.45);
      opacity: 0.7;
    }
  }
  @keyframes nx-roll {
    from {
      transform: translateY(0);
    }
    to {
      transform: translateY(calc(var(--nx-steps, 0) * -1em));
    }
  }
}
`;

/**
 * The one inert style node for the demo kit. Server component, zero JS.
 * Mount exactly once (the home-page integrator), above the first section that
 * uses nx- classes.
 */
export function NightCss() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
