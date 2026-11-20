"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { CountPill } from "@/components/ui/count-pill";
import { useT } from "@/i18n/provider";
import { useNotificationsUnreadCount } from "@/lib/api/notifications";
import { useForYouNotificationsRealtime } from "@/lib/realtime/for-you-notifications";
import { cn } from "@/lib/utils";


import { MobileAccountSheet } from "./mobile-account-sheet";
import { isNavActive, MOBILE_NAV } from "./nav";
import { useForYouNavCount, useInboxNavCount } from "./use-nav-counts";
import { NavGlyph } from "./workspace-bits";

/** Counts above this render as `9+` (the calm numeral cap, PORTAL-UX §1.1). */
function cap(n: number): string {
  return n > 9 ? "9+" : `${n}`;
}

export function MobileTabBar() {
  const t = useT();
  const pathname = usePathname();
  const forYouCount = useForYouNavCount();
  const inboxCount = useInboxNavCount();
  const moreActive = ["/contacts", "/settings", "/trash"].some((href) => isNavActive(pathname, href));
  const [sheetOpen, setSheetOpen] = useState(false);

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
            const active = isNavActive(pathname, item.href) || (item.href === "/inbox" && isNavActive(pathname, "/calls"));
            const count =
              item.href === "/for-you"
                ? forYouCount
                : (item.href === "/inbox"
                  ? inboxCount
                  : 0);
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

          <button
            type="button"
            aria-label={
              unreadCount > 0
                ? t("shell.navCount", { label: t("shell.navMore"), count: unreadCount })
                : t("shell.navMore")
            }
            aria-current={moreActive ? "page" : undefined}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className={cn("flex min-h-12 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium", moreActive ? "text-app-olive-deep" : "text-app-muted")}
          >
            <span className="relative">
              <Ellipsis className="size-5" aria-hidden />
              {unreadCount > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-app-paper bg-primary"
                />
              )}
            </span>
            {t("shell.navMore")}
          </button>
        </div>
      </nav>
      <MobileAccountSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
