"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { InboxPane } from "@/components/inbox/inbox-pane";
import { ListSkeleton } from "@/components/inbox/empty-states";
import { cn } from "@/lib/utils";

/**
 * Inbox master-detail (G3): the 360px list pane + the flexible thread pane.
 * Mobile (<768px): the list is full-screen at /inbox; a thread or the compose
 * flow pushes in full-screen (its own back header). Tablet/desktop: both
 * panes side by side.
 */
export default function InboxLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const listOnly = pathname === "/inbox";

  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="Conversation list"
        className={cn(
          "h-full w-full min-w-0 flex-col md:flex md:w-[360px] md:shrink-0 md:border-r md:border-border",
          listOnly ? "flex" : "hidden",
        )}
      >
        <Suspense fallback={<ListSkeleton />}>
          <InboxPane />
        </Suspense>
      </section>
      <div
        className={cn(
          "h-full min-w-0 flex-1 md:block",
          listOnly ? "hidden" : "block",
        )}
      >
        {children}
      </div>
    </div>
  );
}
