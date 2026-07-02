"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { isNavActive, PRIMARY_NAV, SETTINGS_NAV, type NavItem } from "./nav";
import { UsageMeter } from "./usage-meter";
import { UserMenu } from "./user-menu";
import { Wordmark } from "./wordmark";

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-none"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <Icon className="size-5 shrink-0" strokeWidth={1.75} />
      {item.label}
    </Link>
  );
}

/** Desktop sidebar — 240px, stone-100, active item = white pill + petrol (G3). */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <div className="px-5 pb-2 pt-5">
        <Wordmark />
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 p-3">
        {PRIMARY_NAV.map((item) => (
          <SidebarLink key={item.href} item={item} pathname={pathname} />
        ))}
        <div className="flex-1" aria-hidden />
        <SidebarLink item={SETTINGS_NAV} pathname={pathname} />
        <UsageMeter />
      </nav>
      <div className="border-t border-sidebar-border p-2">
        <UserMenu />
      </div>
    </aside>
  );
}

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          aria-label={item.label}
          className={cn(
            "flex size-11 items-center justify-center rounded-md transition-colors duration-150 ease-out",
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

/** Tablet 64px icon rail (G3: 768–1023px). */
export function IconRail() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-16 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar md:flex lg:hidden">
      <Link
        href="/inbox"
        aria-label="JobText inbox"
        className="flex h-14 items-center text-lg font-semibold text-primary"
      >
        Jt
      </Link>
      <nav
        aria-label="Primary"
        className="flex flex-1 flex-col items-center gap-1 py-2"
      >
        {PRIMARY_NAV.map((item) => (
          <RailLink key={item.href} item={item} pathname={pathname} />
        ))}
        <div className="flex-1" aria-hidden />
        <RailLink item={SETTINGS_NAV} pathname={pathname} />
        <div className="w-12">
          <UsageMeter compact />
        </div>
      </nav>
      <div className="pb-2">
        <UserMenu compact />
      </div>
    </aside>
  );
}
