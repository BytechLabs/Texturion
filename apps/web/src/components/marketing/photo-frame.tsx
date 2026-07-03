/**
 * <PhotoFrame>, the one cohesive treatment for real photography on the
 * marketing site (DESIGN-DIRECTION §4). Every duotone-graded tradesperson photo
 * is framed the same way: one warm hairline, one radius, one soft ambient
 * shadow over the painted-panel paper, a fixed 4:3 crop, so the whole set reads
 * as if one art director shot and graded it.
 *
 * An optional overlaid "ticket" caption pins the photo into the job-ledger
 * vocabulary: a small white chip in the corner with the ticket-meta texture
 * (e.g. a status pill + a name), so a real photo still wears the brand
 * fingerprint without any hand-drawn art. The chip is honest, it labels the
 * scene, it never asserts a metric.
 *
 * Performance (VISUALS-V2 §7): the crop box has a fixed aspect ratio so there's
 * zero layout shift; <Photo> serves AVIF→WebP over a blur-up placeholder and
 * lazy-loads below the fold (pass `priority` above it). Server component.
 */

import { Photo } from "@/components/marketing/photo";
import { cn } from "@/lib/utils";

export interface PhotoFrameProps {
  /** Manifest key for <Photo>, e.g. "owner-apron-phone". */
  id: string;
  /** Override the manifest alt (rare, the manifest alt is usually right). */
  alt?: string;
  /** Above the fold? Eager-load. Most home photos are below → lazy default. */
  priority?: boolean;
  /** Responsive `sizes` hint passed through to <Photo>. */
  sizes?: string;
  /** Aspect ratio of the crop box. Default a warm editorial 4:3. */
  aspect?: string;
  /** Outer wrapper class (sizing / max-width / justify). */
  className?: string;
  /**
   * An optional corner caption. A short, true label only. No status pill: the
   * decorative "Live" / "Filed" / "New" chips were a fake-activity badge
   * (DESIGN-DIRECTION §0) and are removed; a caption is a label, not a claim.
   */
  caption?: { label: string };
}

export function PhotoFrame({
  id,
  alt,
  priority = false,
  sizes = "(min-width: 1024px) 42vw, 92vw",
  aspect = "4 / 3",
  className,
  caption,
}: PhotoFrameProps) {
  return (
    <div className={cn("relative", className)}>
      {/* The painted-panel frame (DESIGN-DIRECTION §3-§4): one warm hairline, a
          16px radius for imagery, one soft ambient shadow (the marketing
          exception allowed on framed product/photo visuals). The photo is a
          real, duotone-graded frame in the palette (petrol shadows, paper
          highlights); the frame is the one consistent language around it. */}
      <div className="overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] shadow-[0_24px_64px_-32px_rgba(11,79,73,0.28)]">
        <div className="relative w-full" style={{ aspectRatio: aspect }}>
          <Photo
            id={id}
            alt={alt}
            priority={priority}
            sizes={sizes}
            className="absolute inset-0 h-full w-full"
            imgClassName="h-full w-full object-cover"
          />
          {/* A whisper of deep-petrol over the lower edge so overlaid captions and
              the frame edge read cleanly on any photo, decorative, aria-hidden. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[color:var(--deep)]/25 via-transparent to-transparent"
          />
        </div>
      </div>

      {/* The corner caption, a short, true label over a real photo. Mono meta
          voice, on a paper chip, no fake status pill (§0). */}
      {caption && (
        <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-xl border border-[color:var(--hairline)] bg-[color:var(--paper)]/95 px-3 py-1.5 shadow-sm backdrop-blur">
          <span className="font-mono-mkt text-[13px] text-[color:var(--ink)]">
            {caption.label}
          </span>
        </div>
      )}
    </div>
  );
}
