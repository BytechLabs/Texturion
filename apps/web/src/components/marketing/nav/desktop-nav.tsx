"use client";

import Link from "next/link";
import { NavigationMenu } from "radix-ui";

import { cn } from "@/lib/utils";

import { NAV_MENUS, PRICING_LINK } from "../nav-links";
import { MegaMenu } from "./mega-menu";

/**
 * Top-level bar links + triggers, v4 skin (§4 Nav): Hanken 500, ink-70
 * resting, Dispatch Ink hover/open, cobalt focus outline (frn-focus).
 */
const BAR_LINK =
  "frn-focus font-body-mkt inline-flex h-9 items-center rounded-full px-3 text-sm font-medium text-[color:var(--fr-ink-70)] transition-colors duration-200 ease-out hover:text-[color:var(--fr-ink)]";

/**
 * The desktop primary navigation, deck order: Product ▾ · Pricing ·
 * Who it's for ▾ · Compare ▾. A shared Radix NavigationMenu root hosts the
 * three mega-menus and the flat Pricing link; the Root owns hover-intent,
 * keyboard nav, and the single animated Viewport the panels render into, so
 * only one panel is ever open and switching menus cross-fades in one card.
 *
 * v4 skin: the Viewport is a white card with 12px radius and the ONE card
 * shadow, no border (Law 10).
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
      </NavigationMenu.List>

      {/* One shared, animated panel surface for every menu: white card, 12px
          radius, the one shadow (Law 10: no hairline border). */}
      <div className="absolute top-full left-0 flex">
        <NavigationMenu.Viewport
          className={cn(
            "relative mt-2 origin-top-left overflow-hidden rounded-xl bg-white text-[color:var(--fr-ink)] shadow-[var(--fr-shadow-card)]",
            "h-[var(--radix-navigation-menu-viewport-height)] w-[var(--radix-navigation-menu-viewport-width)]",
            "transition-[width,height] duration-200 ease-out",
            "data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        />
      </div>
    </NavigationMenu.Root>
  );
}
