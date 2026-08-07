"use client";

import { ChevronDownIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A platform `<select>` wearing the design system's trigger.
 *
 * The app's `Select` (radix-ui) is the right control for a handful of choices
 * on a leisurely screen. This one exists for the other case: a list of the SAME
 * question asked once per row, where the answers are the load-bearing thing on
 * the screen. Three reasons it wins there.
 *
 *   It is the OS picker on a phone — a wheel the person already knows, over a
 *   popover that has to be scrolled inside a scrolling dialog.
 *
 *   It is one tab stop and then type-ahead, so twelve columns are twelve
 *   keystrokes rather than twelve open-arrow-arrow-enter journeys.
 *
 *   It can be driven by a test. That is not a convenience: the #248 import gate
 *   is only real if a guard can answer a column and watch the door open, and a
 *   control no assertion can operate is a gate nobody has ever proved.
 *
 * Visually identical to `SelectTrigger` (the same class string, plus
 * `appearance-none` and room for the chevron) so the two do not read as two
 * different kinds of control.
 */
export function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative w-full">
      <select
        data-slot="native-select"
        className={cn(
          "flex h-9 w-full appearance-none items-center rounded-md border border-input bg-transparent py-2 pr-8 pl-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {/* pointer-events-none so the chevron never eats the click that opens
          the picker; -translate-y-1/2 optically centres it on the field rather
          than on the text baseline. */}
      <ChevronDownIcon
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground opacity-50"
        aria-hidden
      />
    </div>
  );
}
