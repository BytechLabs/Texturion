"use client";

import Link from "next/link";
import { NavigationMenu } from "radix-ui";

import { cn } from "@/lib/utils";

import {
  CANADA_LINK,
  NAV_MENUS,
  PRICING_LINK,
} from "../nav-links";
import { MegaMenu } from "./mega-menu";

/**
 * The desktop primary navigation (VISUALS §5b): a shared Radix NavigationMenu
 * root hosting the three mega-menus (Product / Who it's for / Compare) and the
 * two flat links (Pricing / Canada). The Root owns hover-intent, keyboard nav,
 * and the single animated Viewport the panels render into — so only one panel is
 * ever open, and switching between menus cross-fades in one elevated card.
 *
 * The Viewport is the rounded, elevated panel surface (soft shadow + 1px border,
 * 10px radius) that every menu's Content paints into; it resizes and re-origins
 * smoothly between menus via the Radix CSS vars.
 */
export function DesktopNav() {
  return (
    <NavigationMenu.Root className="relative hidden lg:flex" delayDuration={80}>
      <NavigationMenu.List className="flex items-center gap-0.5">
        <MegaMenu menu={NAV_MENUS[0]} />

        <NavigationMenu.Item>
          <NavigationMenu.Link asChild>
            <Link
              href={PRICING_LINK.href}
              className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {PRICING_LINK.label}
            </Link>
          </NavigationMenu.Link>
        </NavigationMenu.Item>

        <MegaMenu menu={NAV_MENUS[1]} />
        <MegaMenu menu={NAV_MENUS[2]} />

        <NavigationMenu.Item>
          <NavigationMenu.Link asChild>
            <Link
              href={CANADA_LINK.href}
              className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {CANADA_LINK.label}
            </Link>
          </NavigationMenu.Link>
        </NavigationMenu.Item>
      </NavigationMenu.List>

      {/* One shared, animated panel surface for every menu (§5b). */}
      <div className="absolute top-full left-0 flex">
        <NavigationMenu.Viewport
          className={cn(
            "relative mt-2 origin-top-left overflow-hidden rounded-[10px] border border-border bg-popover text-popover-foreground shadow-lg",
            "h-[var(--radix-navigation-menu-viewport-height)] w-[var(--radix-navigation-menu-viewport-width)]",
            "transition-[width,height] duration-200 ease-out",
            "data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        />
      </div>
    </NavigationMenu.Root>
  );
}
