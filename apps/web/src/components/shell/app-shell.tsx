"use client";

import { UnreadTitleManager } from "@/components/notifications/unread-title-manager";

import { CommandPalette } from "./command-palette";
import { ComposeFab } from "./compose-fab";
import { MobileTabBar } from "./mobile-tab-bar";
import { IconRail, Sidebar } from "./sidebar";

/**
 * The three responsive shell regions (G3):
 * - desktop ≥1024px: 240px sidebar + content;
 * - tablet 768–1023px: 64px icon rail + content;
 * - mobile <768px: full-bleed content + bottom tab bar + compose FAB slot.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh overflow-hidden">
      <Sidebar />
      <IconRail />
      <main className="min-w-0 flex-1 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
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
