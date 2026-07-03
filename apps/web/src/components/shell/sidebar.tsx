"use client";

import { PanelLeftClose } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { NotificationBell } from "@/components/notifications/notification-bell";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUnreadConversationCount } from "@/lib/push/use-unread-count";
import { cn } from "@/lib/utils";

import { isNavActive, PRIMARY_NAV, SETTINGS_NAV, type NavItem } from "./nav";
import { useRailCollapsed } from "./use-rail-collapsed";
import { UsageMeter } from "./usage-meter";
import { UserMenu } from "./user-menu";
import { Wordmark } from "./wordmark";

/** Counts above this render as `9+` (APP-LAYOUT-V2 §1.3 rail-numeral cap). */
function railCount(unread: number): string {
  return unread > 9 ? "9+" : `${unread}`;
}

/** A labelled nav row (expanded rail): icon + label + optional stone numeral. */
function ExpandedRow({
  item,
  pathname,
  unread,
}: {
  item: NavItem;
  pathname: string;
  unread: number;
}) {
  const active = isNavActive(pathname, item.href);
  const Icon = item.icon;
  const count = item.countsUnread && unread > 0 ? railCount(unread) : null;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={count ? `${item.label}, ${unread} unread` : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {count && (
        <span className="text-xs font-normal tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </Link>
  );
}

/** An icon-only nav square (collapsed rail / tablet): tooltip + unread dot. */
function RailRow({
  item,
  pathname,
  unread,
}: {
  item: NavItem;
  pathname: string;
  unread: number;
}) {
  const active = isNavActive(pathname, item.href);
  const Icon = item.icon;
  const count = item.countsUnread && unread > 0 ? railCount(unread) : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          aria-label={count ? `${item.label}, ${unread} unread` : item.label}
          className={cn(
            "relative flex size-11 items-center justify-center rounded-md transition-colors duration-150 ease-out",
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <Icon className="size-5" strokeWidth={1.75} aria-hidden />
          {count && (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-muted-foreground"
            />
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {count ? ` · ${count}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

/** The full labelled rail body (240px). Shown at lg when not collapsed. */
function ExpandedRail({
  pathname,
  unread,
  onCollapse,
}: {
  pathname: string;
  unread: number;
  onCollapse: () => void;
}) {
  return (
    <>
      <div className="flex h-14 items-center justify-between px-5">
        <Wordmark />
        {/* D24 notifications: the persistent "top bar" bell for the app-v2 rail —
            reachable on every signed-in page, not just /for-you. */}
        <NotificationBell />
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 p-3">
        {PRIMARY_NAV.map((item) => (
          <ExpandedRow
            key={item.href}
            item={item}
            pathname={pathname}
            unread={unread}
          />
        ))}
        <div className="flex-1" aria-hidden />
        <ExpandedRow item={SETTINGS_NAV} pathname={pathname} unread={unread} />
        <UsageMeter />
      </nav>
      <div className="border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse sidebar"
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors duration-150 ease-out hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
        >
          <PanelLeftClose className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="truncate">Collapse</span>
        </button>
      </div>
      <div className="border-t border-sidebar-border p-2">
        <UserMenu />
      </div>
    </>
  );
}

/**
 * The full icon rail body (64px). Shown on tablet always, and on desktop when
 * collapsed. `onExpand` is only wired on desktop (tablet has no toggle).
 */
function IconRail({
  pathname,
  unread,
  onExpand,
}: {
  pathname: string;
  unread: number;
  onExpand?: () => void;
}) {
  return (
    <>
      <Link
        href="/inbox"
        aria-label="JobText inbox"
        className="flex h-14 items-center justify-center text-lg font-semibold text-primary"
      >
        Jt
      </Link>
      {/* D24 notifications: the persistent bell in the collapsed/tablet rail. */}
      <div className="flex justify-center pb-1">
        <NotificationBell />
      </div>
      <nav
        aria-label="Primary"
        className="flex flex-1 flex-col items-center gap-1 py-2"
      >
        {PRIMARY_NAV.map((item) => (
          <RailRow
            key={item.href}
            item={item}
            pathname={pathname}
            unread={unread}
          />
        ))}
        <div className="flex-1" aria-hidden />
        <RailRow item={SETTINGS_NAV} pathname={pathname} unread={unread} />
        <div className="w-12">
          <UsageMeter compact />
        </div>
      </nav>
      {onExpand && (
        <div className="border-t border-sidebar-border p-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onExpand}
                aria-label="Expand sidebar"
                className="flex size-11 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors duration-150 ease-out hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              >
                <PanelLeftClose
                  className="size-5 rotate-180"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
        </div>
      )}
      <div className="flex justify-center pb-2 pt-2">
        <UserMenu compact />
      </div>
    </>
  );
}

/**
 * The receding nav rail (APP-LAYOUT-V2 §1.3): stone chrome, one petrol active
 * pill, click-collapse between the 240px labelled rail and the 64px icon rail
 * (persisted). Tablet (768–1023px) is always the icon rail regardless of the
 * preference (§1.6); mobile has no rail (bottom tabs instead).
 *
 * Search stays OUT of the rail (§1.3) — it lives above the list; Cmd-K covers
 * jump-nav. Both rail variants read the shared unread count so the rail
 * *counts* (stone numeral) while the list row *points* (petrol dot).
 */
export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useRailCollapsed();
  const unread = useUnreadConversationCount();

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex",
        // Tablet is always the 64px icon rail; desktop honors the preference.
        collapsed ? "w-16" : "w-16 lg:w-60",
      )}
    >
      {/* Tablet (md–lg): always the icon rail. */}
      <div className="flex flex-1 flex-col lg:hidden">
        <IconRail pathname={pathname} unread={unread} />
      </div>

      {/* Desktop (lg+): the preference chooses the variant. */}
      <div className="hidden flex-1 flex-col lg:flex">
        {collapsed ? (
          <IconRail pathname={pathname} unread={unread} onExpand={toggle} />
        ) : (
          <ExpandedRail
            pathname={pathname}
            unread={unread}
            onCollapse={toggle}
          />
        )}
      </div>
    </aside>
  );
}
