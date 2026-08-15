import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ApiKeyScope } from "@loonext/shared";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";

/**
 * #243 — workspace API keys.
 *
 * The token is not a field on this type, because it is not a field in any
 * response but the one that mints it. It exists outside the caller's own app
 * exactly once, in the 201, under `token_once`.
 */
export interface ApiKey {
  id: string;
  name: string;
  /** The first twelve characters, so three keys can be told apart. */
  token_prefix: string;
  scopes: ApiKeyScope[];
  created_by: string;
  created_at: string;
  /** The field that makes revoking safe: is anything still using this? */
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  expires_at: string | null;
}

interface KeyList {
  keys: ApiKey[];
  cap: number;
  live: number;
}

export function useApiKeys() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.apiKeys(companyId),
    queryFn: () => apiFetch<KeyList>("/v1/api-keys", { companyId }),
  });
}

export interface CreateApiKeyInput {
  name: string;
  scopes: ApiKeyScope[];
  expires_at?: string;
}

export function useCreateApiKey() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) =>
      apiFetch<{ key: ApiKey; token_once: string }>("/v1/api-keys", {
        companyId,
        method: "POST",
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.apiKeys(companyId) }),
  });
}

export function useRevokeApiKey() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`/v1/api-keys/${id}`, { companyId, method: "DELETE" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.apiKeys(companyId) }),
  });
}
