import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tertiary — the quiet meta voice (APP-UI-ELEVATION.md §2.1/§2.2).
 *
 * Timestamps, assignee names, system/timeline lines, in-cluster delivery
 * state, dividers-with-text: everything that should recede one step further
 * than secondary body text so only the message + customer name stay near-black.
 *
 * ACCESSIBILITY (binding, §6/G11). The tertiary tone (`stone-400`) is BELOW the
 * WCAG AA 4.5:1 text floor (~2.5:1 on white). It is therefore reserved for
 * genuinely NON-ESSENTIAL meta — text a screen-reader user still receives in
 * full and a sighted user does not strictly need to read to operate the screen.
 * The moment the text carries essential meaning, pass `essential` to step up to
 * `--muted-foreground` (`stone-500`, 4.6:1+), which clears AA on white,
 * stone-50, and card. When in doubt, mark it essential.
 *
 * Numeric tertiary text (times, counts) should also get `tabular-nums` from the
 * caller so columns align; this component does not force it, since not all
 * tertiary text is numeric.
 */

type TertiaryProps<T extends React.ElementType> = {
  /** Render element. Defaults to <span>. Use "p"/"time"/"div" as needed. */
  as?: T;
  /**
   * The text conveys essential meaning — step up to `muted-foreground`
   * (stone-500) so it clears WCAG AA 4.5:1. Use for anything the user must read
   * to understand or operate the screen. Defaults to false (decorative meta).
   */
  essential?: boolean;
  className?: string;
  children?: React.ReactNode;
};

/**
 * The tertiary tone as a class, for the rare case a wrapper element is not
 * wanted (e.g. applying it to an existing element). Equivalent to the
 * `.text-tertiary` utility in globals.css; prefer the component when you are
 * rendering fresh markup so intent (and the `essential` escape hatch) is legible.
 */
export const tertiaryClass = "text-foreground-tertiary";
export const tertiaryEssentialClass = "text-muted-foreground";

export function Tertiary<T extends React.ElementType = "span">({
  as,
  essential = false,
  className,
  children,
  ...rest
}: TertiaryProps<T> &
  Omit<React.ComponentPropsWithoutRef<T>, keyof TertiaryProps<T>>) {
  const Comp = (as ?? "span") as React.ElementType;
  return (
    <Comp
      data-slot="tertiary"
      className={cn(
        essential ? tertiaryEssentialClass : tertiaryClass,
        className,
      )}
      {...rest}
    >
      {children}
    </Comp>
  );
}
