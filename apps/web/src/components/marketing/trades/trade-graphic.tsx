/**
 * <TradeGraphic> — the framed card that presents a trade page's supporting
 * illustration beside the "how JobText fits" copy (BLUEPRINT §5, VISUALS §3
 * trade-page rule: hero thread demo PLUS at least one supporting graphic). A
 * thin, shared presentational shell so all six trade pages frame their art
 * identically (card, 10px radius, ambient shadow, centered caption) while each
 * supplies its own trade-relevant art and caption — no shared prose.
 *
 * Server component. The art inside is inline SVG (LCP-safe, themeable); the
 * caption carries the one-line, trade-specific meaning.
 */

import { Photo } from "@/components/marketing/photo";
import { cn } from "@/lib/utils";

/**
 * <TradePhoto> — a framed real photograph for a trade page's body (the "sound
 * familiar?" pain beat and any secondary photo slot). Same ticket frame as the
 * product visuals (10px+ radius, 1px border, ambient shadow) with an honest
 * caption, so every trade page carries at least TWO real trade photos in one
 * consistent frame (VISUALS-V2 §2). Server component.
 */
export function TradePhoto({
  photoId,
  caption,
  className,
  priority = false,
}: {
  /** Photography-set manifest id, e.g. "plumber-heater", "salon-stylist". */
  photoId: string;
  /** One-line, trade-specific honest caption. */
  caption: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <figure
      className={cn(
        "mx-auto max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]",
        className,
      )}
    >
      <Photo
        id={photoId}
        priority={priority}
        sizes="(min-width: 1024px) 28rem, 100vw"
        imgClassName="aspect-[4/3] object-cover"
      />
      <figcaption className="border-t border-border px-5 py-4 text-[13px] leading-relaxed text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}

export function TradeGraphic({
  children,
  caption,
  className,
}: {
  /** The trade-relevant spot illustration (from the art system). */
  children: React.ReactNode;
  /** One-line, trade-specific caption under the art. */
  caption: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto max-w-md rounded-2xl border border-border bg-card p-8 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]",
        className,
      )}
    >
      {children}
      <p className="mt-6 text-center text-[13px] leading-relaxed text-muted-foreground">
        {caption}
      </p>
    </div>
  );
}
