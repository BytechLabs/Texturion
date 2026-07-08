import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/utils";

import type { NavItem } from "../nav-links";
import { MenuIconChip } from "./menu-icon";

/**
 * One two-line mega-menu row, v4 "FIRST RESPONSE" skin (amendment 15): a
 * single cobalt line glyph in a Frost chip, then a Hanken 600 Dispatch Ink
 * label over an ink-55 plain-English line. The Frost wash on hover/focus,
 * cobalt focus ring (frn-focus).
 *
 * The row is a Next <Link> that forwards its ref and any extra props to the
 * underlying <a>. That forwarding matters: it is rendered as the `asChild`
 * child of a Radix NavigationMenu.Link, which merges collection registration,
 * focus handling, and the close-on-select behavior onto it, dropping those
 * props would break keyboard nav and auto-close.
 */
export const MenuRow = React.forwardRef<
  HTMLAnchorElement,
  { item: NavItem } & Omit<React.ComponentPropsWithoutRef<typeof Link>, "href">
>(function MenuRow({ item, className, ...rest }, ref) {
  return (
    <Link
      ref={ref}
      href={item.href}
      className={cn(
        "frn-focus flex items-start gap-3 rounded-[10px] p-3 transition-colors duration-200 ease-out",
        "hover:bg-[color:var(--fr-frost)] focus-visible:bg-[color:var(--fr-frost)]",
        className,
      )}
      {...rest}
    >
      {item.icon ? <MenuIconChip icon={item.icon} className="mt-0.5" /> : null}
      <span className="min-w-0 flex-1">
        <span className="font-body-mkt block text-sm font-semibold text-[color:var(--fr-ink)]">
          {item.label}
        </span>
        {item.description ? (
          <span className="font-body-mkt mt-0.5 block text-[13px] leading-snug text-[color:var(--fr-ink-55)]">
            {item.description}
          </span>
        ) : null}
      </span>
    </Link>
  );
});
