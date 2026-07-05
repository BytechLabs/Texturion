"use client";

import { PanelLeft, Search } from "lucide-react";

import { NotificationBell } from "@/components/notifications/notification-bell";
import { useActiveCompany } from "@/lib/company/provider";

import { avatarInitials } from "./avatar-color";
import { MemberMenu } from "./member-menu";

/** Opens the ⌘K command palette (the app's real navigator + global search). */
function openCommand() {
  window.dispatchEvent(new Event("jobtext:open-command"));
}

/**
 * Desktop utility top strip (lg+ only). Deliberately NOT a navigation bar — the
 * labeled sidebar remains the single primary nav (PORTAL-UX). This carries only
 * the global utilities: the sidebar collapse toggle, a visible search field that
 * opens the ⌘K palette (making it discoverable), the notifications bell, and the
 * account menu — the last two moved up out of the sidebar footer, not duplicated.
 * A single hairline bottom border, no shadow, calm white surface.
 */
export function TopBar({
  collapsed,
  onToggleSidebar,
}: {
  collapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const { displayName, membership } = useActiveCompany();

  return (
    <header className="hidden h-14 shrink-0 items-center gap-3 border-b border-app-line bg-app-white pl-2.5 pr-4 lg:flex">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-pressed={collapsed}
        className="grid size-9 shrink-0 place-items-center rounded-[9px] text-app-muted outline-none transition-colors hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PanelLeft className="size-[18px]" strokeWidth={1.8} aria-hidden />
      </button>

      {/* Search field — a button styled as an input that opens the ⌘K palette. */}
      <div className="flex min-w-0 flex-1">
        <button
          type="button"
          onClick={openCommand}
          aria-label="Search"
          aria-keyshortcuts="Meta+K Control+K"
          className="flex h-9 w-full max-w-md items-center gap-2 rounded-app-ctrl border border-app-line bg-app-white px-3 text-left text-[13.5px] text-app-muted outline-none transition-colors hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="size-4 shrink-0" strokeWidth={1.8} aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Search messages, contacts, tasks…
          </span>
          <kbd className="hidden shrink-0 items-center rounded border border-app-line bg-app-stone-1 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-app-muted-2 sm:inline-flex">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <NotificationBell appVariant />
        <MemberMenu side="bottom" align="end">
          <button
            type="button"
            aria-label="Your account"
            className="grid size-9 place-items-center rounded-full outline-none transition-colors hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-full bg-app-tint text-[11px] font-semibold text-app-petrol-deep"
            >
              {avatarInitials(displayName || membership.name)}
            </span>
          </button>
        </MemberMenu>
      </div>
    </header>
  );
}
