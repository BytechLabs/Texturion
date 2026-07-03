"use client";

/**
 * DispatchDesk (iteration 5) — the interactive dispatch-desk island.
 * Build-ready spec: HERO-CONCEPT.md §1–§5. This is the participatory wow: the
 * visitor watches a raw, panicked customer text land as UNFILED, then FILES it
 * in one tap — picks who handles it, and it snaps into a clean, assigned,
 * crew-visible job with a petrol FILED stamp.
 *
 * State machine (reducer-only, no deps, HERO-CONCEPT §6 island budget):
 *   raw ──(tap assignee / ghost demo)──▶ filed
 *   filed ──(Replay)──▶ raw
 *
 * Lifecycle (HERO-CONCEPT §3):
 *  - Mounts (after first paint, via LazyIsland) and, if motion is allowed,
 *    RESETS to State A (raw/unfiled) so the visitor can drive it. The server
 *    already painted State B (DispatchDeskStatic) for the LCP / no-JS.
 *  - prefers-reduced-motion: never resets — stays on the finished State B and
 *    exposes only a quiet Replay affordance (§5). No stamp, no ghost, no reset.
 *  - Discoverability kit (§4): pulse ring on the ASSIGN chip, a "tap to file →"
 *    hint, and a ~3s ghost-demo auto-play (drifts a ghost cursor to Dale, files
 *    it) if untouched — plays at most once, then lets the visitor drive.
 *  - On file: aria-live announces "Filed — assigned to {name}", the row snaps
 *    square, the spine flips amber→petrol, the FILED stamp presses in (150ms),
 *    the raw bubble re-renders as the clean conversation, the counter ticks 1→0.
 *
 * CLS-safe: the desk lives in a reserved min-height box; State A↔B swaps animate
 * transform/opacity only. Compositor-only stamp keyframe (ledger-css). INP-safe:
 * a tap is one reducer dispatch.
 */

