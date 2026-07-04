"use client";

import { usePathname } from "next/navigation";

import { UnreadTitleManager } from "@/components/notifications/unread-title-manager";
import { cn } from "@/lib/utils";

import { TaskDrawerHost } from "@/components/tasks/task-drawer-host";

import { CommandPalette } from "./command-palette";
import { ComposeFab } from "./compose-fab";
import { MobileTabBar } from "./mobile-tab-bar";
import { Sidebar } from "./sidebar";

/**
 * The PORTAL-UX app frame (§1): a calm LEFT SIDEBAR (retiring the old top bar),
 * then the destination content owning the rest of the width. A fixed
 * full-viewport-height row (`h-svh overflow-hidden`) so the browser page never
 * scrolls — the sidebar is pinned and the inner panes/documents scroll.
 *
 * - Sidebar (232px, lg+): company tile, FOCUS + LIBRARY nav, footer member tile.
 *   The single hairline right border, no shadow (sidebar.tsx). Hidden <1000px,
 *   where the labeled bottom tab bar owns primary nav.
 * - Content region (`main`): the destination fills it — the inbox is the fixed
 *   3-pane frame (sidebar | list | thread | drawer); the calm surfaces (for-you,
 *   tasks, contacts, settings, templates) scroll as documents. Each destination
 *   owns its own scroll containers, so `main` is the flex track, not a scroller.
 *
 * The ground is flat calm paper (app-ground; no wash).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The inbox is the fixed 3-pane frame (inner panes own the scroll); every
  // other destination is a calm scrolling document.
  const fixedFrame = pathname === "/inbox" || pathname.startsWith("/inbox/");

  return (
    <div className="flex h-svh overflow-hidden app-ground">
      <Sidebar />
      <main
        className={cn(
          "flex min-w-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0",
          fixedFrame ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
        {children}
      </main>
      <MobileTabBar />
      <ComposeFab />
      <CommandPalette />
      {/* TASKS-V2 D-A: the URL-driven (`?task=`) task detail drawer, openable
          from the /tasks views, the checklist, and thread task-event lines. */}
      <TaskDrawerHost />
      {/* G9 unread indicators: `(3) …` title prefix + favicon dot. */}
      <UnreadTitleManager />
    </div>
  );
}
