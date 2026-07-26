"use client";

import { headlineWork } from "@/components/for-you/for-you-view";
import { useForYou } from "@/lib/api/for-you";
import { useNumbers } from "@/lib/api/numbers";
import { flattenPages } from "@/lib/api/pagination";
import { useAllTasks } from "@/lib/api/tasks";
import { useUnreadConversationCount } from "@/lib/push/use-unread-count";

/**
 * The live sidebar nav counts (PORTAL-UX §1.1). One hook so the calm sidebar and
 * the mobile tab bar read the same numbers:
 *
 * - `forYou`  — the For-you batch size (the ONE petrol pill, §1.1). The SAME
 *   number the For You header shows (#306): distinct conversations plus tasks,
 *   from the server's totals rather than from the 20 rows it returned.
 *   Decrements live as items clear (the for-you cache patches on complete;
 *   realtime re-derives).
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

  // #306: the SAME number the For You header shows. Summing section lengths
  // here was wrong twice over — it double-counted a thread that appears in
  // both "waiting on you" and "unread" (the defect 76209c5 fixed for the
  // header and not for this pill), and it counted the 20 rows the server
  // returned rather than the work behind them. The nav pill and the page it
  // links to disagreeing is worse than either number alone.
  const fy = forYou.data;
  const forYouCount = fy ? headlineWork(fy) : 0;

  const openTasks = flattenPages(tasks.data).filter((t) => !t.done).length;
  const activeNumbers = (numbers.data?.data ?? []).length;

  return {
    forYou: forYouCount,
    inbox,
    tasks: openTasks,
    numbers: activeNumbers,
  };
}
