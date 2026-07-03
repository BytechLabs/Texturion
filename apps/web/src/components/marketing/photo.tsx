/**
 * <Photo>, render one real photograph from the photography set
 * (public/img/manifest.ts): warm, authentic tradespeople / service-business
 * imagery (VISUALS-V2 §2), the replacement for the removed hand-made "art."
 *
 * A `<picture>` offering AVIF (preferred) → WebP, each with a responsive srcset
 * across the two emitted widths, over a blur-up placeholder. All performance
 * guardrails from VISUALS-V2 §7 are wired here so the rebuild can't regress them:
 *   - intrinsic width/height from the manifest → zero CLS;
 *   - `loading="lazy"` + `decoding="async"` by default (pass `priority` above fold);
 *   - the tiny blur data-URI sits behind as the background until the raster paints;
 *   - `images.unoptimized` is on (Cloudflare) and files are pre-sized at build
 *     time, so a plain <img>/<picture> is correct, next/image adds nothing.
 *
 * `sizes` defaults to a sensible full-width-on-mobile / half-on-desktop hint;
 * override at the call site when the layout box is known.
 *
 * Honesty: real licensed photography is illustrative, never a claim about the
 * product. Credits live in public/img/CREDITS.md.
 *
 * Server component.
 */

import { getPhoto } from "@/../public/img/manifest";
import { cn } from "@/lib/utils";

export interface PhotoProps {
  /** Manifest key, e.g. "owner-apron-phone", "plumber-pipe", "salon-cut". */
  id: string;
  /** Override the manifest alt (e.g. "" to mark decorative when captioned). */
  alt?: string;
  /** Above-the-fold? Eager-load instead of lazy (rare, most are below). */
  priority?: boolean;
  /** Responsive `sizes` hint; defaults to full-width mobile / half desktop. */
  sizes?: string;
  /** Class on the outer <picture> (sizing / aspect / rounding / object-fit). */
  className?: string;
  /** Class on the inner <img> (e.g. `object-cover h-full w-full`). */
  imgClassName?: string;
}

export function Photo({
  id,
  alt,
  priority = false,
  sizes = "(min-width: 1024px) 50vw, 100vw",
  className,
  imgClassName,
}: PhotoProps) {
  const photo = getPhoto(id);

  // Fail loud in dev if a key is wrong; render nothing in prod (a missing
  // decorative photo must never break a page).
  if (!photo) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(`<Photo>: unknown id "${id}"`);
    }
    return null;
  }

  return (
    <picture className={cn("block", className)}>
      <source type="image/avif" srcSet={photo.srcsetAvif} sizes={sizes} />
      <source type="image/webp" srcSet={photo.srcsetWebp} sizes={sizes} />
      <img
        src={photo.webp}
        width={photo.w}
        height={photo.h}
        alt={alt ?? photo.alt}
        aria-hidden={alt === "" ? true : undefined}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        // Blur-up: the tiny placeholder fills the reserved box until the raster
        // decodes and covers it.
        style={{
          backgroundImage: `url("${photo.blur}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        className={cn("block h-auto w-full", imgClassName)}
        draggable={false}
      />
    </picture>
  );
}
