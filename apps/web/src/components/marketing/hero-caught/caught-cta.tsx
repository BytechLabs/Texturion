"use client";

/**
 * CaughtCta, the ONE primary hero CTA, "Start for $29", with a restrained
 * pointer-move magnetic pull (a tiny translate toward the cursor). Pointer-only,
 * disabled on touch and under prefers-reduced-motion. The button keeps the exact
 * words through the flow (DESIGN-DIRECTION §6: "Start for $29" stays "Start for
 * $29"). Renders the shared <Button> (components/ui, consumed not modified) as a
 * link. Progressive enhancement: server-renders as the plain petrol button; the
 * pull attaches after hydration on a fine pointer only.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";

const MAX_PULL = 6; // px, restrained

export function CaughtCta() {
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
      <Button asChild size="lg" className="min-h-11 w-full sm:w-auto md:min-h-0">
        <Link href="/signup">
          Start for $29
          <ArrowRight strokeWidth={1.75} aria-hidden />
        </Link>
      </Button>
    </span>
  );
}
