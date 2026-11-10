import { useInfiniteQuery } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { nextCursorParam } from "./pagination";
import type { Page } from "./types";

/**
 * #714 — one activity timeline for every record. The server writes the rows
 * (triggers on the source tables), so nothing here assembles a history.
 */
export type ActivityRecordType = "contact" | "task" | "conversation" | "call";

export type ActivityCategory = "message" | "call" | "change";

export type ActivityActorType = "member" | "customer" | "automation" | "system";

export interface ActivityItem {
  id: string;
  kind: string;
  category: ActivityCategory;
  occurred_at: string;
  actor: {
    type: ActivityActorType;
    user_id: string | null;
    display_name: string | null;
  };
  payload: Record<string, unknown>;
  /** What the event came from, so the row can link to it. */
  source: {
    type: string;
    id: string;
    conversation_id: string | null;
  } | null;
}

/** A task's activity is at `/record-activity`: `/activity` is the #689 feed with comments. */
export function activityPath(recordType: ActivityRecordType, recordId: string): string {
  switch (recordType) {
    case "contact":
      return `/v1/contacts/${recordId}/activity`;
    case "conversation":
      return `/v1/conversations/${recordId}/activity`;
    case "call":
      return `/v1/calls/${recordId}/activity`;
    case "task":
      return `/v1/tasks/${recordId}/record-activity`;
  }
}

/** The filter is the server's, so paging stays right under it. */
export function useRecordActivity(
  recordType: ActivityRecordType,
  recordId: string,
  category: ActivityCategory | null,
) {
  const companyId = useCompanyId();
  return useInfiniteQuery({
    queryKey: [companyId, "record-activity", recordType, recordId, category] as const,
    queryFn: ({ pageParam }) =>
      apiFetch<Page<ActivityItem>>(activityPath(recordType, recordId), {
        companyId,
        searchParams: {
          cursor: pageParam,
          ...(category ? { category } : {}),
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
    refetchOnMount: "always",
  });
}
