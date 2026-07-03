"use client";

import { usePathname } from "next/navigation";

import { UnreadTitleManager } from "@/components/notifications/unread-title-manager";
import { cn } from "@/lib/utils";

import { CommandPalette } from "./command-palette";
import { ComposeFab } from "./compose-fab";
import { MobileTabBar } from "./mobile-tab-bar";
import { TopBar } from "./top-bar";

/**
 * The APP-SHELL-REDESIGN app frame: a sticky TOP BAR is the sole global nav (the
 * left sidebar is gone), with content owning the FULL WIDTH beneath it. A fixed
 * full-viewport-height column (`h-svh overflow-hidden`) so the browser page never
 * scrolls — only the top bar stays pinned and inner panes scroll.
 *
 * - Top bar: mark + company chip, segmented primary tabs, search (command-K),
 *   compose, notifications, avatar menu (top-bar.tsx). On mobile it collapses to
 *   mark + search + avatar and the bottom tab bar owns primary nav.
 * - Content region (`main`): for the inbox it is a fixed, NON-scrolling region
 *   whose child panes (list / thread message area / context panel) each scroll
 *   independently. For the calm surfaces (settings, contacts, templates,
 *   for-you, tasks) it scrolls as a normal document — reading pages, not the
 *   3-pane frame.
 *
 * The app ground carries the warm-stone + petrol/amber wash (app-ground) so the
 * surface reads layered, not flat paper.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The inbox is the fixed 3-pane frame; everything else is a scrolling doc.
  const fixedFrame = pathname === "/inbox" || pathname.startsWith("/inbox/");

  return (
    <div className="flex h-svh flex-col overflow-hidden app-ground">
      <TopBar />
      <main
        className={cn(
          "flex min-w-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0",
          fixedFrame
            ? "overflow-hidden" // inner panes own the scroll
            : "overflow-y-auto", // calm surfaces scroll as a document
        )}
      >
        {children}
      </main>
      <MobileTabBar />
      <ComposeFab />
      <CommandPalette />
      {/* G9 unread indicators: `(3) …` title prefix + favicon dot. */}
      <UnreadTitleManager />
    </div>
  );
}
