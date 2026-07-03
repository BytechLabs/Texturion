import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { ImportResult } from "./types";

/**
 * vCard import (D20 §3.2 / APP-FEATURES-V2 §3.2). POST /v1/contacts/import-vcard
 * — a multipart `file` (.vcf) with one-or-many VCARD blocks (phone/Google/Apple
 * export), owner/admin only (the §10 matrix, matching the CSV importer). The
 * server parses vCard 3.0 + 4.0 (FN/N → name, TEL → phone), normalizes each TEL
 * to E.164, drops un-normalizable numbers with a per-row reason, and returns
 * the SAME `{ imported, updated, skipped, errors }` shape as the CSV importer —
 * a second parser into the one idempotent upsert, not a second pipeline.
 */

/** Mirror of the API's .vcf size ceiling (5 MB — routes/contacts.ts). */
export const VCARD_MAX_BYTES = 5 * 1024 * 1024;

export function useImportVCard() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File | Blob) => {
      const formData = new FormData();
      formData.append("file", file);
      return apiFetch<ImportResult>("/v1/contacts/import-vcard", {
        method: "POST",
        companyId,
        formData,
      });
    },
    onSuccess: () => {
      // A vCard import upserts contacts — refresh the list (and its badges)
      // exactly like the CSV importer does.
      queryClient.invalidateQueries({
        queryKey: keys.contacts.lists(companyId),
        refetchType: "active",
      });
    },
  });
}
