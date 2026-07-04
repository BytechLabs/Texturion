"use client";

import { useForYou } from "@/lib/api/for-you";
import { useNumbers } from "@/lib/api/numbers";
import { flattenPages } from "@/lib/api/pagination";
import { useAllTasks } from "@/lib/api/tasks";
import { useUnreadConversationCount } from "@/lib/push/use-unread-count";

/**
 * The live sidebar nav counts (PORTAL-UX §1.1). One hook so the calm sidebar and
 * the mobile tab bar read the same numbers:
 *
 * - `forYou`  — the For-you batch size (the ONE petrol pill, §1.1). The sum of
 *   the queue's actionable sections from GET /v1/for-you: waiting_on_you +
 *   my_tasks + unread + the owner/admin triage strip. Decrements live as items
 *   clear (the for-you cache patches on complete; realtime re-derives).
 * - `inbox`   — the shared unread-conversation count (muted numeral, §1.1).
 * - `tasks`   — open tasks (not done), muted numeral.
 * - `numbers` — active lines, muted numeral.
 *
 * Every source is an already-warm query (the shell keeps them alive), so this
 * adds no traffic beyond what the app already fetches.
 */
export interface NavCounts {
  forYou: number;
  inbox: number;
  tasks: number;
  numbers: number;
}

export function useNavCounts(): NavCounts {
  const forYou = useForYou();
  const inbox = useUnreadConversationCount();
  // Open tasks = the full task list minus completed ones (the list carries a
  // `done` flag). useAllTasks flattens every page of GET /v1/tasks.
  const tasks = useAllTasks();
  const numbers = useNumbers();

  const fy = forYou.data;
  const forYouCount = fy
    ? fy.waiting_on_you.length +
      fy.my_tasks.length +
      fy.unread.length +
      (fy.triage ? fy.triage.conversations.length + fy.triage.tasks.length : 0)
    : 0;

  const openTasks = flattenPages(tasks.data).filter((t) => !t.done).length;
  const activeNumbers = (numbers.data?.data ?? []).length;

  return {
    forYou: forYouCount,
    inbox,
    tasks: openTasks,
    numbers: activeNumbers,
  };
}
