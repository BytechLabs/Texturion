import type { ForYou } from "@/lib/api/types";

/**
 * The number of distinct things needing the reader, for the line above the
 * queue. Conversations are counted once however many sections carry them:
 * "waiting on you" and "unread" overlap by design, since the second is a
 * cross-cut of the first rather than a separate pile of work.
 *
 * #306: this counts the ROWS, and the rows are capped at the section limit, so
 * it is bounded by the page size rather than by the work — a member with 60
 * conversations waiting on them read "20 things need you". The server now
 * sends the real numbers; this stays as the fallback for a client running
 * ahead of the Worker, where an undercount is at least today's behaviour
 * rather than a new wrong answer.
 */
export function countDistinctWork(data: ForYou): number {
  const conversations = new Set<string>();
  for (const row of data.waiting_on_you) conversations.add(row.conversation_id);
  for (const row of data.unread) conversations.add(row.conversation_id);
  // #293: a due reminder is work. Leaving it out here made the header say
  // "You're all caught up" while a section below it listed a quote to chase —
  // the exact "the count lies in the other direction" this feature is about.
  // The Set is what keeps it honest when the same thread is also unread.
  for (const row of data.follow_ups ?? []) conversations.add(row.conversation_id);
  for (const row of data.triage?.conversations ?? []) {
    conversations.add(row.conversation_id);
  }
  const tasks = new Set<string>();
  for (const row of data.my_tasks) tasks.add(row.task_id);
  for (const row of data.triage?.tasks ?? []) tasks.add(row.task_id);
  return conversations.size + tasks.size;
}

/** #306: the honest headline, or the row-derived one if the server is older. */
export function headlineWork(data: ForYou): number {
  return data.totals?.distinct_work ?? countDistinctWork(data);
}
