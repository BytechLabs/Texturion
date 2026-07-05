import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/utils";

import type { NavItem } from "../nav-links";

/**
 * One two-line mega-menu row, light skin (v3 spec §6): a quiet icon chip on
 * the left (#F0F4F2 inset, hairline, petrol glyph), the label in --day-ink
 * on top, an --ink-55 one-line description beneath. Hover/focus = the quiet
 * #F0F4F2 tint + petrol label; no lifts, no scale (v3 §2). Generous row
 * height and a real (full-row) hit area. Focus is the light-ground 2px
 * petrol outline (nxh-focus, per the conventions).
 *
 * The row is a Next <Link> that forwards its ref and any extra props to the
 * underlying <a>. That forwarding matters: it is rendered as the `asChild`
 * child of a Radix NavigationMenu.Link, which merges collection registration,
 * focus handling, and the close-on-select behavior onto it, dropping those
 * props would break keyboard nav and auto-close.
 */
export const MenuRow = React.forwardRef<
  HTMLAnchorElement,
  {
    item: NavItem;
    /** Compare menu rows show a tiny "vs" motif in the chip. */
    compareMotif?: boolean;
  } & Omit<React.ComponentPropsWithoutRef<typeof Link>, "href">
>(function MenuRow({ item, compareMotif = false, className, ...rest }, ref) {
  const Icon = item.icon;

  return (
    <Link
      ref={ref}
      href={item.href}
      className={cn(
        "group/row nxh-focus flex items-start gap-3 rounded-[10px] p-2.5 transition-colors",
        "hover:bg-[#F0F4F2] focus-visible:bg-[#F0F4F2]",
        className,
      )}
      {...rest}
    >
      <span
        className="relative mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-[rgba(11,43,38,0.08)] bg-[#F0F4F2] text-[color:var(--petrol)]"
        aria-hidden
      >
        {compareMotif ? (
          <span className="text-[11px] font-semibold tracking-tight">vs</span>
        ) : Icon ? (
          <Icon className="size-[18px]" strokeWidth={1.75} />
        ) : null}
      </span>

      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-[color:var(--day-ink)] transition-colors group-hover/row:text-[color:var(--petrol)] group-focus-visible/row:text-[color:var(--petrol)]">
          {item.label}
        </span>
        {item.description ? (
          <span className="mt-0.5 block text-[13px] leading-snug text-[color:var(--ink-55)]">
            {item.description}
          </span>
        ) : null}
      </span>
    </Link>
  );
});
