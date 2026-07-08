"use client";

/**
 * The hero inbox (P5-SPEC §"Coupling to the real DOM"): REAL conversation-row
 * patterns rendering with the app's own tokens (the app's petrol accents, the
 * app's unread-dot color; marketing never recolors them, Law 2). It must sit
 * inside a PanelFrame (`.app-scope`) wrapped in <AppSurface>.
 *
 * SSR renders the inbox in its FINISHED state (rows present, read), so no-JS
 * and pre-boot visitors always see a complete product, never a hole. When the
 * Arrival Field is live, each docked particle dispatches the bubbling
 * `loonext:arrival` CustomEvent; this component listens on `document`,
 * prepends the matching row with its unread state, settles it to read after
 * ~4s, caps the list at 4 rows, and drops the oldest.
 *
 * No tab stops: the demo rows are static content, not links (§7).
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import {
  ARRIVAL_SCRIPT,
  HERO_ARRIVAL_EVENT,
  INBOX_ROW_CAP,
} from "./arrival-script";

/** Initials the way the app's avatar draws them ("Karen M" → "KM"). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

interface RowState {
  /** Index into ARRIVAL_SCRIPT. */
  idx: number;
  unread: boolean;
  /** Stable render key (arrivals can repeat a script index). */
  key: number;
  /** True only for rows prepended live (drives the entrance animation). */
  arrived: boolean;
}

/** The finished state SSR ships: the first four scripted rows, read. */
const INITIAL_ROWS: RowState[] = ARRIVAL_SCRIPT.slice(0, INBOX_ROW_CAP).map(
  (_, idx) => ({ idx, unread: false, key: idx, arrived: false }),
);

function InboxRow({ row }: { row: RowState }) {
  const item = ARRIVAL_SCRIPT[row.idx];
  return (
    <div
      className={cn(
        "relative flex items-center gap-[11px] rounded-app-card border p-[10px]",
        "border-transparent",
        row.arrived &&
          "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-300 motion-safe:ease-out",
      )}
    >
      {/* Flat single-tone avatar: the app's petrol tint + petrol-deep initials. */}
      <span
        aria-hidden
        className="app-ava-petrol grid size-[36px] shrink-0 place-items-center rounded-xl text-[12.5px] font-semibold"
      >
        {initials(item.name)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-[13.5px] text-app-ink",
              row.unread ? "font-semibold" : "font-medium",
            )}
          >
            {item.name}
          </span>
          <span className="shrink-0 pr-3 text-[11.5px] tabular-nums text-app-muted-2">
            {item.time}
          </span>
        </span>
        <span className="mt-[2px] block truncate text-[12.5px] leading-[1.45] text-app-muted">
          {item.snippet}
        </span>
      </span>

      {/* Unread dot: the app's own primary token (petrol), never marketing
          cobalt (Law 2). */}
      {row.unread && (
        <span
          aria-hidden
          className="absolute right-[10px] top-[12px] size-2 rounded-full bg-primary"
        />
      )}
    </div>
  );
}

export function HeroInbox() {
  const [rows, setRows] = useState<RowState[]>(INITIAL_ROWS);
  const keyRef = useRef(INBOX_ROW_CAP);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const onArrival = (event: Event) => {
      const detail = (event as CustomEvent<{ scriptIndex?: number }>).detail;
      const idx = detail?.scriptIndex;
      if (typeof idx !== "number" || !ARRIVAL_SCRIPT[idx]) return;
      const key = keyRef.current++;
      // The animation REPLAYS the finished state (P5-SPEC): when a scripted
      // text re-arrives, its previous row leaves before the new one lands, so
      // the same customer never sits in the inbox twice.
      setRows((prev) =>
        [
          { idx, unread: true, key, arrived: true },
          ...prev.filter((r) => r.idx !== idx),
        ].slice(0, INBOX_ROW_CAP),
      );
      // The new text settles to read after ~4s (P5-SPEC).
      timersRef.current.push(
        setTimeout(() => {
          setRows((prev) =>
            prev.map((r) => (r.key === key ? { ...r, unread: false } : r)),
          );
        }, 4000),
      );
    };
    document.addEventListener(HERO_ARRIVAL_EVENT, onArrival);
    const timers = timersRef.current;
    return () => {
      document.removeEventListener(HERO_ARRIVAL_EVENT, onArrival);
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  const unreadCount = rows.filter((r) => r.unread).length;

  return (
    <div className="p-2">
      {/* Compact inbox header: the app's own voice for its own count. */}
      <div className="flex items-center justify-between px-[10px] pb-1 pt-1.5">
        <span className="text-[13px] font-semibold text-app-ink">Inbox</span>
        {unreadCount > 0 && (
          <span className="bg-primary inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none">
            {unreadCount}
          </span>
        )}
      </div>
      <div>
        {rows.map((row) => (
          <InboxRow key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
}
