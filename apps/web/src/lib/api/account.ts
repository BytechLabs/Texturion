import { useMutation, useQuery } from "@tanstack/react-query";

import { apiFetch } from "./client";
import type { AccountDeletionPreview, AccountDeletionResult } from "./types";

/**
 * GET /v1/account/deletion-preview (#346) — what deleting would touch.
 *
 * Company-exempt on purpose: this is about the person, not one of their
 * workspaces, and someone with no membership at all must still be able to
 * leave. Enabled only while the section is expanded — nobody needs this
 * computed on every visit to the account page.
 */
export function useAccountDeletionPreview(enabled: boolean) {
  return useQuery({
    queryKey: ["account", "deletion-preview"] as const,
    enabled,
    queryFn: () =>
      apiFetch<AccountDeletionPreview>("/v1/account/deletion-preview"),
  });
}

/** DELETE /v1/account (#346) — irreversible; the caller signs out after. */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: () =>
      apiFetch<AccountDeletionResult>("/v1/account", { method: "DELETE" }),
  });
}
