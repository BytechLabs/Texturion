"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Scroll-reveal wrapper (BLUEPRINT §1.5): opacity 0→1 + translateY 12px→0,
 * 300ms ease-out, ONCE, triggered at ~20% visibility via one tiny
 * IntersectionObserver (no animation library). The animation lives in
 * globals.css ([data-reveal]); this island only toggles data-revealed.
 *
 * CLS-safe: children render into an already-reserved box; only opacity and
 * transform change. prefers-reduced-motion is honored two ways — the CSS forces
 * the revealed state, and we also flip immediately without observing.
 *
 * `delay` supports the §1.5 stagger (60ms steps, max 4 items) when a parent
 * maps children. The smallest possible client island: a single element + one
 * observer, no children serialization cost (children pass through as-is).
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  /** Stagger delay in ms (§1.5: 60ms per item, capped by the caller). */
  delay?: number;
  as?: React.ElementType;
}) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Respect reduced motion and browsers without IO: show immediately.
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            observer.disconnect(); // once-only
            break;
          }
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      data-reveal=""
      data-revealed={revealed ? "true" : "false"}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={className}
    >
      {children}
    </Tag>
  );
}

/**
 * Convenience wrapper for a staggered group (§1.5: 60ms steps, max 4). Wrap each
 * child once; items past the 4th share the last delay so the cap holds.
 */
export function RevealGroup({
  children,
  className,
}: {
  children: React.ReactNode[];
  className?: string;
}) {
  return (
    <div className={cn(className)}>
      {children.map((child, i) => (
        <Reveal key={i} delay={Math.min(i, 3) * 60}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}
