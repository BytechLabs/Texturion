"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { NavigationMenu } from "radix-ui";

import { cn } from "@/lib/utils";

import type { NavMenu } from "../nav-links";
import { FeaturedCell } from "./featured-cell";
import { MenuRow } from "./menu-row";

/**
 * A designed desktop mega-menu panel (VISUALS §5b), built on Radix
 * NavigationMenu (already in the `radix-ui` package — no new dependency). Radix
 * gives us the right primitive for a *nav* (semantic links, hover-intent
 * open/close, full keyboard path, aria) instead of the wrong `menuitem` roles a
 * DropdownMenu would apply to navigation.
 *
 * The panel is a rounded elevated card with generous padding and a subtle enter
 * animation (150–200ms fade + rise, reduced-motion safe via the animate classes).
 * Rows are the two-line MenuRow (icon chip + label + description). Long lists
 * (Trades) use a two-column grid; the Product menu adds the FeaturedCell promo.
 * The Compare menu rows show a "vs" motif.
 *
 * Rendered inside a shared <NavigationMenu.Root> at the call site (nav.tsx) so
 * one menu closes when another opens, and the animated viewport is shared.
 */
export function MegaMenu({ menu }: { menu: NavMenu }) {
  const isCompare = menu.label === "Compare";
  const twoCol = menu.columns === 2;
  const hasFeatured = Boolean(menu.featured);

  return (
    <NavigationMenu.Item>
      <NavigationMenu.Trigger
        className={cn(
          "group inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-foreground/80 outline-none transition-colors",
          "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          "data-[state=open]:text-primary",
        )}
      >
        {menu.label}
        <ChevronDown
          className="size-3.5 opacity-60 transition-transform duration-200 group-data-[state=open]:rotate-180"
          strokeWidth={2}
          aria-hidden
        />
      </NavigationMenu.Trigger>

      <NavigationMenu.Content
        className={cn(
          // The Content is the intrinsically-sized panel: Radix measures ITS
          // width/height to drive --radix-navigation-menu-viewport-{width,height}
          // on the shared Viewport. It must therefore carry the fixed width and
          // NOT be `absolute w-full` — an absolutely-positioned w-full element
          // measures to 0 width, clipping the whole panel to a sliver (the bug).
          "p-3",
          hasFeatured
            ? "grid w-[560px] grid-cols-[1fr_220px] gap-3"
            : twoCol
              ? "w-[520px]"
              : "w-[340px]",
          // Enter/exit: ~200ms fade + rise, reduced-motion safe (tw-animate-css
          // honors prefers-reduced-motion via the globals.css base rule). Uses
          // the same suffixed animate utilities as the shadcn primitives.
          "data-[motion=from-end]:animate-in data-[motion=from-start]:animate-in data-[motion=to-end]:animate-out data-[motion=to-start]:animate-out",
          "data-[motion=from-end]:fade-in-0 data-[motion=from-start]:fade-in-0 data-[motion=to-end]:fade-out-0 data-[motion=to-start]:fade-out-0",
          "data-[motion=from-end]:slide-in-from-top-2 data-[motion=from-start]:slide-in-from-top-2",
          "duration-200 ease-out",
        )}
      >
        <ul
          className={cn(
            "grid gap-0.5",
            twoCol ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {menu.items.map((item) => (
            <li key={item.label}>
              <NavigationMenu.Link asChild>
                <MenuRow item={item} compareMotif={isCompare} />
              </NavigationMenu.Link>
            </li>
          ))}
        </ul>

        {menu.featured ? (
          <NavigationMenu.Link asChild>
            <Link
              href={menu.featured.href}
              className="block rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FeaturedCell featured={menu.featured} />
            </Link>
          </NavigationMenu.Link>
        ) : null}
      </NavigationMenu.Content>
    </NavigationMenu.Item>
  );
}
