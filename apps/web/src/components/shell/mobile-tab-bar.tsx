"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { CountPill } from "@/components/ui/count-pill";
import { useT } from "@/i18n/provider";
import { useNotificationsUnreadCount } from "@/lib/api/notifications";
import { useActiveCompany } from "@/lib/company/provider";
import { useForYouNotificationsRealtime } from "@/lib/realtime/for-you-notifications";
import { cn } from "@/lib/utils";


import { InitialsAvatar } from "./initials-avatar";
import { MobileAccountSheet } from "./mobile-account-sheet";
import { isNavActive, MOBILE_NAV } from "./nav";
import { useForYouNavCount, useInboxNavCount } from "./use-nav-counts";
import { NavGlyph } from "./workspace-bits";
import { avatarInitials } from "@loonext/shared";

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
  const t = useT();
  const pathname = usePathname();
  const forYouCount = useForYouNavCount();
  const inboxCount = useInboxNavCount();
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
        aria-label={t("shell.primaryNav")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-app-line bg-app-paper pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="grid grid-cols-5">
          {MOBILE_NAV.map((item) => {
            const active = isNavActive(pathname, item.href);
            const count =
              item.href === "/for-you"
                ? forYouCount
                : item.href === "/inbox"
                  ? inboxCount
                  : 0;
            const showCount = count > 0;
            const label = t(item.labelKey);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={
                  showCount ? t("shell.navCount", { label, count }) : undefined
                }
                // The label comes first in the markup and the column is
                // reversed, so the tab's text reads "For you 3" in the order its
                // aria-label says it (WCAG 2.5.3) while the icon still sits on top.
                className={cn(
                  "flex min-h-12 flex-col-reverse items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors duration-150 ease-out",
                  active
                    ? "text-app-olive-deep"
                    : "text-app-muted has-data-pending:text-app-olive-deep",
                )}
              >
                {label}{" "}
                <span className="relative">
                  <NavGlyph icon={item.icon} className="size-5" />
                  {showCount && (
                    <CountPill
                      size="sm"
                      aria-hidden
                      className="absolute -right-2 -top-1"
                    >
                      {cap(count)}
                    </CountPill>
                  )}
                </span>
              </Link>
            );
          })}

          {/* #100: the account avatar — replaces "More". Opens the account
              sheet; unread notifications show as a dot on the avatar. */}
          <button
            type="button"
            aria-label={
              unreadCount > 0
                ? t("shell.youAccountUnread", { count: unreadCount })
                : t("shell.youAccount")
            }
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className="flex min-h-12 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium text-app-muted transition-colors duration-150 ease-out"
          >
            <span className="relative">
              <InitialsAvatar
                initials={avatarInitials(displayName || membership.name)}
                className="grid size-5 place-items-center rounded-full bg-app-tint text-[9px] font-semibold text-app-olive-deep"
              />
              {unreadCount > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-app-paper bg-primary"
                />
              )}
            </span>
            {t("shell.you")}
          </button>
        </div>
      </nav>
      <MobileAccountSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
