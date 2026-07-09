"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A tactile add-on module toggle card, shared by onboarding (local pre-checkout
 * selection) and settings › Billing (live enable/disable with a confirm). The
 * whole card is the switch: hairline border, a petrol check + tint when on,
 * price on the right, label + blurb + optional detail. The CALLER owns what a
 * toggle does — onboarding flips local state; settings opens the proration
 * confirm dialog.
 */
export function ModuleCard({
  label,
  price,
  blurb,
  detail,
  on,
  onToggle,
  disabled,
}: {
  label: string;
  /** Base monthly price string (e.g. "$10"); the card appends "/mo". */
  price: string;
  blurb: string;
  detail?: string | null;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label} add-on`}
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        on ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/40",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          on
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border",
        )}
      >
        {on ? <Check className="size-3.5" strokeWidth={2.5} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">{label}</span>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {price}/mo
          </span>
        </span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">
          {blurb}
        </span>
        {detail ? (
          <span className="mt-1 block text-[13px] font-medium text-foreground/80">
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}
