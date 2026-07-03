/**
 * <PhoneFrame>, a clean, platform-neutral phone bezel around arbitrary children
 * (VISUALS §1B/§4.3, BLUEPRINT §1.3).
 *
 * A neutral rounded frame (stone ring, 28px radius) with NO Apple/Android device
 * chrome, keeps the PWA story honest ("works on every phone, no download"). A
 * subtle top speaker pill hints "phone" without cosplaying a specific handset.
 * Wraps mobile screenshots AND live-DOM thread renders alike.
 *
 * Optional `pushBanner` draws a web-push notification card over the top of the
 * screen (the dark-band / PWA moment, BLUEPRINT §3.8), the same banner grammar
 * the app uses for incoming-message toasts (petrol "J" mark + title + snippet).
 *
 * Themeable (stone-200 ring → stone-800 on dark), reduced-motion safe, zero-CLS.
 * Server component.
 */

import { cn } from "@/lib/utils";

const AMBIENT_SHADOW = "shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]";

export interface PhoneFrameProps {
  children: React.ReactNode;
  /** A web-push notification card drawn over the top of the screen (§3.8). */
  pushBanner?: { title: string; body: string };
  /** Drop the ambient shadow for a flat inline shot. */
  flat?: boolean;
  /** Max width of the device. Defaults to a comfortable 300px inline size. */
  className?: string;
  /** Class on the inner screen well (padding/background for live-DOM renders). */
  contentClassName?: string;
}

export function PhoneFrame({
  children,
  pushBanner,
  flat = false,
  className,
  contentClassName,
}: PhoneFrameProps) {
  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-[300px] overflow-hidden rounded-[28px] border-[6px] border-stone-200 bg-card dark:border-stone-800",
        !flat && AMBIENT_SHADOW,
        className,
      )}
    >
      {/* Neutral speaker pill, a "phone" hint, not a specific device's notch. */}
      <div className="flex justify-center pt-2" aria-hidden>
        <span className="h-1 w-10 rounded-full bg-stone-200 dark:bg-stone-700" />
      </div>

      {pushBanner && (
        <div className="absolute inset-x-2 top-4 z-10 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-[10px] font-semibold text-primary-foreground">
              J
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-foreground">
                {pushBanner.title}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {pushBanner.body}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className={cn("mt-1", contentClassName)}>{children}</div>
    </div>
  );
}
