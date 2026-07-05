"use client";

import Link from "next/link";
import { NavigationMenu } from "radix-ui";

import { cn } from "@/lib/utils";

import { CANADA_LINK, NAV_MENUS, PRICING_LINK } from "../nav-links";
import { MegaMenu } from "./mega-menu";

/**
 * Top-level bar links + triggers, light skin (v3 spec §6): --ink-70 resting,
 * --day-ink hover/open, petrol 2px outline focus (nxh-focus).
 */
const BAR_LINK =
  "nxh-focus inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-[color:var(--ink-70)] transition-colors hover:text-[color:var(--day-ink)]";

/**
 * The desktop primary navigation: a shared Radix NavigationMenu root hosting
 * the three mega-menus (Product / Who it's for / Compare) and the two flat
 * links (Pricing / Canada). The Root owns hover-intent, keyboard nav, and the
 * single animated Viewport the panels render into, so only one panel is ever
 * open, and switching between menus cross-fades in one elevated card.
 *
 * "Quiet daylight" skin (v3 spec §6): the Viewport is a white surface with a
 * 1px hairline border and the one sanctioned floating shadow
 * (0 4px 12px rgba(11,43,38,0.08), the QuietHoursDialog's), 12px radius.
 */
export function DesktopNav() {
  return (
    <NavigationMenu.Root className="relative hidden lg:flex" delayDuration={80}>
      <NavigationMenu.List className="flex items-center gap-0.5">
        <MegaMenu menu={NAV_MENUS[0]} />

        <NavigationMenu.Item>
          <NavigationMenu.Link asChild>
            <Link href={PRICING_LINK.href} className={BAR_LINK}>
              {PRICING_LINK.label}
            </Link>
          </NavigationMenu.Link>
        </NavigationMenu.Item>

        <MegaMenu menu={NAV_MENUS[1]} />
        <MegaMenu menu={NAV_MENUS[2]} />

        <NavigationMenu.Item>
          <NavigationMenu.Link asChild>
            <Link href={CANADA_LINK.href} className={BAR_LINK}>
              {CANADA_LINK.label}
            </Link>
          </NavigationMenu.Link>
        </NavigationMenu.Item>
      </NavigationMenu.List>

      {/* One shared, animated panel surface for every menu: a white card
          with a hairline and the one sanctioned floating shadow. */}
      <div className="absolute top-full left-0 flex">
        <NavigationMenu.Viewport
          className={cn(
            "relative mt-2 origin-top-left overflow-hidden rounded-xl border border-[rgba(11,43,38,0.08)] bg-white text-[color:var(--day-ink)] shadow-[0_4px_12px_rgba(11,43,38,0.08)]",
            "h-[var(--radix-navigation-menu-viewport-height)] w-[var(--radix-navigation-menu-viewport-width)]",
            "transition-[width,height] duration-200 ease-out",
            "data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        />
      </div>
    </NavigationMenu.Root>
  );
}
