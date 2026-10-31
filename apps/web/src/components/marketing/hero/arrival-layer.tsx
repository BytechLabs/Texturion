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
 *   4. after the LCP paint AND the window load event, then
 *      requestIdleCallback, then an IntersectionObserver (rootMargin 200px)
 *      on the hero layer → boot
 *
 * The layer is absolutely positioned inside a pre-sized box (the hero
 * reserves it), pointer-events none, so CLS from this feature is 0.00. The
 * static SVG crossfades out (200ms) only after the first p5 frame has
 * rendered.
 */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { ArrivalStatic } from "./arrival-static";

const ArrivalField = dynamic(() => import("./arrival-field"), { ssr: false });

/**
 * The LCP entry alone fires while the page is still arriving, so on a phone
 * the p5 download shared one slow connection with the display face and the
 * hydration chunks. After `load` nothing the page requested is in flight.
 */
function afterLcpAndLoad(cb: () => void): () => void {
  let painted = false;
  let loaded = document.readyState === "complete";
  let done = false;
  let fallback: number | undefined;
  let po: PerformanceObserver | undefined;
  const fire = () => {
    if (done || !painted || !loaded) return;
    done = true;
    cb();
  };
  try {
    po = new PerformanceObserver(() => {
      po?.disconnect();
      painted = true;
      fire();
    });
    po.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // Entry type unsupported: the load event alone releases the boot.
    painted = true;
  }
  const onLoad = () => {
    loaded = true;
    // No LCP entry ever lands on a page restored from the bfcache.
    fallback = window.setTimeout(() => {
      painted = true;
      fire();
    }, 1500);
    fire();
  };
  if (loaded) onLoad();
  else window.addEventListener("load", onLoad, { once: true });
  return () => {
    done = true;
    po?.disconnect();
    window.removeEventListener("load", onLoad);
    if (fallback !== undefined) window.clearTimeout(fallback);
  };
}

export function ArrivalLayer() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [boot, setBoot] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    // Gates, in P5-SPEC order. Any failure keeps the static SVG.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean };
      deviceMemory?: number;
    };
    if (nav.connection?.saveData) return;
    if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return;

    let io: IntersectionObserver | null = null;
    let idleId: number | undefined;
    let idleTimeout: number | undefined;
    const w = window as Window &
      typeof globalThis & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };

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
  }, []);

  return (
    <div
      ref={hostRef}
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      {/* The composed still: SSR, no-JS, reduced-motion, and pre-boot all
          keep this. It crossfades out only after the first live frame. Since
          the live field is now a FULL-BLEED centerpiece (amendment 14), the
          still is full-bleed too: a wide river of curl streamlines converging
          into the node at the inbox card's left edge, the final few warmed
          cobalt -> green. It IS a composition, not an absence, and the crossfade
          to the live canvas is seamless because both fill the same box. */}
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-200",
          live ? "opacity-0" : "opacity-100",
        )}
      >
        <ArrivalStatic />
      </div>
      {boot ? <ArrivalField onFirstFrame={() => setLive(true)} /> : null}
    </div>
  );
}
