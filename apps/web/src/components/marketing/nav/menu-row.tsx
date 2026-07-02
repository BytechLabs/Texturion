import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/utils";

import type { NavItem } from "../nav-links";

/**
 * One two-line mega-menu row (VISUALS §5b): a petrol-tinted rounded icon chip on
 * the left, the label (medium weight) on top, a muted one-line description
 * beneath. Hover/focus = teal-50 tint + petrol label + a slight icon-chip lift.
 * Generous row height and a real (full-row) hit area.
 *
 * The row is a Next <Link> that forwards its ref and any extra props to the
 * underlying <a>. That forwarding matters: it is rendered as the `asChild` child
 * of a Radix NavigationMenu.Link, which merges collection registration, focus
 * handling, and the close-on-select behavior onto it — dropping those props would
 * break keyboard nav and auto-close.
 */
export const MenuRow = React.forwardRef<
  HTMLAnchorElement,
  {
    item: NavItem;
    /** Compare menu rows show a tiny "vs" motif in the chip (§5b). */
    compareMotif?: boolean;
  } & Omit<React.ComponentPropsWithoutRef<typeof Link>, "href">
>(function MenuRow({ item, compareMotif = false, className, ...rest }, ref) {
  const Icon = item.icon;

  return (
    <Link
      ref={ref}
      href={item.href}
      className={cn(
        "group/row flex items-start gap-3 rounded-[10px] p-2.5 outline-none transition-colors",
        "hover:bg-teal-50 focus-visible:bg-teal-50 dark:hover:bg-teal-950/40 dark:focus-visible:bg-teal-950/40",
        "focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...rest}
    >
      <span
        className={cn(
          "relative mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary",
          "transition-transform duration-150 group-hover/row:-translate-y-0.5 group-focus-visible/row:-translate-y-0.5",
        )}
        aria-hidden
      >
        {compareMotif ? (
          <span className="text-[11px] font-semibold tracking-tight">vs</span>
        ) : Icon ? (
          <Icon className="size-[18px]" strokeWidth={1.75} />
        ) : null}
      </span>

      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-foreground transition-colors group-hover/row:text-primary group-focus-visible/row:text-primary">
          {item.label}
        </span>
        {item.description ? (
          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
            {item.description}
          </span>
        ) : null}
      </span>
    </Link>
  );
});
