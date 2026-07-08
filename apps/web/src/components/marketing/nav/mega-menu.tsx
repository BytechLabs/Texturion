"use client";

import { ChevronDown } from "lucide-react";
import { NavigationMenu } from "radix-ui";

import { cn } from "@/lib/utils";

import type { NavMenu } from "../nav-links";
import { MenuRow } from "./menu-row";

/**
 * A desktop mega-menu panel, built on Radix NavigationMenu (already in the
 * `radix-ui` package). Radix gives us the right primitive for a *nav*
 * (semantic links, hover-intent open/close, full keyboard path, aria)
 * instead of the wrong `menuitem` roles a DropdownMenu would apply.
 *
 * v4 "FIRST RESPONSE" skin: the trigger reads ink-70 (Hanken 500) and
 * deepens to Dispatch Ink on hover/open; the panel itself is the shared
 * white Viewport in desktop-nav.tsx (card + the one shadow, Law 10: no
 * border). Rows are the typographic MenuRow; the six trades use a
 * two-column grid.
 *
 * Rendered inside a shared <NavigationMenu.Root> at the call site
 * (desktop-nav.tsx) so one menu closes when another opens, and the animated
 * viewport is shared.
 */
export function MegaMenu({ menu }: { menu: NavMenu }) {
  const twoCol = menu.columns === 2;

  return (
    <NavigationMenu.Item>
      <NavigationMenu.Trigger
        className={cn(
          "group frn-focus font-body-mkt inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-[color:var(--fr-ink-70)] transition-colors duration-200 ease-out",
          "hover:text-[color:var(--fr-ink)] data-[state=open]:text-[color:var(--fr-ink)]",
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
          // NOT be `absolute w-full` (an absolutely-positioned w-full element
          // measures to 0 width, clipping the whole panel to a sliver).
          "p-3",
          twoCol ? "w-[540px]" : "w-[360px]",
          // Enter/exit: ~200ms fade + rise, reduced-motion safe (tw-animate-css
          // honors prefers-reduced-motion via the globals.css base rule).
          "data-[motion=from-end]:animate-in data-[motion=from-start]:animate-in data-[motion=to-end]:animate-out data-[motion=to-start]:animate-out",
          "data-[motion=from-end]:fade-in-0 data-[motion=from-start]:fade-in-0 data-[motion=to-end]:fade-out-0 data-[motion=to-start]:fade-out-0",
          "data-[motion=from-end]:slide-in-from-top-2 data-[motion=from-start]:slide-in-from-top-2",
          "duration-200 ease-out",
        )}
      >
        {/* A quiet panel header (amendment 15): the menu's own eyebrow over a
            Frost hairline, so the open panel reads titled and designed rather
            than a bare list. No new copy, just the category label. */}
        <div className="mb-1.5 border-b border-[color:var(--fr-frost)] px-3 pt-0.5 pb-2">
          <span className="fr-eyebrow text-[color:var(--fr-ink-55)]">
            {menu.label}
          </span>
        </div>

        <ul
          className={cn("grid gap-0.5", twoCol ? "grid-cols-2" : "grid-cols-1")}
        >
          {menu.items.map((item) => (
            <li key={item.label}>
              <NavigationMenu.Link asChild>
                <MenuRow item={item} />
              </NavigationMenu.Link>
            </li>
          ))}
        </ul>
      </NavigationMenu.Content>
    </NavigationMenu.Item>
  );
}
