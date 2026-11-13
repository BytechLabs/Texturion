import { useInfiniteQuery } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import { nextCursorParam } from "./pagination";
import type { GalleryItem, Page } from "./types";

/**
 * GET /v1/conversations/:id/attachments — the attachments gallery (§5.2 /
 * conversations-gallery route). A two-arm union (MMS message_attachments joined
 * through messages + the generic D19 attachments table for note & task media),
 * merged/sorted (created_at, id) DESC and cursor-paginated server-side. Every
 * item arrives with a freshly-minted short-lived signed URL, so the grid renders
 * without a second /v1/attachments/:id/url round-trip per thumbnail.
 *
 * `enabled` gates the fetch until the gallery surface is actually opened — the
 * panel's "View all attachments" preview and the header-overflow gallery are the
 * only two places that mount it, and neither should fetch on every thread open.
 *
 * A page mixes 300 s note/task URLs with 1 h MMS ones, so it is reused for 4
 * minutes, the shortest lifetime less a minute: reopening the gallery within
 * that window shows the same page without re-signing it.
 */
export function useAttachmentGallery(conversationId: string, enabled = true) {
  const companyId = useCompanyId();
  return useInfiniteQuery({
    queryKey: keys.conversations.attachments(companyId, conversationId),
    queryFn: ({ pageParam }) =>
      apiFetch<Page<GalleryItem>>(
        `/v1/conversations/${conversationId}/attachments`,
        { companyId, searchParams: { cursor: pageParam } },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
    enabled,
    staleTime: 4 * 60_000,
    gcTime: 4 * 60_000,
  });
}
