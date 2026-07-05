"use client";

import { useEffect, useRef } from "react";

/**
 * S7's odometer trigger (~0.5KB gz): the one client island of the final CTA.
 * Arms the phone-number ROLL exactly once, when the number scrolls into view,
 * by setting `data-anim` on this wrapper (night-css v3 contract: arming IS
 * firing). The RollNumber's strips render pre-seated on their digits, so
 * before JS runs (and forever under no-JS) the number sits in its resolved,
 * seated state, which is the spec-sanctioned default.
 *
 * Reduced motion: bail before observing (CSS double-gates behind
 * prefers-reduced-motion anyway, spec §8). Fires once, then disconnects, so
 * scrolling back never re-rolls the number (spec §5: reveals fire once and
 * stay).
 */
export function Odometer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          // Arm + fire: the strips re-run from 0 to their seated digits.
          el.setAttribute("data-anim", "on");
          io.disconnect();
        }
      },
      // Fire when the number is genuinely on screen, not at first pixel:
      // the roll is the section's one beat and should be seen whole.
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
