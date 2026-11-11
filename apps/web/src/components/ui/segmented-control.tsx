"use client";

import { useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * The option a key moves to: arrows step and wrap at both ends, Home and End
 * jump there, and any other key returns `current` so the caller leaves the
 * event alone.
 */
export function nextOptionIndex(
  key: string,
  current: number,
  count: number,
): number {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return current;
  }
}

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** An icon before the label, or alone when `iconOnly`. */
  icon?: React.ReactNode;
  /** A count or note after the label, such as the inbox's open count. */
  badge?: React.ReactNode;
}

/**
 * #733: the one segmented control: a stone track with the chosen option lifted
 * to a paper pill. One choice among a few, so it is a radio group: arrow keys
 * move the choice, Home and End jump to the ends, and only the chosen option is
 * in the tab order. `md` sits in a page's filter row (44px tall on a phone);
 * `sm` sits inside a card, such as a measure's 7d / 30d / 90d.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = "md",
  fill = false,
  iconOnly = false,
  disabled = false,
  className,
}: {
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "md" | "sm";
  /** Stretch the options to fill the row. */
  fill?: boolean;
  /** Show only each option's icon; its label is still spoken. */
  iconOnly?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const at = options.findIndex((option) => option.value === value);
    const next = nextOptionIndex(event.key, at, options.length);
    if (next === at || disabled) return;
    event.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        "flex min-w-0 gap-0.5 rounded-full bg-app-line-soft p-[3px] transition-opacity duration-150 ease-out dark:bg-white/5",
        fill && "flex-1",
        disabled && "opacity-45",
        className,
      )}
    >
      {options.map((option, index) => {
        const chosen = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={iconOnly ? option.label : undefined}
            title={iconOnly ? option.label : undefined}
            tabIndex={chosen ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-full transition-[color,background] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "md"
                ? "min-h-11 px-3 py-1 text-[12.5px] md:min-h-[28px]"
                : "tap-target px-2 py-0.5 text-[11px]",
              fill && "flex-1",
              chosen
                ? "bg-app-paper font-semibold text-app-ink"
                : "font-medium text-app-muted hover:text-app-ink",
            )}
          >
            {option.icon}
            {!iconOnly && option.label}
            {option.badge}
          </button>
        );
      })}
    </div>
  );
}
