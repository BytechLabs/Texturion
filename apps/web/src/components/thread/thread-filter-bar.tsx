"use client";

import {
  THREAD_FILTER_LABELS,
  THREAD_FILTERS,
  type ThreadFilter,
} from "./thread-filter";

/**
 * The §5.1 in-thread segmented control — All | Messages | Notes | Events. Same
 * tokens as the inbox status tabs: a QUIET stone active pill, never petrol
 * (§5.1 / §2.1 accent budget). `role="tablist"` with `aria-selected` per §7
 * a11y. Four segments fit at 375px (§7 mobile-first). Near-invisible until used
 * (stone chrome) — "nothing fights for attention".
 */
export function ThreadFilterBar({
  value,
  onChange,
}: {
  value: ThreadFilter;
  onChange: (next: ThreadFilter) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filter conversation"
      // Calm app tokens only — the segment track + active pill carry their own
      // dark values (mirrors the inbox filter bar). The prior raw `stone-*` dark
      // classes rendered a low-contrast dark blob in dark mode where the inactive
      // labels vanished, so only "All" was visible.
      className="inline-flex items-center gap-0.5 rounded-full bg-app-line-soft p-0.5 dark:bg-white/5"
    >
      {THREAD_FILTERS.map((filter) => {
        const active = value === filter;
        return (
          <button
            key={filter}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(filter)}
            className={
              // tap-target keeps the ≥44px mobile hit area (globals.css).
              "tap-target rounded-full px-3 py-1 text-[13px] font-medium transition-colors duration-150 ease-out " +
              (active
                ? "bg-app-white text-app-ink"
                : "text-app-muted hover:text-app-ink")
            }
          >
            {THREAD_FILTER_LABELS[filter]}
          </button>
        );
      })}
    </div>
  );
}
