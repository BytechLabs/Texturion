/**
 * <TwoPhonesStatic> — the COMPLETED two-phones composition, as pure server DOM.
 *
 * The static, LCP-safe, no-JS / reduced-motion / pre-hydration frame for the
 * hero signature moment (BLUEPRINT §3.1). It renders the finished state the
 * animated <TwoPhonesHero> only ever replays: the customer's plain text on the
 * left (generic Messages phone) and the same message materialized on the right
 * as a JobText conversation (real thread primitives).
 *
 * Carries NO client runtime — this is what the server ships and the hero H1's
 * LCP paints beside. <LazyIsland eager> swaps in the animated island only after
 * the page is idle, so the two-phones JS never blocks first paint or the LCP.
 * The markup mirrors two-phones-hero.tsx's finished state exactly (same phone
 * frame, same reserved heights) so the hydration swap is visually seamless and
 * CLS-free.
 */

import { WATER_HEATER_SCRIPT } from "./script";
import { StaticThread } from "./static-thread";

const CUSTOMER = WATER_HEATER_SCRIPT.beats[0];

/** Tiny inline photo glyph — matches two-phones-hero.tsx's PhotoGlyph. */
function PhotoGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

/** The generic customer Messages phone, at rest (message already shown). */
function GenericMessagesPhoneStatic() {
  if (CUSTOMER.kind !== "inbound") return null;
  return (
    <div className="relative mx-auto w-full max-w-[260px] overflow-hidden rounded-[28px] border-[6px] border-stone-200 bg-stone-50 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)] dark:border-stone-800 dark:bg-stone-950">
      <div className="border-b border-border/70 bg-white/70 px-4 py-3 text-center dark:bg-stone-900/70">
        <p className="text-[11px] text-muted-foreground">Messages</p>
        <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-foreground">
          {CUSTOMER.from}
        </p>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          to (416) 555-0119
        </p>
      </div>

      <div className="flex min-h-[248px] flex-col justify-end gap-2 px-3 py-4">
        <div className="flex flex-col items-start gap-1.5">
          {CUSTOMER.photo && (
            <div
              className="flex size-24 flex-col items-center justify-center gap-1 rounded-2xl bg-stone-200 text-center text-stone-500 dark:bg-stone-800 dark:text-stone-400"
              role="img"
              aria-label={`Photo: ${CUSTOMER.photo.label}`}
            >
              <PhotoGlyph />
              <span className="px-2 text-[9px] leading-tight">
                {CUSTOMER.photo.label}
              </span>
            </div>
          )}
          <div className="max-w-[88%] rounded-[18px] rounded-bl-[6px] bg-stone-200 px-3.5 py-2 text-[14px] leading-snug text-stone-800 dark:bg-stone-800 dark:text-stone-100">
            {CUSTOMER.body}
          </div>
          <span className="pl-1 text-[10px] text-muted-foreground">
            {CUSTOMER.time}
          </span>
        </div>
      </div>

      <div className="border-t border-border/70 px-3 py-2.5">
        <div className="flex h-8 items-center rounded-full border border-border bg-white px-3 text-[12px] text-muted-foreground dark:bg-stone-900">
          Text message
        </div>
      </div>
    </div>
  );
}

/** The materialization connector, at rest. */
function MaterializeConnectorStatic() {
  return (
    <div className="flex items-center justify-center lg:h-full lg:flex-col" aria-hidden>
      <div className="hidden flex-col items-center gap-2 lg:flex">
        <svg
          viewBox="0 0 80 24"
          className="h-6 w-20 text-primary"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 12h64" strokeDasharray="4 4" />
          <path d="m62 6 8 6-8 6" />
        </svg>
        <span className="max-w-[7rem] text-center text-[11px] font-medium leading-tight text-muted-foreground">
          lands in your shared inbox
        </span>
      </div>
      <div className="flex flex-col items-center gap-1 py-1 lg:hidden">
        <span className="text-[11px] font-medium text-muted-foreground">
          lands in your shared inbox
        </span>
        <svg
          viewBox="0 0 24 24"
          className="size-5 text-primary"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14" />
          <path d="m19 12-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}

export function TwoPhonesStatic() {
  return (
    <div>
      <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,0.82fr)_auto_minmax(0,1.15fr)] lg:gap-4">
        <div className="relative">
          <GenericMessagesPhoneStatic />
        </div>

        <MaterializeConnectorStatic />

        <div className="relative">
          <StaticThread
            script={WATER_HEATER_SCRIPT}
            framing="desktop"
            footer={
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                <span className="text-[12px] text-muted-foreground">
                  Your crew sees it, together.
                </span>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
