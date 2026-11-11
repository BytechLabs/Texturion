"use client";

import { useRef } from "react";

import { nextOptionIndex } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

export interface ChoiceCard<T extends string> {
  value: T;
  label: string;
  /** What choosing it means, one or two lines under the label. */
  description?: string;
}

/**
 * #746: the one described choice. A stack of radio cards for a few options
 * that each have a consequence worth reading before choosing: who rings, what
 * happens after hours, who may use a number.
 *
 * One choice, so it is a radio group: arrow keys move and select, Home and End
 * jump, and one card is in the tab order (the chosen one, or the first when
 * nothing is chosen yet). Three or four words with no consequence are a
 * `SegmentedControl`; a longer list is a `SimpleSelect`.
 * *Applying: Chunking: the consequence is shown with the choice, not behind it.*
 */
export function ChoiceCards<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: {
  value: T | null;
  options: readonly ChoiceCard<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = options.findIndex((option) => option.value === value);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const from = at === -1 ? 0 : at;
    const next = nextOptionIndex(event.key, from, options.length);
    if (next === from) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next].value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn("space-y-2", className)}
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
            tabIndex={chosen || (at === -1 && index === 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "w-full rounded-md border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              chosen
                ? "border-primary/50 bg-accent/40"
                : "border-border-subtle hover:bg-accent/20",
            )}
          >
            <span className="block text-sm font-medium">{option.label}</span>
            {option.description && (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {option.description}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
