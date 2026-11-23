"use client";

import { Check } from "lucide-react";

import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

import { THREAD_CATEGORIES, threadCategoryLabel, toggleThreadCategory } from "./thread-filter";
import type { ThreadFilter } from "./thread-filter";

/**
 * In-thread multi-select toggles (Messages · Notes · Events): all three start
 * active and can be mixed independently. Active toggles pair a Check mark with
 * a raised neutral chip surface so active vs inactive stays unmistakable in
 * both light and dark mode without competing with the primary Send CTA.
 */
export function ThreadFilterBar({
  value,
  onChange,
}: {
  value: ThreadFilter;
  onChange: (next: ThreadFilter) => void;
}) {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t("thread.showInConversationAria")}
      className="inline-flex flex-wrap items-center gap-1.5"
    >
      {THREAD_CATEGORIES.map((category) => {
        const on = value[category];
        return (
          <button
            key={category}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(toggleThreadCategory(value, category))}
            className={cn(
              "tap-target inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px] leading-snug transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on
                ? "border-app-ink/25 bg-app-paper font-semibold text-app-ink dark:border-app-tint-line dark:bg-app-tint"
                : "border-app-line bg-transparent font-medium text-app-muted-2 hover:border-app-ink/25 hover:bg-app-hover hover:text-app-ink dark:hover:border-app-tint-line",
            )}
          >
            {on && <Check className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />}
            {threadCategoryLabel(category, t)}
          </button>
        );
      })}
    </div>
  );
}
