import { useQuery } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { AttachmentUrl } from "./types";

/**
 * GET /v1/attachments/:id/url — membership-checked signed Storage URL, TTL
 * 1 hour (SPEC §7). Cached just under the TTL so thumbnails (G5 blur-up)
 * never render with an expired link.
 */
export function useAttachmentUrl(attachmentId: string, enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.attachmentUrl(companyId, attachmentId),
    queryFn: () =>
      apiFetch<AttachmentUrl>(`/v1/attachments/${attachmentId}/url`, {
        companyId,
      }),
    enabled,
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
  });
}
