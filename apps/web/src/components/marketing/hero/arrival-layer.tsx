"use client";

/**
 * The Arrival Field boot layer (P5-SPEC §"Boot gating", §"Files and loading").
 *
 * SSR and every pre-boot state render the composed static SVG. The live p5
 * sketch is a lazy chunk (next/dynamic, ssr:false) requested only on `/`,
 * only after EVERY gate passes, in order:
 *
 *   1. prefers-reduced-motion: reduce  → static stays
 *   2. navigator.connection.saveData   → static stays
 *   3. navigator.deviceMemory < 4      → static stays
 *   4. saved pause preference keeps the static illustration
 *   5. after the LCP paint AND the window load event, then
 *      requestIdleCallback, then an IntersectionObserver (rootMargin 200px)
 *      on the hero layer → boot
 *
 * The layer is absolutely positioned inside a pre-sized box (the hero
 * reserves it), pointer-events none, so CLS from this feature is 0.00. The
 * static SVG crossfades out (200ms) only after the first p5 frame has
 * rendered.
 */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { afterLcpAndLoad } from "@/lib/perf/after-lcp-and-load";
import { cn } from "@/lib/utils";

import { ArrivalStatic } from "./arrival-static";

const ArrivalField = dynamic(() => import("./arrival-field"), { ssr: false });
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const PAUSE_KEY = "loonext-hero-animation-paused";

type Preference = "checking" | "unavailable" | "paused" | "playing";

function motionPreference(): Preference {
  if (window.matchMedia(MOTION_QUERY).matches) return "unavailable";
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };
  if (nav.connection?.saveData || (nav.deviceMemory !== undefined && nav.deviceMemory < 4)) {
    return "unavailable";
  }
  try {
    return window.localStorage.getItem(PAUSE_KEY) === "1" ? "paused" : "playing";
  } catch {
    return "playing";
  }
}

function subscribePreference(update: () => void) {
  const media = window.matchMedia(MOTION_QUERY);
  media.addEventListener("change", update);
  window.addEventListener("storage", update);
  return () => {
    media.removeEventListener("change", update);
    window.removeEventListener("storage", update);
  };
}

export function ArrivalLayer({ pauseLabel, resumeLabel }: { pauseLabel: string; resumeLabel: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [boot, setBoot] = useState(false);
  const [live, setLive] = useState(false);
  const [pauseOverride, setPauseOverride] = useState<boolean | null>(null);
  const preference = useSyncExternalStore(subscribePreference, motionPreference, () => "checking");
  const canAnimate = preference === "playing" || preference === "paused";
  const paused = pauseOverride ?? (preference === "paused");
  const playing = canAnimate && !paused;

  useEffect(() => {
    if (!playing || boot) return;

    let io: IntersectionObserver | null = null;
    let idleId: number | undefined;
    let idleTimeout: number | undefined;
    const w = window;

    const cancelGate = afterLcpAndLoad(() => {
      const armObserver = () => {
        const el = hostRef.current;
        if (!el) return;
        if (typeof IntersectionObserver === "undefined") {
          setBoot(true);
          return;
        }
        io = new IntersectionObserver(
          (entries) => {
            if (entries.some((e) => e.isIntersecting)) {
              io?.disconnect();
              setBoot(true);
            }
          },
          { rootMargin: "200px" },
        );
        io.observe(el);
      };
      if (typeof w.requestIdleCallback === "function") {
        idleId = w.requestIdleCallback(armObserver, { timeout: 3000 });
      } else {
        idleTimeout = window.setTimeout(armObserver, 250);
      }
    });

    return () => {
      cancelGate();
      io?.disconnect();
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
      if (idleTimeout !== undefined) window.clearTimeout(idleTimeout);
    };
  }, [boot, playing]);

  return (
    <>
      <div
        ref={hostRef}
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden="true"
      >
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-200",
            playing && live ? "opacity-0" : "opacity-100",
          )}
        >
          <ArrivalStatic />
        </div>
        {playing && boot ? <ArrivalField onFirstFrame={() => setLive(true)} /> : null}
      </div>
      {canAnimate && (
        <button
          type="button"
          className="absolute bottom-3 right-6 z-20 min-h-11 rounded-md border border-current bg-[color:var(--fr-ground)] px-3 text-sm font-medium text-[color:var(--fr-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 md:right-8"
          onClick={() => {
            setLive(false);
            setPauseOverride(!paused);
            try {
              window.localStorage.setItem(PAUSE_KEY, paused ? "0" : "1");
            } catch {
              // The toggle still applies during this visit.
            }
          }}
        >
          {paused ? resumeLabel : pauseLabel}
        </button>
      )}
    </>
  );
}
