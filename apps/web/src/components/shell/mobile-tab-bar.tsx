"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useNotificationsUnreadCount } from "@/lib/api/notifications";
import { useActiveCompany } from "@/lib/company/provider";
import { useForYouNotificationsRealtime } from "@/lib/realtime/for-you-notifications";
import { cn } from "@/lib/utils";

import { avatarInitials } from "./avatar-color";
import { MobileAccountSheet } from "./mobile-account-sheet";
import { isNavActive, MOBILE_NAV } from "./nav";
import { useNavCounts } from "./use-nav-counts";

/** Counts above this render as `9+` (the calm numeral cap, PORTAL-UX §1.1). */
function cap(n: number): string {
  return n > 9 ? "9+" : `${n}`;
}

/**
 * Mobile/tablet bottom tab bar (PORTAL-UX §5, #100, <1000px): For you · Inbox ·
 * Tasks · Contacts · You — four LABELED nav links plus the ACCOUNT AVATAR,
 * which replaced "More" (#100) and opens the account sheet (workspace info,
 * number(s), notifications, theme, Settings, Sign out). All five are 44px+
 * touch targets with safe-area padding; labels stay visible (never bare
 * icons). For-you and Inbox carry quiet stone count badges (issue #64: the one
 * petrol accent in this region is the compose FAB, never a count). Unread
 * NOTIFICATIONS surface as a dot on the avatar (#100).
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const counts = useNavCounts();
  const { membership, displayName } = useActiveCompany();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Keep the avatar's unread dot live off the shared realtime signal — the
  // desktop bell isn't mounted on mobile anymore (the top header is gone).
  useForYouNotificationsRealtime();
  const unread = useNotificationsUnreadCount();
  const unreadCount = unread.data?.count ?? 0;

  return (
    <>
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
                      className="absolute -right-2 -top-1 flex min-w-3.5 items-center justify-center rounded-full bg-app-line-soft px-1 text-[9px] font-semibold leading-4 tabular-nums text-app-muted"
                    >
                      {cap(count)}
                    </span>
                  )}
                </span>
                {item.label}
              </Link>
            );
          })}

          {/* #100: the account avatar — replaces "More". Opens the account
              sheet; unread notifications show as a dot on the avatar. */}
          <button
            type="button"
            aria-label={
              unreadCount > 0
                ? `Account and settings, ${unreadCount} unread notifications`
                : "Account and settings"
            }
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className="flex min-h-12 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium text-app-muted transition-colors duration-150 ease-out"
          >
            <span className="relative">
              <span
                aria-hidden
                className="grid size-5 place-items-center rounded-full bg-app-tint text-[9px] font-semibold text-app-petrol-deep"
              >
                {avatarInitials(displayName || membership.name)}
              </span>
              {unreadCount > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-app-white bg-primary"
                />
              )}
            </span>
            You
          </button>
        </div>
      </nav>
      <MobileAccountSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
