import { useInfiniteQuery } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";

/**
 * #324 — one chronology of everything done for a customer.
 *
 * D7's threading rule means a long relationship is MANY conversations: a
 * customer returning after 31 days starts a new one, so a homeowner serviced
 * once a year for six years is six threads. The prior-conversations list (G6)
 * and the per-contact call history (#205) both already existed as separate
 * blocks, with tasks nowhere — so "what have we done for this customer?", the
 * question asked before every visit, meant opening threads one at a time.
 */
export type TimelineKind = "conversation" | "call" | "task";

export interface TimelineEntry {
  kind: TimelineKind;
  id: string;
  occurred_at: string;
  /** Where tapping the row goes. Null only for a call that never threaded. */
  conversation_id: string | null;
  /** Conversation status, or call outcome. Null on a task. */
  status: string | null;
  /** Task title, or the caller's name. Null on a conversation. */
  detail: string | null;
  started_at: string;
  /** Talk time on a call: the forward leg's seconds, never ring time. */
  talk_seconds: number | null;
  due_at: string | null;
  done: boolean | null;
}

interface TimelinePage {
  entries: TimelineEntry[];
  /** Null at the end of the history, which is how the client knows to stop. */
  next_before: string | null;
}

/**
 * The cursor is a timestamp rather than an opaque token, which is deliberate:
 * pagination and jump-to-date are the same request ("from here backwards"), so
 * a date picker can seed this query with no second endpoint.
 */
export function useContactTimeline(contactId: string) {
  const companyId = useCompanyId();
  return useInfiniteQuery({
    queryKey: [companyId, "contact-timeline", contactId] as const,
    queryFn: ({ pageParam }) =>
      apiFetch<TimelinePage>(`/v1/contacts/${contactId}/timeline`, {
        companyId,
        searchParams: { before: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_before ?? undefined,
  });
}
