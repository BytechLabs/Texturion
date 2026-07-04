"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { isNavActive, MOBILE_NAV } from "./nav";
import { useNavCounts } from "./use-nav-counts";

/** Counts above this render as `9+` (the calm numeral cap, PORTAL-UX §1.1). */
function cap(n: number): string {
  return n > 9 ? "9+" : `${n}`;
}

/**
 * Mobile/tablet bottom tab bar (PORTAL-UX §5, <1000px): For you · Inbox · Tasks ·
 * Contacts · More — five 44px+ LABELED touch targets with safe-area padding.
 * Labels stay visible (never bare icons). The For-you tab carries the single
 * petrol count pill; Inbox carries the muted unread count; the rest are plain.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const counts = useNavCounts();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-app-line bg-app-white pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="grid grid-cols-5">
        {MOBILE_NAV.map((item) => {
          const active = isNavActive(pathname, item.href);
          const Icon = item.icon;
          const isForYou = item.href === "/for-you";
          const count = isForYou
            ? counts.forYou
            : item.href === "/inbox"
              ? counts.inbox
              : 0;
          const showCount = count > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={
                showCount ? `${item.label}, ${count}` : undefined
              }
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors duration-150 ease-out",
                active ? "text-app-petrol-deep" : "text-app-muted",
              )}
            >
              <span className="relative">
                <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                {showCount && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -right-2 -top-1 flex min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-4 tabular-nums",
                      isForYou
                        ? "bg-app-petrol text-white"
                        : "bg-app-line-soft text-app-muted",
                    )}
                  >
                    {cap(count)}
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
