/**
 * The hand-marker graphic language (DESIGN-DIRECTION §3–4). An inline-SVG set of
 * drawn marks, underline, circle, arrow, check, small annotation, in petrol or
 * marker-yellow, wobbly and organic (hand-laid, not geometric), used sparingly
 * and consistently: on headlines AND to annotate real screenshots. This is the
 * only "drawn" element in the system.
 *
 * Each mark:
 *  - is inline SVG (no image, no external asset, crisp at every DPR),
 *  - strokes a slightly-irregular path so it reads hand-drawn,
 *  - paints on once when its container reveals (via the .mkt-marker-path
 *    [data-draw] CSS keyframe) and is reduced-motion-safe (shows fully painted),
 *  - is aria-hidden (decorative; the meaning is in the text/screenshot it marks).
 *
 * Server components (pure SVG). Color defaults to petrol; pass color="marker"
 * for the yellow, or any CSS color.
 */

import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

type MarkerColor = "petrol" | "marker" | "deep" | "ink";

const COLOR_VAR: Record<MarkerColor, string> = {
  petrol: "var(--petrol)",
  marker: "var(--marker)",
  deep: "var(--deep)",
  ink: "var(--ink)",
};

interface BaseProps {
  /** Stroke color token (defaults to petrol). Any CSS color also works. */
  color?: MarkerColor | (string & {});
  /** Stroke width in SVG user units. */
  weight?: number;
  /** Paint-on animation when the mark reveals (reduced-motion shows painted). */
  draw?: boolean;
  className?: string;
}

function resolveColor(c: BaseProps["color"]): string {
  if (!c) return COLOR_VAR.petrol;
  return (COLOR_VAR as Record<string, string>)[c] ?? c;
}

/**
 * A hand underline, a wobbly stroke that sits under a word/phrase. Place it as
 * a positioned child under the text (absolute, full width) or inline. Default
 * width is a flexible viewBox so it scales to its box.
 */
export function MarkerUnderline({
  color,
  weight = 4,
  draw = true,
  className,
}: BaseProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 16"
      fill="none"
      preserveAspectRatio="none"
      className={cn("block h-[0.5em] w-full", className)}
    >
      {/* two overlapping wobbles = a real marker pass, not a clean line */}
      <path
        className="mkt-marker-path"
        data-draw={draw ? "true" : undefined}
        d="M3 9 C 40 4, 78 12, 120 7 S 180 6, 197 10"
        stroke={resolveColor(color)}
        strokeWidth={weight}
        strokeLinecap="round"
        style={
          {
            strokeDasharray: 230,
            strokeDashoffset: 0,
            "--marker-len": 230,
          } as CSSProperties
        }
      />
    </svg>
  );
}

/** A hand-drawn circle/oval around a word or a screenshot region. */
export function MarkerCircle({
  color,
  weight = 4,
  draw = true,
  className,
}: BaseProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 220 120"
      fill="none"
      preserveAspectRatio="none"
      className={cn("block h-full w-full", className)}
    >
      {/* an over-shooting hand oval (start/end don't quite meet) */}
      <path
        className="mkt-marker-path"
        data-draw={draw ? "true" : undefined}
        d="M148 12 C 60 2, 8 34, 14 66 C 20 104, 120 118, 178 104 C 224 92, 214 34, 150 16"
        stroke={resolveColor(color)}
        strokeWidth={weight}
        strokeLinecap="round"
        style={
          {
            strokeDasharray: 620,
            strokeDashoffset: 0,
            "--marker-len": 620,
          } as CSSProperties
        }
      />
    </svg>
  );
}

/** A hand arrow pointing at the meaningful part of a screenshot. */
export function MarkerArrow({
  color,
  weight = 4,
  draw = true,
  className,
}: BaseProps) {
  const c = resolveColor(color);
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 90"
      fill="none"
      className={cn("block", className)}
    >
      <path
        className="mkt-marker-path"
        data-draw={draw ? "true" : undefined}
        d="M8 12 C 40 20, 70 40, 96 70"
        stroke={c}
        strokeWidth={weight}
        strokeLinecap="round"
        style={
          {
            strokeDasharray: 130,
            strokeDashoffset: 0,
            "--marker-len": 130,
          } as CSSProperties
        }
      />
      {/* arrowhead, two short strokes, hand-angled */}
      <path
        className="mkt-marker-path"
        data-draw={draw ? "true" : undefined}
        d="M96 70 L 74 66 M96 70 L 90 48"
        stroke={c}
        strokeWidth={weight}
        strokeLinecap="round"
        style={
          {
            strokeDasharray: 60,
            strokeDashoffset: 0,
            "--marker-len": 60,
          } as CSSProperties
        }
      />
    </svg>
  );
}

/** A hand check, the "handled / caught" mark. */
export function MarkerCheck({
  color,
  weight = 4.5,
  draw = true,
  className,
}: BaseProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 48 48"
      fill="none"
      className={cn("block", className)}
    >
      <path
        className="mkt-marker-path"
        data-draw={draw ? "true" : undefined}
        d="M8 26 C 12 30, 16 36, 20 40 C 26 28, 32 16, 42 7"
        stroke={resolveColor(color)}
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={
          {
            strokeDasharray: 90,
            strokeDashoffset: 0,
            "--marker-len": 90,
          } as CSSProperties
        }
      />
    </svg>
  );
}

/**
 * A small annotation bracket + tick, the "look here" mark for a screenshot
 * callout, drawn beside the region it points at.
 */
export function MarkerAnnotation({
  color,
  weight = 3,
  draw = true,
  className,
}: BaseProps) {
  const c = resolveColor(color);
  return (
    <svg
      aria-hidden
      viewBox="0 0 60 90"
      fill="none"
      className={cn("block", className)}
    >
      <path
        className="mkt-marker-path"
        data-draw={draw ? "true" : undefined}
        d="M40 6 C 20 8, 16 40, 18 46 C 16 52, 20 82, 40 84"
        stroke={c}
        strokeWidth={weight}
        strokeLinecap="round"
        style={
          {
            strokeDasharray: 200,
            strokeDashoffset: 0,
            "--marker-len": 200,
          } as CSSProperties
        }
      />
      <path
        className="mkt-marker-path"
        data-draw={draw ? "true" : undefined}
        d="M18 46 L 30 46"
        stroke={c}
        strokeWidth={weight}
        strokeLinecap="round"
        style={
          {
            strokeDasharray: 14,
            strokeDashoffset: 0,
            "--marker-len": 14,
          } as CSSProperties
        }
      />
    </svg>
  );
}
