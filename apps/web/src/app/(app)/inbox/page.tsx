import type { Metadata } from "next";

import { EmptyThreadPane } from "@/components/inbox/empty-thread-pane";

// A named tab title instead of the bare app default ("Loonext") so this
// screen is distinguishable in the browser history / a wall of tabs.
export const metadata: Metadata = { title: "Inbox" };

/**
 * /inbox with no thread selected. Mobile shows the list (the layout hides
 * this pane); tablet/desktop shows a quiet placeholder in the thread region.
 *
 * #228: the placeholder moved into a client leaf rather than this file gaining
 * a `"use client"` directive. A page that exports `metadata` cannot be a client
 * component at all, and the standard answer — push the one line that needs the
 * reader's language down to a component that can ask for it — keeps the route
 * server-rendered and costs nothing.
 */
export default function InboxIndexPage() {
  return <EmptyThreadPane />;
}
