import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { importFormData, type ContactImportRequest } from "./contacts";
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

/**
 * The .vcf size ceiling used to live here as `5 * 1024 * 1024` under a comment
 * calling it a mirror of the API's. It is now VCARD_IMPORT_MAX_BYTES in
 * @loonext/shared and callers read it from there — not re-exported through this
 * module, because a second name for one number is how the two drift, and a
 * client that promises a file will import when the server will refuse it wastes
 * the upload before saying so.
 */
export function useImportVCard() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    // #248: a .vcf carries the same attestation as a CSV. The route was
    // documented as having the #226 gate and did not, so a phone's address book
    // was the one bulk door into this product with no consent question at all.
    mutationFn: (request: ContactImportRequest) =>
      apiFetch<ImportResult>("/v1/contacts/import-vcard", {
        method: "POST",
        companyId,
        formData: importFormData(request),
      }),
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
