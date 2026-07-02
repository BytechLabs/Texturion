"use client";

/**
 * <LazyIsland> — defer a heavy interactive island's JS download, hydration, and
 * script-evaluation cost until the visitor actually needs it (BLUEPRINT §3.1 /
 * §3.4 mandate: "defer non-critical islands via next/dynamic … loads on
 * viewport approach; static first frame server-rendered so the section is
 * meaningful with JS off").
 *
 * WHY this exists (the iteration-4 Lighthouse blocker): every home/pricing
 * client island — the two-phones hero, the deep-dive, the two bento thread
 * tiles, the crew-size slider, the missed-text calculator, the area-code
 * widget, the segment counter — was a STATIC import, so all of them landed in
 * the initial bundle and hydrated on load. That is ~2s of main-thread script
 * evaluation → TBT ~1.7–2.1s → mobile Perf < 90. Deferring the non-critical
 * islands cuts the initial bundle and spreads (or eliminates) their eval.
 *
 * HOW it works, without shipping a wireframe:
 *  - The server renders `fallback` — a real, meaningful static frame (the
 *    COMPLETED thread, or the widget's resting state). That frame is what the
 *    LCP paints and what a no-JS / reduced-motion visitor keeps. It is NOT a
 *    skeleton; the page is fully useful before (and without) the island.
 *  - The heavy component is code-split behind a dynamic `import()` supplied by
 *    the caller as `load`. Nothing of it is in the initial chunk.
 *  - We only fire that `import()` when the island nears the viewport (rootMargin
 *    pre-warms it) OR, for above-the-fold islands (`eager`), after the page has
 *    gone idle — so first paint and the hero LCP are never blocked by it.
 *  - Reduced-motion: the interactive layer for pure-motion islands (the thread
 *    demos) never needs to load at all — the static completed frame IS the
 *    reduced-motion experience — so `skipWhenReducedMotion` keeps them static.
 *
 * CLS-safe: the swap happens inside whatever box the caller reserves; the
 * fallback and the loaded island occupy the same layout slot, so nothing
 * shifts. The mounted island replaces the fallback in place.
 */

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

/**
 * Keyed on the loaded component type `C` (not a free prop type), so
 * `componentProps` is exactly the props `C` declares — no `never`-inference and
 * no prop-variance friction between the loader's component and the forwarded
 * props (the iteration-4 typecheck friction).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface LazyIslandProps<C extends ComponentType<any>> {
  /** The static, meaningful server-rendered frame (LCP / no-JS / pre-hydration). */
  fallback: ReactNode;
  /** Code-split loader for the interactive island, e.g. `() => import("…")`. */
  load: () => Promise<{ default: C }>;
  /** Props forwarded to the loaded island (exactly `C`'s props). */
  componentProps?: React.ComponentProps<C>;
  /**
   * Load after idle instead of on viewport approach. Use for above-the-fold
   * islands (the hero) so the download/eval happens AFTER first paint + LCP,
   * never before them.
   */
  eager?: boolean;
  /**
   * When the reduced-motion preference is set, never load the interactive
   * layer — the static fallback already IS the finished, meaningful frame. Used
   * by the pure-motion thread demos (the slider/calculator/widget still load,
   * because they are functional, not decorative motion).
   */
  skipWhenReducedMotion?: boolean;
  /** Pre-warm distance before the island enters the viewport (default 400px). */
  rootMargin?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function LazyIsland<C extends ComponentType<any>>({
  fallback,
  load,
  componentProps,
  eager = false,
  skipWhenReducedMotion = false,
  rootMargin = "400px 0px",
}: LazyIslandProps<C>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [Loaded, setLoaded] = useState<C | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Honor reduced motion for pure-motion islands: the static frame is enough.
    if (
      skipWhenReducedMotion &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const start = () => {
      if (cancelled) return;
      load()
        .then((mod) => {
          if (!cancelled) setLoaded(() => mod.default);
        })
        .catch(() => {
          // On a chunk-load failure the static fallback simply stays — the
          // section remains meaningful, never blank.
        });
    };

    // Above-the-fold islands: wait for idle so first paint + LCP win the CPU.
    if (eager) {
      const w = window as Window &
        typeof globalThis & {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        };
      if (typeof w.requestIdleCallback === "function") {
        const id = w.requestIdleCallback(start, { timeout: 2000 });
        return () => {
          cancelled = true;
          w.cancelIdleCallback?.(id);
        };
      }
      const t = window.setTimeout(start, 200);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }

    // Below-the-fold islands: load on viewport approach.
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      start();
      return () => {
        cancelled = true;
      };
    }

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          obs.disconnect();
          start();
        }
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, [eager, load, rootMargin, skipWhenReducedMotion]);

  // Once loaded, the island replaces the fallback in the same layout slot.
  const Island = Loaded;
  return (
    <div ref={rootRef}>
      {Island ? (
        <Island {...((componentProps ?? {}) as React.ComponentProps<C>)} />
      ) : (
        fallback
      )}
    </div>
  );
}
