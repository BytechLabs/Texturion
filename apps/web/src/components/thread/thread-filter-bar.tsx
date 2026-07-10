"use client";

import {
  THREAD_CATEGORIES,
  THREAD_CATEGORY_LABELS,
  toggleThreadCategory,
  type ThreadFilter,
} from "./thread-filter";

/**
 * The §5.1 in-thread toggles — Messages · Notes · Events, each an INDEPENDENT
 * on/off (#89): all on by default, mix-and-match, no "All" segment. Same tokens
 * as the inbox status tabs: a QUIET stone active pill, never petrol (§5.1 / §2.1
 * accent budget). `aria-pressed` per toggle (§7 a11y). Three toggles fit at
 * 375px (§7 mobile-first). Near-invisible until used (stone chrome) — "nothing
 * fights for attention".
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
      role="group"
      aria-label="Show in conversation"
      // Calm app tokens only — the track + pressed pill carry their own dark
      // values (mirrors the inbox filter bar) so inactive labels never vanish
      // into a low-contrast dark blob.
      className="inline-flex items-center gap-0.5 rounded-full bg-app-line-soft p-0.5 dark:bg-white/5"
    >
      {THREAD_CATEGORIES.map((category) => {
        const on = value[category];
        return (
          <button
            key={category}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(toggleThreadCategory(value, category))}
            className={
              // tap-target keeps the ≥44px mobile hit area (globals.css).
              "tap-target rounded-full px-3 py-1 text-[13px] font-medium transition-colors duration-150 ease-out " +
              (on
                ? "bg-app-white text-app-ink"
                : "text-app-muted hover:text-app-ink")
            }
          >
            {THREAD_CATEGORY_LABELS[category]}
          </button>
        );
      })}
    </div>
  );
}
