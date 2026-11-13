"use client";

import { useForYou } from "@/lib/api/for-you";
import { headlineWork } from "@/lib/for-you/headline";
import { useUnreadConversationCount } from "@/lib/push/use-unread-count";

// The nav numerals (PORTAL-UX §1.1), one hook each so a surface reads only the ones it shows.

/** For you: the number its header shows (#306), from the server's totals. */
export function useForYouNavCount(): number {
  const forYou = useForYou();
  return forYou.data ? headlineWork(forYou.data) : 0;
}

/** Inbox: the shared unread-conversation count. */
export function useInboxNavCount(): number {
  return useUnreadConversationCount();
}

/** Tasks: open and assigned to me, as a bare GET /v1/tasks lists; a Worker without totals sends only rows. */
export function useTaskNavCount(): number {
  const forYou = useForYou();
  return forYou.data?.totals?.my_tasks ?? forYou.data?.my_tasks.length ?? 0;
}
