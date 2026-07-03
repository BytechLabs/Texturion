/**
 * <Illustration> — render one branded illustration from the illustration set
 * (public/illustrations/manifest.ts), the ONE cohesive library the marketing
 * rework standardizes on (VISUALS-V2 §3: unDraw, recolored to petrol/stone).
 *
 * These are REAL, professionally-made illustrations (not hand-authored SVG), so
 * they satisfy the "no self-made art" rule while staying weightless and crisp at
 * every DPR (inline-quality via <img src=".svg">). The build script already
 * recolored + optimized them; this component only frames one.
 *
 * Performance (VISUALS-V2 §7):
 *   - the reserved box uses the manifest's intrinsic w/h as an aspect ratio, so
 *     there is zero layout shift while the SVG loads (CLS-safe);
 *   - `loading="lazy"` + `decoding="async"` by default (pass `priority` for an
 *     above-the-fold one);
 *   - `images.unoptimized` is on (Cloudflare) and an SVG needs no resizing, so a
 *     plain <img> is correct.
 *
 * Honesty: an illustration is decorative support for the copy, never a claim.
 * Empty `alt=""` marks it decorative to a screen reader when a caption already
 * carries the meaning; otherwise the manifest's honest alt is used.
 *
 * Server component.
 */

import { getIllustration } from "@/../public/illustrations/manifest";
import { cn } from "@/lib/utils";

export interface IllustrationProps {
  /** Manifest key, e.g. "shared-inbox", "crew", "compliance-handled". */
  id: string;
  /** Override the manifest alt (e.g. "" to mark decorative when captioned). */
  alt?: string;
  /** Above-the-fold? Eager-load instead of lazy (rare — most are below). */
  priority?: boolean;
  /** Class on the <img> (sizing / max-width). */
  className?: string;
}

export function Illustration({
  id,
  alt,
  priority = false,
  className,
}: IllustrationProps) {
  const art = getIllustration(id);

  // Fail loud in dev if a key is wrong; render nothing in prod (a missing
  // decorative illustration must never break a page).
  if (!art) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(`<Illustration>: unknown id "${id}"`);
    }
    return null;
  }

  return (
    // Intentional plain <img>: these are inline-quality SVGs served as-is
    // (images.unoptimized on Cloudflare); next/image adds nothing for an SVG.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={art.src}
      width={art.w}
      height={art.h}
      alt={alt ?? art.alt}
      aria-hidden={alt === "" ? true : undefined}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={cn("block h-auto w-full max-w-full select-none", className)}
      draggable={false}
    />
  );
}
