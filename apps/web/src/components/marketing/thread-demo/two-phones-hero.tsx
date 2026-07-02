"use client";

/**
 * TwoPhonesHero (Track HERO+PERF) — the signature moment (BLUEPRINT §0.1 / §3.1).
 *
 * The site's ONE engineered spectacle: a customer's PLAIN text message on the
 * left (generic phone / Messages styling) MATERIALIZES on the right as a
 * structured JobText conversation the whole crew can see — assignable, notable,
 * status, delivery confirmed. It is the product's entire argument in one moving
 * object, and it *is* the app (real thread primitives, app motion grammar).
 *
 * Composition (BLUEPRINT §3.1):
 *  - Left: a neutral "Messages" phone — the customer's raw text + photo, in
 *    generic gray/blue bubbles. Deliberately NOT JobText-branded: this is any
 *    customer, on any phone, texting your business number.
 *  - Center: a materialization connector ("lands in your shared inbox") — a
 *    horizontal flow on desktop, a downward chevron on mobile.
 *  - Right: the same message, now a JobText conversation. The team leaves a
 *    note, assigns it, replies (Delivered), and tags it — the app's real DOM.
 *
 * LCP + CLS discipline (BLUEPRINT §3.1, §11.4):
 *  - No raster image anywhere. Pure DOM/CSS, so the H1 text stays the LCP and
 *    there is no hero-image decode on mobile.
 *  - Server-renders the COMPLETED two-phones state (this component ships its own
 *    static markup path); the animation only *replays* that same finished state
 *    on entry. LCP paint === reduced-motion === no-JS.
 *  - Every animated region lives inside an already-reserved box (min-heights on
 *    both phone bodies) so the reveal shifts nothing (no CLS).
 *  - Animates once on viewport entry, then offers replay. prefers-reduced-motion
 *    shows the finished composition immediately with a Play affordance.
 */

import { Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { ThreadBeat } from "./script";
import { WATER_HEATER_SCRIPT } from "./script";
import { ThreadFrame } from "./thread-frame";
import {
  EventLine,
  InboundBubble,
  NoteBubble,
  OutboundBubble,
} from "./thread-primitives";
import { useReducedMotion } from "./use-thread-player";

/* -------------------------------------------------------------------------- */
/* Left phone — the generic customer's Messages app.                           */
/* Neutral, un-branded: gray inbound bubble + a DOM photo tile, a plain phone  */
/* frame with a "Messages" title and the business number as the recipient.    */
/* -------------------------------------------------------------------------- */

/** The customer's raw text — pulled from the SAME canonical script the hero
 *  materializes on the right, so the two phones are provably one story. */
const CUSTOMER = WATER_HEATER_SCRIPT.beats[0];

function GenericMessagesPhone({ revealed }: { revealed: boolean }) {
  if (CUSTOMER.kind !== "inbound") return null;
  return (
    <div className="relative mx-auto w-full max-w-[260px] overflow-hidden rounded-[28px] border-[6px] border-stone-200 bg-stone-50 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)] dark:border-stone-800 dark:bg-stone-950">
      {/* Generic Messages header — recipient is your business number. */}
      <div className="border-b border-border/70 bg-white/70 px-4 py-3 text-center dark:bg-stone-900/70">
        <p className="text-[11px] text-muted-foreground">Messages</p>
        <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-foreground">
          {CUSTOMER.from}
        </p>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          to (416) 555-0119
        </p>
      </div>

      {/* One reserved-height body — the plain text + photo, gray bubble left. */}
      <div className="flex min-h-[248px] flex-col justify-end gap-2 px-3 py-4">
        <div
          className={cn(
            "flex flex-col items-start gap-1.5",
            revealed
              ? "opacity-100"
              : "motion-safe:opacity-0 motion-reduce:opacity-100",
            revealed &&
              "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 motion-safe:ease-out",
          )}
        >
          {/* Generic gray photo tile — no raster, drawn in DOM. */}
          {CUSTOMER.photo && (
            <div
              className="flex size-24 flex-col items-center justify-center gap-1 rounded-2xl bg-stone-200 text-center text-stone-500 dark:bg-stone-800 dark:text-stone-400"
              role="img"
              aria-label={`Photo: ${CUSTOMER.photo.label}`}
            >
              <PhotoGlyph />
              <span className="px-2 text-[9px] leading-tight">
                {CUSTOMER.photo.label}
              </span>
            </div>
          )}
          {/* The plain text, in a generic gray iMessage-style bubble. */}
          <div className="max-w-[88%] rounded-[18px] rounded-bl-[6px] bg-stone-200 px-3.5 py-2 text-[14px] leading-snug text-stone-800 dark:bg-stone-800 dark:text-stone-100">
            {CUSTOMER.body}
          </div>
          <span className="pl-1 text-[10px] text-muted-foreground">
            {CUSTOMER.time}
          </span>
        </div>
      </div>

      {/* Inert composer hint — reads as a real Messages app, not interactive. */}
      <div className="border-t border-border/70 px-3 py-2.5">
        <div className="flex h-8 items-center rounded-full border border-border bg-white px-3 text-[12px] text-muted-foreground dark:bg-stone-900">
          Text message
        </div>
      </div>
    </div>
  );
}

/** Tiny inline photo glyph (no icon import cost beyond lucide already used). */
function PhotoGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Materialization connector — the plain text "landing" in the shared inbox.  */
/* -------------------------------------------------------------------------- */

function MaterializeConnector({ active }: { active: boolean }) {
  return (
    <div
      className="flex items-center justify-center lg:h-full lg:flex-col"
      aria-hidden
    >
      {/* Desktop: a horizontal flow with a label; mobile: a down chevron. */}
      <div className="hidden flex-col items-center gap-2 lg:flex">
        <ArrowFlow active={active} />
        <span className="max-w-[7rem] text-center text-[11px] font-medium leading-tight text-muted-foreground">
          lands in your shared inbox
        </span>
      </div>
      <div className="flex flex-col items-center gap-1 py-1 lg:hidden">
        <span className="text-[11px] font-medium text-muted-foreground">
          lands in your shared inbox
        </span>
        <svg
          viewBox="0 0 24 24"
          className={cn(
            "size-5 text-primary",
            active &&
              "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300",
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14" />
          <path d="m19 12-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}

/** A dashed petrol arrow that fades in once when the materialization fires. */
function ArrowFlow({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 80 24"
      className={cn(
        "h-6 w-20 text-primary",
        active &&
          "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500",
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12h64" strokeDasharray="4 4" />
      <path d="m62 6 8 6-8 6" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Right side beat — the JobText conversation, on the app's motion grammar.     */
/* -------------------------------------------------------------------------- */

/**
 * A beat that ALWAYS occupies its layout box, revealing via opacity/transform.
 *
 * CLS discipline (BLUEPRINT §1.5, §11.4): every beat is rendered at all times so
 * the thread body's height is constant regardless of how many beats are
 * "revealed" — the reveal is a pure opacity + 4px-rise animation inside the
 * already-reserved box, never an add/remove that would grow the container and
 * shift the vertically-centered hero text (the desktop CLS trap).
 */
function Beat({
  beat,
  revealed,
  delivered,
}: {
  beat: ThreadBeat;
  /** Whether this beat has been reached in the current play. */
  revealed: boolean;
  /** Whether outbound beats have flipped to Delivered. */
  delivered: boolean;
}) {
  return (
    <div
      className={cn(
        "transition-[opacity,transform] duration-200 ease-out will-change-[opacity,transform]",
        revealed
          ? "translate-y-0 opacity-100"
          : "translate-y-1 opacity-0 motion-reduce:opacity-100 motion-reduce:translate-y-0",
      )}
      aria-hidden={!revealed}
    >
      {beat.kind === "inbound" && <InboundBubble beat={beat} />}
      {beat.kind === "outbound" && (
        <OutboundBubble beat={beat} state={delivered ? "delivered" : "sending"} />
      )}
      {beat.kind === "note" && <NoteBubble beat={beat} />}
      {beat.kind === "event" && <EventLine beat={beat} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The composition + its player.                                               */
/* -------------------------------------------------------------------------- */

/** Cadence (ms). Calm — a demo, not a chat race (matches use-thread-player). */
const CUSTOMER_HOLD = 900; // dwell on the plain text before it materializes
const BEAT_DELAY = 1400; // between right-side beats
const SEND_SETTLE = 900; // outbound Sending… → Delivered

const script = WATER_HEATER_SCRIPT;
const TOTAL = script.beats.length;

export function TwoPhonesHero() {
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  // Static-first state = the FINISHED composition. This is what the server
  // renders, what the LCP paints, and what reduced-motion / no-JS keep. The
  // animation only replays this same finished state on entry.
  const [customerShown, setCustomerShown] = useState(true);
  const [revealed, setRevealed] = useState(TOTAL);
  const [delivered, setDelivered] = useState(true);
  const [phase, setPhase] = useState<"static" | "playing" | "done">("static");

  // A monotonically increasing token. Bumping it (on viewport entry, or the
  // Replay button) re-runs the timeline effect below. Driving the run from an
  // effect keyed on this token — rather than an imperative play() that pushes
  // into a ref — makes the player Strict-Mode safe: the effect owns its own
  // timers and clears them on every re-run/unmount, so a dev double-mount
  // restarts the run cleanly instead of orphaning timers (which is what
  // silently stalled the animation).
  const [runId, setRunId] = useState(0);

  // Arm once on viewport entry (the hero is above the fold, so this usually
  // fires immediately). Reduced motion never arms — it stays on the static
  // finished composition the server already rendered.
  useEffect(() => {
    if (reduced) return;
    const el = rootRef.current;
    if (!el) return;

    let armed = false;
    const arm = () => {
      if (armed) return;
      armed = true;
      setRunId((n) => n + 1); // kick off the first play
    };

    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      arm();
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      arm();
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          arm();
          obs.disconnect();
        }
      },
      { threshold: 0.01, rootMargin: "0px 0px -10% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [reduced]);

  // The timeline: runs whenever runId changes (and motion is allowed). Owns its
  // timers; the cleanup clears them, so re-running or unmounting is clean.
  useEffect(() => {
    if (reduced || runId === 0) return; // runId 0 = the untouched static state
    const timers: ReturnType<typeof setTimeout>[] = [];

    setPhase("playing");
    setCustomerShown(false);
    setRevealed(0);
    setDelivered(false);

    // 1) The customer's plain text appears on the left phone.
    timers.push(setTimeout(() => setCustomerShown(true), 250));

    // 2) After a beat, it materializes on the right, beat by beat.
    let t = CUSTOMER_HOLD + 250;
    for (let i = 0; i < TOTAL; i++) {
      const beat = script.beats[i];
      const at = t;
      timers.push(setTimeout(() => setRevealed((r) => Math.max(r, i + 1)), at));
      if (beat.kind === "outbound") {
        timers.push(setTimeout(() => setDelivered(true), at + SEND_SETTLE));
        t = at + BEAT_DELAY + SEND_SETTLE;
      } else {
        t = at + BEAT_DELAY;
      }
    }
    timers.push(setTimeout(() => setPhase("done"), t));

    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [runId, reduced]);

  // If reduced motion is (or becomes) active, snap to the finished composition
  // — never leave a run frozen mid-animation. This also covers the case where
  // useReducedMotion resolves to true just after an entry-arm already fired.
  useEffect(() => {
    if (!reduced) return;
    setCustomerShown(true);
    setRevealed(TOTAL);
    setDelivered(true);
    setPhase("static");
  }, [reduced]);

  const replay = () => setRunId((n) => n + 1);

  const status =
    revealed >= TOTAL ? script.finalStatus : revealed > 0 ? "open" : "new";
  // The assignee avatar appears once the assignment event (beat index 2) fires.
  const assignee = revealed >= 3 ? script.assignee : undefined;
  const isPlaying = phase === "playing";

  return (
    <div ref={rootRef}>
      {/* items-start (never items-center) so an animating right column can never
          re-center — and thus never shift — the hero text column. Vertical
          balance comes from the reserved-height composition itself. */}
      <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,0.82fr)_auto_minmax(0,1.15fr)] lg:gap-4">
        {/* LEFT — the generic customer phone. */}
        <div className="relative">
          <GenericMessagesPhone revealed={customerShown} />
        </div>

        {/* CENTER — the materialization flow. */}
        <MaterializeConnector active={isPlaying || phase === "done"} />

        {/* RIGHT — the JobText conversation (real primitives). */}
        <div className="relative">
          <ThreadFrame
            framing="desktop"
            contact={script.contact}
            status={status}
            assignee={assignee}
          >
            {/* Every beat is ALWAYS rendered and reveals via opacity/transform,
                so the body height is constant (CLS-safe) — the reveal never
                grows the container. */}
            <div className="flex flex-col gap-3 px-3 py-4">
              {script.beats.map((beat, i) => (
                <Beat
                  key={beat.id}
                  beat={beat}
                  revealed={i < revealed}
                  delivered={delivered}
                />
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
              <span className="text-[12px] text-muted-foreground">
                {phase === "playing"
                  ? "Materializing…"
                  : "Your crew sees it, together."}
              </span>
              {!reduced && phase !== "playing" && (
                <button
                  type="button"
                  onClick={replay}
                  aria-label="Play the two-phones demo again"
                  className="tap-target inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {phase === "done" ? (
                    <>
                      <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden />
                      Play it again
                    </>
                  ) : (
                    <>
                      <Play className="size-3.5" strokeWidth={1.75} aria-hidden />
                      Play
                    </>
                  )}
                </button>
              )}
            </div>
          </ThreadFrame>
        </div>
      </div>
    </div>
  );
}