import { useEffect, useReducer, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { StatusSpine, TicketMeta } from "@/components/marketing/ledger/ticket";
import { FiledStamp } from "@/components/marketing/ledger/filed-stamp";

import {
  DEFAULT_ASSIGNEE,
  DISPATCH,
  type Assignee,
} from "./dispatch-data";
import {
  AssignChips,
  DeskAvatar,
  RawBubble,
  ResolvedConversation,
  StatusPills,
} from "./desk-parts";

type Phase = "raw" | "filed";
interface DeskState {
  phase: Phase;
  assignee: Assignee | null;
  /** True only right after a visitor/ghost file — drives the one-shot keyframes. */
  justFiled: boolean;
}
type Action =
  | { type: "file"; assignee: Assignee }
  | { type: "reset" };

function reducer(state: DeskState, action: Action): DeskState {
  switch (action.type) {
    case "file":
      return { phase: "filed", assignee: action.assignee, justFiled: true };
    case "reset":
      return { phase: "raw", assignee: null, justFiled: false };
  }
}

function useReducedMotion(): boolean {
  // Read the preference SYNCHRONOUSLY on the first render (this island is
  // client-only — LazyIsland loads it with no SSR — so there is no server frame
  // to mismatch). A lazy initializer instead of `useState(false)` matters: it
  // makes `reduced` correct on the very first commit, so the mount effect's
  // `if (reduced) return` is honored immediately and reduced-motion visitors
  // NEVER get the reset-to-State-A flash that a false→true flip would cause
  // (HERO-CONCEPT §5: reduced motion stays on the finished State B).
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

const GHOST_DELAY = 3000; // ~3s untouched → the ghost demo (§3 step 7)
const GHOST_FILE_DELAY = 850; // cursor-drift → the ghost's file tap (§3 step 8)
const GHOST_HOLD = 1900; // let the FILED wow land, then hand the desk back (§3 step 8)

export function DispatchDesk() {
  const reduced = useReducedMotion();

  // Start in State B (matches the server render), so hydration paints no swap;
  // then reset to State A in an effect once we know motion is allowed.
  const [state, dispatch] = useReducer(reducer, {
    phase: "filed",
    assignee: DEFAULT_ASSIGNEE,
    justFiled: false,
  });
  const [announce, setAnnounce] = useState("");
  const [showGhost, setShowGhost] = useState(false);
  const interacted = useRef(false);
  /** Every scheduled ghost timeout, so unmount clears them all (no post-unmount
   *  dispatch, and no leaked reset that would clobber a visitor's own file). */
  const ghostTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  /** The ghost demo auto-plays AT MOST ONCE for the island's whole life — this
   *  survives the StrictMode setup→cleanup→setup remount and any re-arm. */
  const ghostPlayed = useRef(false);
  const daleChipRef = useRef<HTMLDivElement>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  const clearGhostTimers = () => {
    ghostTimers.current.forEach((t) => clearTimeout(t));
    ghostTimers.current.clear();
  };
  const scheduleGhost = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      ghostTimers.current.delete(id);
      fn();
    }, ms);
    ghostTimers.current.add(id);
    return id;
  };

  const file = (assignee: Assignee, viaGhost = false) => {
    if (!viaGhost) {
      // A real visitor tap cancels the ghost safety-net entirely (§3 step 7),
      // and their filed state must never be reset out from under them.
      interacted.current = true;
      clearGhostTimers();
    }
    setShowGhost(false);
    setAnnounce(`Filed — assigned to ${assignee.name}.`);
    dispatch({ type: "file", assignee });
  };

  const replay = () => {
    interacted.current = true;
    clearGhostTimers();
    setAnnounce("");
    dispatch({ type: "reset" });
  };

  // On mount: reduced-motion keeps State B (final frame + Replay only). Full
  // motion resets to State A so the visitor can drive, and arms the ghost timer.
  useEffect(() => {
    if (reduced) return;
    dispatch({ type: "reset" });

    // Arm the ghost only if it has never played (once per island life, §3 step 8).
    if (!ghostPlayed.current) {
      scheduleGhost(() => {
        // A real interaction in the interval cancels the demo (§3 step 7).
        if (interacted.current || ghostPlayed.current) return;
        ghostPlayed.current = true;

        // Drift the ghost cursor to the Dale chip.
        const chip = daleChipRef.current?.querySelector<HTMLElement>(
          `button[data-assignee="${DEFAULT_ASSIGNEE.name}"]`,
        );
        const host = daleChipRef.current;
        if (chip && host) {
          const cr = chip.getBoundingClientRect();
          const hr = host.getBoundingClientRect();
          setGhostPos({
            x: cr.left - hr.left + cr.width / 2,
            y: cr.top - hr.top + cr.height / 2,
          });
        }
        setShowGhost(true);

        // The ghost taps Dale — plays the FILE animation (§3 step 8)…
        scheduleGhost(() => {
          if (interacted.current) return;
          file(DEFAULT_ASSIGNEE, true);

          // …then, after the wow lands, hands the desk back to State A so the
          // visitor can file it themselves (§3 step 8: "reset to State A"). The
          // interacted guard means a visitor who acts during the hold keeps
          // their own filed ticket — the ghost never clobbers a real tap.
          scheduleGhost(() => {
            if (interacted.current) return;
            setAnnounce("");
            dispatch({ type: "reset" });
          }, GHOST_HOLD);
        }, GHOST_FILE_DELAY);
      }, GHOST_DELAY);
    }

    return () => {
      clearGhostTimers();
    };
    // Re-arm only when the reduced pref resolves.
  }, [reduced]);

  const isRaw = state.phase === "raw";
  const assignee = state.assignee ?? DEFAULT_ASSIGNEE;
  const unfiled = isRaw ? 1 : 0;

  return (
    <div ref={daleChipRef} className="relative">
      {/* aria-live announces the file for screen readers (§3 step 9). */}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {/* Counter + stamp row. */}
      <div className="mb-3 flex items-center justify-between">
        <span className="jt-meta tabular-nums text-muted-foreground">
          Unfiled: {unfiled}
        </span>
        {!isRaw && <FiledStamp stamped={state.justFiled && !reduced} />}
        {isRaw && !reduced && (
          <span className="jt-meta text-primary/80">{DISPATCH.hint}</span>
        )}
      </div>

      {/* The ticket — tilts ~1° when raw/unfiled, snaps square when filed. */}
      <div
        className={cn(
          "relative overflow-hidden rounded-[12px] border bg-card pl-3 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)] transition-transform duration-200 ease-out",
          isRaw
            ? "border-amber-300/70 motion-safe:rotate-[0.8deg] dark:border-amber-700/50"
            : "border-border rotate-0",
        )}
      >
        <StatusSpine status={isRaw ? "unfiled" : "filed"} />

        {/* Ticket header. */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          {isRaw ? (
            <span className="jt-meta text-amber-700 dark:text-warning">
              New · unfiled
            </span>
          ) : (
            <TicketMeta
              id={DISPATCH.ticketId}
              status="filed"
              assignee={assignee.name}
              time={DISPATCH.filedTime}
            />
          )}
          {!isRaw && (
            <span
              className={cn(state.justFiled && !reduced && "jt-settle")}
              aria-hidden
            >
              <DeskAvatar a={assignee} />
            </span>
          )}
        </div>

        {/* Body — a reserved min-height box so State A↔B never shifts layout. */}
        <div className="min-h-[300px] px-4 py-4 sm:min-h-[320px]">
          {isRaw ? (
            <div className="flex flex-col gap-4">
              <RawBubble />
              <div className="flex flex-col gap-3 border-t border-dashed border-border pt-3">
                <AssignChips onPick={(a) => file(a)} pulseFirst />
                <StatusPills active="New" />
              </div>
            </div>
          ) : (
            <div className={cn(state.justFiled && !reduced && "jt-settle")}>
              <ResolvedConversation
                assignee={assignee}
                drawn={state.justFiled && !reduced}
              />
            </div>
          )}
        </div>
      </div>

      {/* Caption + Replay. */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="jt-meta text-muted-foreground">
          {isRaw ? "One tap files it to your crew." : DISPATCH.resolvedCaption}
        </p>
        {!isRaw && (
          <button
            type="button"
            onClick={replay}
            className="tap-target inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden />
            Replay
          </button>
        )}
      </div>

      {/* Ghost cursor — drifts to the Dale chip once, if untouched (§4). */}
      {showGhost && ghostPos && (
        <span
          aria-hidden
          className="jt-ghost pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 text-primary"
          style={{ left: ghostPos.x, top: ghostPos.y }}
        >
          <svg viewBox="0 0 24 24" className="size-5 drop-shadow" fill="currentColor" aria-hidden>
            <path d="M5 3l14 8-6 1.5L10 20 5 3z" />
          </svg>
        </span>
      )}
    </div>
  );
}

/** Default export so the lazy loader can pick it up. */
export default DispatchDesk;
