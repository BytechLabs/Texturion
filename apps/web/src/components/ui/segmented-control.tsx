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
    case "ArrowDown": {
      return (current + 1) % count;
    }
    case "ArrowLeft":
    case "ArrowUp": {
      return (current - 1 + count) % count;
    }
    case "Home": {
      return 0;
    }
    case "End": {
      return count - 1;
    }
    default: {
      return current;
    }
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
 * #733: the one segmented control. The chosen option uses the primary fill and
 * its paired label. One choice among a few, so it is a radio group: arrow keys
 * move the choice, Home and End jump to the ends, and only the chosen option is
 * in the tab order (the first, while nothing is chosen yet). `md` sits in a page's filter row (44px tall on a phone);
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
  const nothingChosen = !options.some((option) => option.value === value);

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
      tabIndex={-1}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        "flex min-w-0 gap-0.5 rounded-full bg-app-line-soft p-[3px] motion-safe:transition-opacity motion-safe:duration-150",
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
            tabIndex={chosen || (nothingChosen && index === 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors motion-safe:duration-150",
              size === "md"
                ? "min-h-11 px-2.5 py-1 text-[12.5px] md:min-h-[28px] md:px-3"
                : "tap-target px-2 py-0.5 text-[11px]",
              fill && "flex-1",
              chosen
                ? "bg-primary font-semibold text-primary-foreground"
                : "font-medium text-app-muted hover:text-app-ink",
            )}
          >
            {option.icon}
            {!iconOnly && <span className="min-w-0 text-center leading-tight">{option.label}</span>}
            {option.badge}
          </button>
        );
      })}
    </div>
  );
}
