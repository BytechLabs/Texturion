import { cn } from "@/lib/utils";

/**
 * FR CONVERGED FIELD (P5-SPEC v1, "Static fallback SVG"): the static
 * converged derivative of the Arrival Field, a composed still, not an
 * absence. Three cobalt streamline paths (12% alpha) converge from the
 * upper-left toward the inbox edge; four docked bubbles sit queued on the
 * approach line, green-filled with mono timestamps; ONE bubble is still
 * mid-path in Flare at 60% along the middle streamline (the story in a
 * single frame: one text still waiting; Flare whitelist §3.4.1).
 *
 * There is NO second live canvas anywhere on the site (Law 3): subpages and
 * the final CTA reuse THIS, never p5.
 *
 * Variants:
 *   "full"      The composed still (desktop hero box geometry, 520x560).
 *               This is also what the hero's reduced-motion/no-JS path can
 *               ship.
 *   "mark"      The small single-path page-header motif for subpages: one
 *               streamline, one Flare mark mid-path, one green docked mark.
 *               Stroke rides currentColor; the dots keep their token colors.
 *   "backdrop"  The final-CTA band backdrop: converging paths only, all
 *               currentColor (set text-white/…  on the cobalt band), no
 *               figures, no text. Absolutely position it behind the band's
 *               content.
 *
 * Decorative always: aria-hidden, no tab stops.
 *
 * Usage:
 *   <ConvergedField variant="mark" className="h-10 w-auto" />
 *   <ConvergedField variant="backdrop" className="absolute inset-0 h-full w-full text-white" />
 */
export function ConvergedField({
  variant = "full",
  className,
}: {
  variant?: "full" | "mark" | "backdrop";
  className?: string;
}) {
  if (variant === "mark") {
    return (
      <svg
        viewBox="0 0 220 56"
        className={cn("text-[color:var(--fr-cobalt)]", className)}
        aria-hidden="true"
        focusable="false"
      >
        {/* One streamline, settled. */}
        <path
          d="M4 10 C 64 4, 128 26, 204 40"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* The one still waiting, at 60% along the path (§3.4.1). */}
        <circle cx="128" cy="22" r="4" fill="var(--fr-flare)" />
        {/* Docked: handled (green whitelist). */}
        <circle cx="204" cy="40" r="4.5" fill="var(--fr-green)" />
      </svg>
    );
  }

  if (variant === "backdrop") {
    return (
      <svg
        viewBox="0 0 1200 400"
        preserveAspectRatio="xMidYMid slice"
        className={className}
        aria-hidden="true"
        focusable="false"
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M-40 40 C 320 10, 640 120, 1160 196" strokeOpacity="0.14" />
          <path d="M-40 190 C 340 200, 700 190, 1160 210" strokeOpacity="0.18" />
          <path d="M-40 360 C 320 380, 680 300, 1160 224" strokeOpacity="0.14" />
        </g>
      </svg>
    );
  }

  /* "full": the composed still, desktop hero box geometry. */
  const docked = [
    { x: 368, y: 254, label: "6:48 AM", labelX: 300 },
    { x: 404, y: 266, label: "12:15 PM", labelX: 328 },
    { x: 440, y: 276, label: "5:31 PM", labelX: 372 },
    { x: 476, y: 285, label: "8:47 AM", labelX: 408 },
  ];

  return (
    <svg
      viewBox="0 0 520 560"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" strokeWidth="2" strokeLinecap="round">
        <path
          d="M0 64 C 180 40, 320 150, 500 264"
          stroke="var(--fr-cobalt)"
          strokeOpacity="0.12"
        />
        <path
          d="M0 200 C 160 210, 320 240, 500 280"
          stroke="var(--fr-cobalt)"
          strokeOpacity="0.12"
        />
        <path
          d="M0 430 C 180 448, 330 360, 500 296"
          stroke="var(--fr-cobalt)"
          strokeOpacity="0.12"
        />
      </g>

      {/* Four docked texts, queued on the approach line: answered, green. */}
      {docked.map((b) => (
        <g key={b.label}>
          <rect
            x={b.x}
            y={b.y}
            width="22"
            height="14"
            rx="5"
            fill="var(--fr-green)"
          />
          <text
            x={b.labelX}
            y={b.y + 11}
            fontFamily="var(--font-mono), ui-monospace, monospace"
            fontSize="11"
            fill="var(--fr-ink)"
            fillOpacity="0.6"
          >
            {b.label}
          </text>
        </g>
      ))}

      {/* The one still waiting: Flare, 60% along the middle streamline. */}
      <rect
        x="288"
        y="228"
        width="22"
        height="14"
        rx="5"
        fill="var(--fr-flare)"
      />
      <text
        x="318"
        y="239"
        fontFamily="var(--font-mono), ui-monospace, monospace"
        fontSize="11"
        fill="var(--fr-ink)"
        fillOpacity="0.6"
      >
        9:04 PM
      </text>
    </svg>
  );
}
