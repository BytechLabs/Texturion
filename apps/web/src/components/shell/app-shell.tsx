"use client";

import { usePathname } from "next/navigation";

import { UnreadTitleManager } from "@/components/notifications/unread-title-manager";
import { cn } from "@/lib/utils";

import { CommandPalette } from "./command-palette";
import { ComposeFab } from "./compose-fab";
import { MobileTabBar } from "./mobile-tab-bar";
import { Sidebar } from "./sidebar";

/**
 * The APP-LAYOUT-V2 §1.1 full-viewport-height app frame: a fixed shell pinned
 * to the viewport (`h-svh overflow-hidden`) so the browser page never scrolls —
 * only inner panes do.
 *
 * - Nav rail: the receding, collapsible Linear-style sidebar (§1.3), the tablet
 *   icon rail, or the mobile bottom tabs.
 * - Content region (`main`): for the inbox it is a fixed, NON-scrolling region
 *   whose child panes (list / thread message area / context panel) each scroll
 *   independently (§1.1). For the calm surfaces (settings, contacts, templates,
 *   for-you, tasks) it scrolls as a normal document — those are reading pages,
 *   not the 3-pane frame.
 *
 * The page body itself never scrolls in either mode (§1.1 auditable check:
 * document scrollTop stays 0; scrollbars only appear inside a pane).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The inbox is the fixed 3-pane frame; everything else is a scrolling doc.
  const fixedFrame = pathname === "/inbox" || pathname.startsWith("/inbox/");

  return (
    <div className="flex h-svh overflow-hidden">
      <Sidebar />
      <main
        className={cn(
          "flex min-w-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0",
          fixedFrame
            ? "overflow-hidden" // inner panes own the scroll (§1.1)
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
