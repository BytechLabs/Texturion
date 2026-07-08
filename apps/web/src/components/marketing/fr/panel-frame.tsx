import { cn } from "@/lib/utils";

import { DemoChip, type DemoChipVariant } from "./chips";

/**
 * FR PANEL FRAME (DESIGN-DIRECTION v4 §5.2, Law 2): the marketing chrome
 * around every REAL product embed. The frame is marketing (white card, 16px
 * radius, the one shadow, optional browser-chrome hint or phone bezel); the
 * product inside renders with the APP'S OWN TOKENS, because children are
 * wrapped in an `.app-scope` region — so ConversationRow, the thread UI, the
 * usage meter, the template picker, the composer, and the segment counter
 * keep their petrol primary, their own bubble colors, their own unread-dot
 * color. Marketing cobalt stays OUTSIDE the frame. Do not recolor bubbles.
 * Ever.
 *
 * The only label ever attached is the mono chip (SCRIPTED DEMO, or
 * EXAMPLE CONVERSATION on trade pages) plus an optional caption that
 * describes the CONTENT, never the artifact (no "real interface", no
 * "not a screenshot").
 *
 * Usage:
 *   <PanelFrame chromeUrl="loonext.com/inbox" chip="scripted-demo"
 *               caption="A Reyes Plumbing conversation.">
 *     <InboxEmbed />
 *   </PanelFrame>
 *
 *   <PanelFrame phone phoneDark caption="Dark mode for 6am starts.">
 *     <ThreadEmbed />
 *   </PanelFrame>
 */
export function PanelFrame({
  children,
  chromeUrl,
  phone = false,
  phoneDark = false,
  chip,
  caption,
  className,
  embedClassName,
  ariaLabel,
}: {
  /** The REAL product component(s); rendered inside `.app-scope`. */
  children: React.ReactNode;
  /** Optional browser-chrome hint, e.g. "loonext.com/inbox". */
  chromeUrl?: string;
  /** Phone bezel instead of the flat card (for mobile/dark-mode staging). */
  phone?: boolean;
  /** With `phone`: flips the embed to the app's own dark mode (a local
      `.dark` region; the app tokens inside do the flipping). */
  phoneDark?: boolean;
  /** The one permitted content label (Law 1). Omit for none. */
  chip?: DemoChipVariant;
  /** Caption under the frame: content-descriptive, ink-55, body face. */
  caption?: string;
  className?: string;
  /** Extra classes on the inner `.app-scope` embed region. */
  embedClassName?: string;
  /** Accessible name describing the CONTENT (e.g. "A Reyes Plumbing
      conversation in the Loonext inbox"), never the artifact. */
  ariaLabel?: string;
}) {
  const embed = (
    <div
      className={cn(
        "app-scope overflow-hidden",
        phone ? "rounded-[1.75rem]" : chromeUrl ? "rounded-b-2xl" : "rounded-2xl",
        embedClassName,
      )}
    >
      {children}
    </div>
  );

  return (
    <figure className={cn("m-0", className)} aria-label={ariaLabel}>
      {phone ? (
        /* Phone bezel: an ink rim around the app surface; inside it the
           product's own light or dark theme applies. */
        <div className="mx-auto w-full max-w-[22.5rem] rounded-[2.25rem] bg-[color:var(--fr-ink)] p-2 shadow-[var(--fr-shadow-card)]">
          {phoneDark ? <div className="dark rounded-[1.75rem]">{embed}</div> : embed}
        </div>
      ) : (
        <div className="fr-card overflow-hidden rounded-2xl">
          {chromeUrl ? (
            <div className="flex items-center gap-2 px-4 py-2.5">
              <span className="flex gap-1.5" aria-hidden>
                <span className="size-2 rounded-full bg-[color:var(--fr-frost)]" />
                <span className="size-2 rounded-full bg-[color:var(--fr-frost)]" />
                <span className="size-2 rounded-full bg-[color:var(--fr-frost)]" />
              </span>
              <span className="fr-mono-data mx-auto rounded-[6px] bg-[color:var(--fr-frost)] px-3 py-1 text-xs text-[color:var(--fr-ink-55)]">
                {chromeUrl}
              </span>
              {/* Balance spacer so the URL centers against the dots. */}
              <span className="w-9" aria-hidden />
            </div>
          ) : null}
          {embed}
        </div>
      )}

      {chip || caption ? (
        <figcaption className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {chip ? <DemoChip variant={chip} /> : null}
          {caption ? (
            <span className="font-body-mkt text-sm text-[color:var(--fr-ink-55)]">
              {caption}
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
