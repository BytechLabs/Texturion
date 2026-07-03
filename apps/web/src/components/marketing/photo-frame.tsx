/**
 * <PhotoFrame> — the one cohesive treatment for real photography on the
 * marketing site (VISUALS-V2 §2). Every warm tradesperson photo is framed the
 * same way — one border, one radius, one soft ambient shadow, a warm-stone mat,
 * a fixed 4:3 crop — so the whole set reads as if one art director shot it.
 *
 * An optional overlaid "ticket" caption pins the photo into the job-ledger
 * vocabulary: a small white chip in the corner with the ticket-meta texture
 * (e.g. a status pill + a name), so a real photo still wears the brand
 * fingerprint without any hand-drawn art. The chip is honest — it labels the
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
  /** Override the manifest alt (rare — the manifest alt is usually right). */
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
   * An optional corner caption ticket. `pill` renders a tinted status-style chip;
   * `label` is the plain text beside it. Kept short — it's a label, not a claim.
   */
  caption?: { pill?: string; label: string };
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
      {/* The warm mat + frame: 1px stone border, the app's 10px radius bumped to
          a friendlier 16px for imagery, one soft ambient shadow (the BLUEPRINT
          §1.3 marketing exception, allowed on framed product/photo visuals). */}
      <div className="overflow-hidden rounded-2xl border border-border bg-secondary shadow-[0_24px_64px_-32px_rgba(28,25,23,0.28)]">
        <div className="relative w-full" style={{ aspectRatio: aspect }}>
          <Photo
            id={id}
            alt={alt}
            priority={priority}
            sizes={sizes}
            className="absolute inset-0 h-full w-full"
            imgClassName="h-full w-full object-cover"
          />
          {/* A whisper of warm light over the lower edge so overlaid captions and
              the frame edge read cleanly on any photo — decorative, aria-hidden. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-stone-950/20 via-transparent to-transparent"
          />
        </div>
      </div>

      {/* The corner caption ticket — a real photo, wearing the ledger chip. */}
      {caption && (
        <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-xl border border-border bg-card/95 px-3 py-1.5 shadow-sm backdrop-blur">
          {caption.pill && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-teal-800 dark:text-primary">
              {caption.pill}
            </span>
          )}
          <span className="jt-meta text-foreground">{caption.label}</span>
        </div>
      )}
    </div>
  );
}
