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
 *   4. after the LCP paint, then requestIdleCallback, then an
 *      IntersectionObserver (rootMargin 200px) on the hero layer → boot
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

/** Run `cb` after the LCP candidate has painted (PerformanceObserver), with a
 *  window-load fallback where the entry type is unsupported. */
function afterLcp(cb: () => void): () => void {
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    cb();
  };
  try {
    const po = new PerformanceObserver(() => {
      po.disconnect();
      fire();
    });
    po.observe({ type: "largest-contentful-paint", buffered: true });
    // Safety net: if no LCP entry ever lands (already-loaded bfcache page),
    // the load event releases the boot.
    if (document.readyState === "complete") {
      const t = setTimeout(fire, 1500);
      return () => {
        clearTimeout(t);
        po.disconnect();
      };
    }
    window.addEventListener("load", () => setTimeout(fire, 300), {
      once: true,
    });
    return () => po.disconnect();
  } catch {
    if (document.readyState === "complete") {
      const t = setTimeout(fire, 0);
      return () => clearTimeout(t);
    }
    window.addEventListener("load", fire, { once: true });
    return () => window.removeEventListener("load", fire);
  }
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

    const cancelLcp = afterLcp(() => {
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
      cancelLcp();
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
          keep this. It crossfades out only after the first live frame. On
          desktop the still keeps its native 520x560 box and its RIGHT edge
          tucks under the inbox card's left edge, so the docked queue and the
          one waiting Flare bubble stay visible (the still is a composition,
          not an absence); the trailing streamline ends ride at 12% alpha
          under the hero copy, the texts arriving from the world. */}
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-200",
          live ? "opacity-0" : "opacity-100",
        )}
      >
        <div className="absolute inset-0 lg:left-auto lg:right-[20rem] lg:aspect-[520/560] lg:h-full lg:w-auto">
          <ArrivalStatic />
        </div>
      </div>
      {boot ? <ArrivalField onFirstFrame={() => setLive(true)} /> : null}
    </div>
  );
}
