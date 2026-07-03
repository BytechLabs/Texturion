"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";

import { NotificationBell } from "@/components/notifications/notification-bell";
import { useUnreadConversationCount } from "@/lib/push/use-unread-count";
import { cn } from "@/lib/utils";

import { AvatarMenu } from "./avatar-menu";
import { CompanySwitcher } from "./company-switcher";
import { isNavActive } from "./nav";

/** Counts above this render as `9+` (matches the old rail numeral cap). */
function tabCount(unread: number): string {
  return unread > 9 ? "9+" : `${unread}`;
}

const TABS = [
  { label: "For you", href: "/for-you" },
  { label: "Inbox", href: "/inbox", countsUnread: true },
  { label: "Tasks", href: "/tasks" },
  { label: "Contacts", href: "/contacts" },
] as const;

/** Opens the shared command-K palette (the global search / jump-nav). */
function openCommand() {
  window.dispatchEvent(new Event("jobtext:open-command"));
}

/**
 * The sticky TOP BAR (APP-SHELL-REDESIGN §1, §3, mockup .topbar) — the app's
 * SOLE global nav; the left sidebar is gone. A real surface (~60px) with a soft
 * bottom shadow:
 *   left   = JobText mark + company switcher chip
 *   center = segmented primary tabs with the crafted active pill (white, petrol-
 *            deep text, subtle shadow — never a flat block)
 *   right  = a prominent search field (opens the existing global search /
 *            command-K), a petrol "New message" compose button, a notifications
 *            bell with the unread dot, and the avatar menu (settings, theme, sign
 *            out).
 *
 * Every destination and behavior the sidebar carried is preserved. On mobile the
 * bar collapses to mark + search + avatar; the bottom tab bar owns primary nav.
 */
export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const unread = useUnreadConversationCount();

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-[60px] shrink-0 items-center gap-3 px-3 md:gap-[18px] md:px-4",
        // A real surface: translucent raised white with a soft bottom shadow +
        // hairline (mockup .topbar). backdrop-blur so content scrolls under it.
        "border-b border-app-line bg-app-white/85 backdrop-blur-md app-shadow-bar",
      )}
    >
      {/* LEFT: mark + company chip */}
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/inbox"
          aria-label="JobText"
          className="text-[16px] font-bold tracking-[-0.02em] text-app-petrol-deep"
        >
          JobText
        </Link>
        <div className="hidden sm:block">
          <CompanySwitcher />
        </div>
      </div>

      {/* CENTER: segmented primary tabs (desktop/tablet only) */}
      <nav
        aria-label="Primary"
        className="mx-auto ml-1.5 hidden items-center gap-0.5 rounded-full bg-[rgba(20,32,30,0.035)] p-1 dark:bg-white/5 md:flex"
      >
        {TABS.map((tab) => {
          const active = isNavActive(pathname, tab.href);
          const count =
            "countsUnread" in tab && tab.countsUnread && unread > 0
              ? tabCount(unread)
              : null;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              aria-label={
                count ? `${tab.label}, ${unread} unread` : undefined
              }
              className={cn(
                "inline-flex h-[34px] items-center gap-1.5 rounded-full px-[15px] text-[13.5px] transition-[color,background,box-shadow] duration-150 ease-out",
                active
                  ? "bg-app-white font-semibold text-app-petrol-deep shadow-[0_1px_2px_rgba(20,32,30,0.06),0_2px_8px_-4px_rgba(15,118,110,0.35)]"
                  : "font-medium text-app-muted hover:text-app-ink",
              )}
            >
              {tab.label}
              {count && (
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-app-tint px-[5px] text-[11px] font-bold tabular-nums text-app-petrol-deep">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* RIGHT: search + compose + bell + avatar */}
      <div className="ml-auto flex items-center gap-2 md:gap-2.5">
        {/* Prominent search field → opens command-K. A button styled as an input
            (it never captures typing itself; the palette does). */}
        <button
          type="button"
          onClick={openCommand}
          aria-label="Search messages and contacts"
          aria-keyshortcuts="Meta+K Control+K"
          className="hidden h-[38px] w-[200px] items-center gap-2 rounded-app-ctrl border border-app-line bg-app-white pl-3 pr-2.5 text-left shadow-[inset_0_1px_2px_rgba(20,32,30,0.03)] transition-[border-color,box-shadow] duration-150 ease-out hover:border-app-tint-line focus-visible:border-app-petrol focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15 lg:flex lg:w-[280px]"
        >
          <Search
            className="size-[17px] shrink-0 text-app-muted-2"
            strokeWidth={1.7}
            aria-hidden
          />
          <span className="flex-1 truncate text-[13px] text-app-muted-2">
            Search messages and contacts
          </span>
          <kbd className="rounded-md border border-app-line bg-app-stone-0 px-1.5 py-0.5 text-[11px] font-semibold text-app-muted-2">
            ⌘K
          </kbd>
        </button>
        {/* Compact search icon for narrow widths (still opens command-K). */}
        <button
          type="button"
          onClick={openCommand}
          aria-label="Search"
          className="grid size-[38px] place-items-center rounded-app-ctrl border border-app-line bg-app-white text-app-ink shadow-[0_1px_1px_rgba(20,32,30,0.03)] transition-[border-color,background,box-shadow] duration-150 ease-out hover:border-app-tint-line hover:bg-app-stone-1 hover:app-shadow-row lg:hidden"
        >
          <Search className="size-[18px]" strokeWidth={1.7} aria-hidden />
        </button>

        {/* Petrol compose. Desktop shows the labelled button; the FAB covers
            mobile inbox, so here we hide the label under md and keep the icon. */}
        <button
          type="button"
          onClick={() => router.push("/inbox/new")}
          aria-label="New message"
          className="inline-flex h-[38px] items-center gap-1.5 rounded-app-ctrl bg-primary px-3 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(11,79,73,0.3),0_8px_18px_-10px_rgba(15,118,110,0.7)] transition-[background,transform,box-shadow] duration-150 ease-out hover:bg-[#0d6a63] active:translate-y-px md:px-3.5"
        >
          <Plus className="size-4" strokeWidth={2} aria-hidden />
          <span className="hidden md:inline">New message</span>
        </button>

        {/* Notifications bell with the unread dot. The existing D24 bell (feed,
            mark-all-read on close, realtime badge, deep-links) is reused intact;
            its trigger is styled to the mockup .icon-btn via the `appVariant`. */}
        <NotificationBell appVariant />

        <AvatarMenu />
      </div>
    </header>
  );
}
