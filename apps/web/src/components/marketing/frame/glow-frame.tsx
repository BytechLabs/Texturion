"use client";

/**
 * <GlowFrame>, a glow + gentle-tilt wrapper for a framed product visual
 * (VISUALS §1B/§4, BLUEPRINT §1.3).
 *
 * Adds depth to a hero/feature-hero shot: a contained petrol glow behind the
 * child, plus an optional gentle settle-tilt (BLUEPRINT §1.3 caps it at 2°; no 3D
 * perspective stacks, those read dated). The tilt eases from its resting angle
 * to flat as the element scrolls into view, so a shot arrives with a whisper of
 * life and lands square.
 *
 * Reduced-motion safe: with `prefers-reduced-motion`, the child renders flat and
 * still immediately (no observer, no transform). The glow is a static CSS layer
 * either way. Themeable via the petrol token. Zero-CLS: transform/opacity only,
 * inside a reserved box.
 *
 * The smallest possible island, one element, one observer. Wraps a
 * <BrowserFrame>/<PhoneFrame> (or any node). For a purely static glow with no
 * tilt, pass `tilt={0}` and it renders as an inert wrapper (still fine on the
 * server-rendered first paint).
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface GlowFrameProps {
  children: React.ReactNode;
  /**
   * Resting tilt in degrees before the element settles flat on scroll-in.
   * Capped at ±2° per BLUEPRINT §1.3. Default 1.5°. `0` disables the tilt.
   */
  tilt?: number;
  /** Glow intensity: `"soft"` (inline shots) or `"hero"` (the one hero moment). */
  glow?: "soft" | "hero" | "none";
  className?: string;
}

/** Contained petrol glow layers, themeable (teal-500 lift on dark). */
const GLOW_LIGHT: Record<"soft" | "hero", string> = {
  soft: "radial-gradient(60% 55% at 50% 55%, rgba(15,118,110,0.12) 0%, rgba(15,118,110,0) 72%)",
  hero: "radial-gradient(62% 58% at 50% 52%, rgba(15,118,110,0.16) 0%, rgba(15,118,110,0) 72%)",
};
const GLOW_DARK: Record<"soft" | "hero", string> = {
  soft: "radial-gradient(60% 55% at 50% 55%, rgba(45,212,191,0.14) 0%, rgba(45,212,191,0) 72%)",
  hero: "radial-gradient(62% 58% at 50% 52%, rgba(45,212,191,0.18) 0%, rgba(45,212,191,0) 72%)",
};

export function GlowFrame({
  children,
  tilt = 1.5,
  glow = "soft",
  className,
}: GlowFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cap = Math.max(-2, Math.min(2, tilt));
  const [settled, setSettled] = useState(cap === 0);

  useEffect(() => {
    if (cap === 0) return;
    const node = ref.current;
    if (!node) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      setSettled(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setSettled(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cap]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      {glow !== "none" && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-8 -z-10 dark:hidden"
            style={{ backgroundImage: GLOW_LIGHT[glow] }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-8 -z-10 hidden dark:block"
            style={{ backgroundImage: GLOW_DARK[glow] }}
          />
        </>
      )}
      <div
        className="transition-transform duration-[600ms] ease-out will-change-transform motion-reduce:transition-none"
        style={{
          transform: settled ? "rotate(0deg)" : `rotate(${cap}deg)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
