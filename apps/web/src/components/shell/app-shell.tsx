"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { UnreadTitleManager } from "@/components/notifications/unread-title-manager";
import { WorkspaceStatusBanner } from "@/components/registration/status-banner";
import { cn } from "@/lib/utils";

import { TaskDrawerHost } from "@/components/tasks/task-drawer-host";

import { CommandPalette } from "./command-palette";
import { ComposeFab } from "./compose-fab";
import { MobileTabBar } from "./mobile-tab-bar";
import { Sidebar } from "./sidebar";
import { WindowDropGuard } from "./window-drop-guard";

const SIDEBAR_PREF_KEY = "loonext:sidebar-collapsed";

function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_PREF_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * The PORTAL-UX app frame (§1): the calm LEFT SIDEBAR is the sole desktop shell
 * (issue #8 — the top bar was retired; search, notifications, account, and the
 * collapse toggle now live in the sidebar's footer user-bar). A fixed
 * full-viewport-height row (`h-svh overflow-hidden`) so the browser page never
 * scrolls — the sidebar is pinned and the inner panes/documents scroll.
 *
 * - Sidebar (232px expanded / 64px icon rail, lg+): workspace tile, search,
 *   FOCUS nav, footer user-bar. The collapse choice is persisted per browser.
 *   Hidden <1000px, where the labeled bottom tab bar owns primary nav.
 * - WorkspaceStatusBanner: ambient not-ready strip, app-wide above the content.
 * - Content region (`main`): the destination fills it — the inbox is the fixed
 *   3-pane frame; the calm surfaces (for-you, tasks, contacts, settings,
 *   templates) scroll as documents. `main` is the flex track, not a scroller.
 * - Compose is the app-wide FAB (all breakpoints).
 *
 * The ground is flat calm paper (app-ground; no wash).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The inbox is the fixed 3-pane frame (inner panes own the scroll); every
  // other destination is a calm scrolling document.
  const fixedFrame = pathname === "/inbox" || pathname.startsWith("/inbox/");

  // Persisted sidebar collapse. Start expanded on the server + first paint
  // (avoids a hydration mismatch), then adopt the stored choice on mount.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(readSidebarCollapsed());
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_PREF_KEY, String(next));
      } catch {
        /* private mode / storage off — the toggle still works this session. */
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-svh overflow-hidden app-ground">
      {/* Full-height sidebar on the left is the whole desktop shell; the content
          column (status banner + destination) fills the rest. */}
      <Sidebar collapsed={collapsed} onToggleSidebar={toggleSidebar} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Ambient workspace status (number provisioning / registration / billing).
            Mounted app-wide so a not-ready workspace is obvious on every page;
            renders null when there's nothing to say. */}
        <WorkspaceStatusBanner />
        <main
          className={cn(
            "flex min-w-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0",
            fixedFrame ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          {children}
        </main>
      </div>
      <MobileTabBar />
      <ComposeFab />
      <CommandPalette />
      {/* TASKS-V2 D-A: the URL-driven (`?task=`) task detail drawer, openable
          from the /tasks views, the checklist, and thread task-event lines. */}
      <TaskDrawerHost />
      {/* G9 unread indicators: `(3) …` title prefix + favicon dot. */}
      <UnreadTitleManager />
      {/* D28: cancel the browser's navigate-to-file on drops that miss a
          dropzone, so a stray drop never blows away an unsent draft. */}
      <WindowDropGuard />
    </div>
  );
}
