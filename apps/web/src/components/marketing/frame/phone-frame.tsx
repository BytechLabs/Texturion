/**
 * <PhoneFrame>, the v4 phone bezel around arbitrary children
 * (DESIGN-DIRECTION v4 §5.2 PANEL FRAME grammar).
 *
 * A Dispatch Ink rim (the same bezel <PanelFrame phone> draws) with NO
 * Apple/Android device cosplay, which keeps the PWA story honest ("works on
 * every phone, no download"). The screen inside is white; callers staging the
 * app's own dark mode wrap their content in a local `.dark` region via
 * <PanelFrame phone phoneDark> instead, which also provides the `.app-scope`
 * token region real product embeds need (Law 2).
 *
 * Optional `pushBanner` draws a web-push notification card over the top of
 * the screen, the same banner grammar the app uses for incoming-message
 * toasts (the app's icon + title + snippet). The mark is the double-o brand
 * tile (#206, brand/README.md) because it depicts the app's own launcher
 * icon inside the frame; marketing cobalt never crosses the bezel (Law 2).
 *
 * Server component, light-only, reduced-motion safe, zero-CLS.
 */

import { BrandTile } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";

export interface PhoneFrameProps {
  children: React.ReactNode;
  /** A web-push notification card drawn over the top of the screen. */
  pushBanner?: { title: string; body: string };
  /** Drop the card shadow for a flat inline shot. */
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
        "relative mx-auto w-full max-w-[300px] rounded-[2.25rem] bg-[color:var(--fr-ink)] p-2",
        !flat && "shadow-[var(--fr-shadow-card)]",
        className,
      )}
    >
      <div className="relative overflow-hidden rounded-[1.75rem] bg-white">
        {/* Neutral speaker pill, a "phone" hint, not a specific device's notch. */}
        <div className="flex justify-center pt-2" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-[color:var(--fr-frost)]" />
        </div>

        {pushBanner && (
          <div className="absolute inset-x-2 top-4 z-10 rounded-xl bg-white/95 px-3 py-2 shadow-[var(--fr-shadow-card)] backdrop-blur">
            <div className="flex items-center gap-2">
              {/* The app's own icon: the double-o tile (#206) inside the
                  frame, never marketing cobalt (Law 2). */}
              <BrandTile className="size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold text-[color:var(--fr-ink)]">
                  {pushBanner.title}
                </p>
                <p className="truncate text-[11px] text-[color:var(--fr-ink-55)]">
                  {pushBanner.body}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className={cn("mt-1", contentClassName)}>{children}</div>
      </div>
    </div>
  );
}
