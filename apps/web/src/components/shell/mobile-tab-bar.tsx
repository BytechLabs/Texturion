"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { isNavActive, MOBILE_NAV } from "./nav";

/**
 * Mobile bottom tab bar (G3, <768px): Inbox, Contacts, Settings — 44px+
 * touch targets with safe-area padding for the home indicator.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="grid grid-cols-3">
        {MOBILE_NAV.map((item) => {
          const active = isNavActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors duration-150 ease-out",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" strokeWidth={1.75} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
