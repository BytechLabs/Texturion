/**
 * <Texture>, a faint background texture primitive (VISUALS §1D, §4.1).
 *
 * Kills the "empty" feeling without noise: a whisper of dot-grid or topographic
 * line work, painted as an aria-hidden decorative layer BEHIND content. Pure CSS
 * gradients + a tiny inline data-URI SVG (never a large raster, VISUALS §5),
 * LCP-safe, themeable, zero network.
 *
 * Absolutely positioned to fill its (relative) parent. Fades toward the edges via
 * a radial mask so it reads as ambient depth, not wallpaper. Server component.
 *
 * Grammar note: the texture uses currentColor-independent stone/petrol tints at
 * very low alpha so it survives on both the stone-50 base and the stone-950 dark
 * band. One or two per section max (VISUALS §1D).
 */

import { cn } from "@/lib/utils";

type TextureVariant = "dots" | "grid" | "topo";

/**
 * Tiny tiling SVGs, base64-inlined as CSS backgrounds. Kept small (one motif per
 * tile) so the data URI is a few hundred bytes. `currentColor` can't be used in a
 * background-image URL, so these bake a neutral stone ink at low alpha that works
 * on light; dark mode lifts opacity via the wrapper (see `--tx-opacity`).
 */
const TILES: Record<TextureVariant, { uri: string; size: number }> = {
  // Dot grid, a single 1.2px dot per 22px cell.
  dots: {
    size: 22,
    uri:
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><circle cx='2' cy='2' r='1.1' fill='%2378716c'/></svg>`,
      ),
  },
  // Fine line grid, 1px hairlines on a 28px cell.
  grid: {
    size: 28,
    uri:
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><path d='M28 0H0V28' fill='none' stroke='%2378716c' stroke-width='1'/></svg>`,
      ),
  },
  // Topographic contour hint, two offset arcs per 80px cell.
  topo: {
    size: 80,
    uri:
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' fill='none' stroke='%2378716c' stroke-width='1'><path d='M-10 60 Q 40 20 90 60'/><path d='M-10 80 Q 40 40 90 80'/></svg>`,
      ),
  },
};

export interface TextureProps {
  variant?: TextureVariant;
  className?: string;
  /**
   * Edge-fade mask. `"radial"` (default) fades toward all edges, best for a
   * centered section motif. `"top"` fades in from the top edge only, best under
   * a hero. `"none"` tiles flat (rare).
   */
  fade?: "radial" | "top" | "bottom" | "none";
  /** Base opacity in light mode. Dark mode uses ~1.6× (texture reads faint on ink). */
  opacity?: number;
}

const FADE_MASK: Record<NonNullable<TextureProps["fade"]>, string | undefined> = {
  radial:
    "radial-gradient(ellipse 80% 70% at 50% 45%, #000 0%, transparent 78%)",
  top: "linear-gradient(180deg, #000 0%, transparent 85%)",
  bottom: "linear-gradient(0deg, #000 0%, transparent 85%)",
  none: undefined,
};

export function Texture({
  variant = "dots",
  className,
  fade = "radial",
  opacity = 0.5,
}: TextureProps) {
  const tile = TILES[variant];
  const mask = FADE_MASK[fade];

  return (
    <div
      aria-hidden="true"
      data-texture={variant}
      className={cn(
        "pointer-events-none absolute inset-0 -z-10",
        // Dark mode lifts the faint ink so the motif survives on stone-950.
        "opacity-[var(--tx-o)] dark:opacity-[var(--tx-o-dark)]",
        className,
      )}
      style={
        {
          backgroundImage: `url("${tile.uri}")`,
          backgroundSize: `${tile.size}px ${tile.size}px`,
          backgroundRepeat: "repeat",
          "--tx-o": opacity,
          "--tx-o-dark": Math.min(1, opacity * 1.6),
          ...(mask
            ? {
                WebkitMaskImage: mask,
                maskImage: mask,
              }
            : {}),
        } as React.CSSProperties
      }
    />
  );
}
