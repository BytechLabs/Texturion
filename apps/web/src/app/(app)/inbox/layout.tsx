"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { InboxDisplayMenu } from "@/components/inbox/display-menu";
import { InboxPane } from "@/components/inbox/inbox-pane";
import { InboxListSkeleton } from "@/components/inbox/empty-states";
import { useT } from "@/i18n/provider";
import { InboxFocusProvider } from "@/lib/inbox/navigation-focus";
import { useLocalStorageFlag } from "@/lib/hooks/use-local-storage-flag";
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
  if (pathname === "/inbox/scheduled" || pathname.startsWith("/inbox/scheduled/")) {
    return children;
  }
  return <InboxSplitLayout pathname={pathname}>{children}</InboxSplitLayout>;
}

function InboxSplitLayout({
  pathname,
  children,
}: Readonly<{ pathname: string; children: React.ReactNode }>) {
  const t = useT();
  const inboxIndex = pathname === "/inbox";
  const [compact, setCompact] = useLocalStorageFlag("loonext.inbox.compact", false);
  const [fullList, setFullList] = useLocalStorageFlag("loonext.inbox.full-list", false);

  return (
    <InboxFocusProvider>
      <div className="group/inbox flex h-full min-h-0 flex-1 overflow-hidden" data-full-list={fullList || undefined}>
        <section
          aria-label={t("appShell.conversationListAria")}
          className={cn(
            "h-full w-full min-w-0 flex-col md:flex md:w-[360px] md:shrink-0 md:border-r md:border-border",
            inboxIndex ? "flex" : "hidden",
            fullList && (inboxIndex ? "lg:mx-auto lg:w-full lg:max-w-5xl lg:border-r-0" : "lg:hidden"),
          )}
        >
          <Suspense fallback={<InboxListSkeleton />}>
            <InboxPane
              compact={compact}
              displayMenu={
                <InboxDisplayMenu
                  compact={compact}
                  onCompactChange={setCompact}
                  fullList={fullList}
                  onFullListChange={setFullList}
                />
              }
            />
          </Suspense>
        </section>
        <section
          aria-label={t("thread.conversationPaneAria")}
          className={cn(
            "h-full min-h-0 min-w-0 flex-1 overflow-hidden",
            inboxIndex ? "hidden md:flex md:flex-col" : "flex flex-col",
            fullList && inboxIndex && "lg:hidden",
          )}
        >
          {children}
        </section>
      </div>
    </InboxFocusProvider>
  );
}
