/**
 * <FramedShot>, a real product screenshot (shots/manifest.ts) rendered inside a
 * device frame, theme-correct, zero-CLS, AVIF-first (VISUALS §1A/§5, §4.3).
 *
 * The bridge between the captured-shot manifest and the frame primitives: it
 * takes a surface id (e.g. "inbox-list"), resolves the light+dark pair from the
 * manifest, and renders BOTH, the light shot visible in light mode, the dark
 * shot visible under the `.dark` class, with no JS, no hydration flash (pure
 * CSS `dark:` visibility). Each theme layer is a `<picture>` offering the AVIF
 * with a WebP fallback.
 *
 * Performance (VISUALS §5): the raster is pre-sized to its intrinsic width/height
 * (the manifest carries both → zero CLS), `loading="lazy"` + `decoding="async"`
 * for below-the-fold shots (the default; pass `priority` for an above-fold one),
 * and the tiny blurred `placeholder` data-URI sits behind as a blur-up so there
 * is no pop-in. `images.unoptimized` is on (Cloudflare), so a plain `<img>` is
 * correct, we sized the files ourselves at capture time.
 *
 * Server component. Wrap in <GlowFrame> at the call site for the hero/feature
 * depth moment; most inline shots sit flat and calm (VISUALS §1A).
 */

import { BrowserFrame } from "@/components/marketing/frame/browser-frame";
import { PhoneFrame } from "@/components/marketing/frame/phone-frame";
import { shotPair } from "@/../public/shots/manifest";
import type { Shot } from "@/../public/shots/manifest";
import { cn } from "@/lib/utils";

/** One theme layer: the AVIF (preferred) + WebP fallback, blur-up behind. */
function ShotPicture({
  shot,
  priority,
  className,
}: {
  shot: Shot;
  priority: boolean;
  className?: string;
}) {
  return (
    <picture className={className}>
      <source srcSet={shot.avif} type="image/avif" />
      <source srcSet={shot.src} type="image/webp" />
      {/* A plain <img>: images are unoptimized on Cloudflare and the file is
          pre-sized at capture time (VISUALS §5), so next/image adds nothing. */}
      <img
        src={shot.src}
        width={shot.width}
        height={shot.height}
        alt={shot.alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        // Blur-up: the tiny placeholder sits under the image and is covered
        // once it decodes; cover-sized so it fills the reserved box.
        style={{
          backgroundImage: `url("${shot.placeholder}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        className="block h-auto w-full"
      />
    </picture>
  );
}

export interface FramedShotProps {
  /** Surface id in the manifest, e.g. "inbox-list", "thread-open", "mobile-thread". */
  id: string;
  /** Override the device frame; defaults to the frame the manifest declares. */
  frame?: "browser" | "phone";
  /** URL slot for the browser chrome (defaults to the "it's just the web" hint). */
  url?: string;
  /** Drop the ambient shadow for a flat, calm inline shot. */
  flat?: boolean;
  /** Above-the-fold? Eager-load instead of lazy (rare, most shots are below). */
  priority?: boolean;
  /** A web-push banner over a phone shot (the dark-band PWA moment, §3.8). */
  pushBanner?: { title: string; body: string };
  /** Class on the outer frame (sizing/max-width). */
  className?: string;
  /** Class on the inner content well. */
  contentClassName?: string;
}

export function FramedShot({
  id,
  frame,
  url,
  flat,
  priority = false,
  pushBanner,
  className,
  contentClassName,
}: FramedShotProps) {
  const pair = shotPair(id);
  const light = pair.light;
  const dark = pair.dark;

  // Nothing to render if the manifest has no such shot, fail loud in dev,
  // render nothing in prod (callers must guard with a live-DOM fallback per the
  // task; every id used on the home page is verified present).
  if (!light && !dark) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(`FramedShot: no shot found for id "${id}"`);
    }
    return null;
  }

  const device = frame ?? light?.frame ?? dark?.frame ?? "browser";

  // Render both theme layers; CSS `dark:` visibility swaps them with no JS. If
  // only one theme was captured, it shows in both (still honest, same screen).
  const inner = (
    <>
      {light && (
        <ShotPicture
          shot={light}
          priority={priority}
          className={cn("block", dark && "dark:hidden")}
        />
      )}
      {dark && (
        <ShotPicture
          shot={dark}
          priority={priority}
          className={cn(light ? "hidden dark:block" : "block")}
        />
      )}
    </>
  );

  if (device === "phone") {
    return (
      <PhoneFrame
        flat={flat}
        pushBanner={pushBanner}
        className={className}
        contentClassName={contentClassName}
      >
        {inner}
      </PhoneFrame>
    );
  }

  return (
    <BrowserFrame
      url={url}
      flat={flat}
      className={className}
      contentClassName={contentClassName}
    >
      {inner}
    </BrowserFrame>
  );
}
