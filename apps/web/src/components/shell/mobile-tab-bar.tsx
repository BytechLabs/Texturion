"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useUnreadConversationCount } from "@/lib/push/use-unread-count";
import { cn } from "@/lib/utils";

import { isNavActive, MOBILE_NAV } from "./nav";

/** Counts above this render as `9+` (matches the rail cap, §1.3). */
function tabCount(unread: number): string {
  return unread > 9 ? "9+" : `${unread}`;
}

/**
 * Mobile bottom tab bar (APP-LAYOUT-V2 §1.6, <768px): For You · Inbox · Tasks ·
 * Contacts · Settings — five 44px+ touch targets with safe-area padding for the
 * home indicator. The Inbox tab carries the shared unread count as a quiet
 * petrol dot at tab altitude.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const unread = useUnreadConversationCount();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="grid grid-cols-5">
        {MOBILE_NAV.map((item) => {
          const active = isNavActive(pathname, item.href);
          const Icon = item.icon;
          const count =
            item.countsUnread && unread > 0 ? tabCount(unread) : null;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={
                count ? `${item.label}, ${unread} unread` : undefined
              }
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors duration-150 ease-out",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span className="relative">
                <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                {count && (
                  <span
                    aria-hidden
                    className="absolute -right-1.5 -top-1 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-4 text-primary-foreground tabular-nums"
                  >
                    {count}
                  </span>
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
