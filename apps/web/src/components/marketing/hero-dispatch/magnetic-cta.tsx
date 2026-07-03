"use client";

/**
 * MagneticCta (iteration 5, HERO-CONCEPT §4 — the magnetic CTA).
 *
 * The ONE primary petrol "Start for $29" button gets a restrained pointer-move
 * magnetic pull (a tiny translate toward the cursor). Pointer-only — disabled on
 * touch and under prefers-reduced-motion (§4). The desk's "file it" affordance
 * must never out-weigh this button: the desk teaches value, this button converts
 * (CONVERSION §2). It renders the shared <Button> (components/ui — NOT modified,
 * only consumed) as a link, wrapped in a span that applies the transform, so no
 * app style is touched.
 *
 * Progressive enhancement: server-renders as the plain petrol button; the pull
 * only attaches after hydration on a fine pointer. Zero layout impact (transform
 * only), tiny (~20 lines of logic).
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";

const MAX_PULL = 6; // px — restrained (§4: "a tiny translate")

export function MagneticCta() {
  const ref = useRef<HTMLSpanElement>(null);

  const onMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.pointerType !== "mouse") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = ((e.clientX - (r.left + r.width / 2)) / r.width) * 2;
    const dy = ((e.clientY - (r.top + r.height / 2)) / r.height) * 2;
    el.style.transform = `translate(${Math.max(-1, Math.min(1, dx)) * MAX_PULL}px, ${Math.max(-1, Math.min(1, dy)) * MAX_PULL}px)`;
  };

  const reset = () => {
    const el = ref.current;
    if (el) el.style.transform = "";
  };

  return (
    <span
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className="inline-block transition-transform duration-150 ease-out will-change-transform"
    >
      {/* The lg button is a 40px-tall visual; on mobile we size the visual box
          itself to ≥44px (min-h-11) so the primary CTA meets the touch-target
          bar without relying only on the tap-target pseudo-element, and revert to
          the 40px lg height from md up (mouse pointers). components/ui/button is
          NOT edited — this is a consumer className only. */}
      <Button asChild size="lg" className="min-h-11 w-full sm:w-auto md:min-h-0">
        <Link href="/signup">
          Start for $29
          <ArrowRight strokeWidth={1.75} aria-hidden />
        </Link>
      </Button>
    </span>
  );
}
