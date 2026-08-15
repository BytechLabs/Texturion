import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { WebhookEventType } from "@loonext/shared";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";

/**
 * #243 — outbound webhook endpoints.
 *
 * The signing secret is never in a list response, so it is not in this type
 * either. It arrives exactly twice in the product's whole life — on create and
 * on rotate — and both of those return it under `secret_once`, which is named
 * that way so a caller storing the response wholesale is at least storing
 * something that says what it is.
 */
export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEventType[];
  active: boolean;
  /** A catalogue KEY when we turned it off, so the phones can translate it. */
  disabled_reason: string | null;
  disabled_at: string | null;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  event_type: string;
  status: "pending" | "delivering" | "succeeded" | "failed";
  attempts: number;
  response_status: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
  next_attempt_at: string | null;
}

interface EndpointList {
  endpoints: WebhookEndpoint[];
  cap: number;
}

interface MintedSecret {
  endpoint: WebhookEndpoint;
  secret_once: string;
}

export function useWebhookEndpoints() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.webhookEndpoints(companyId),
    queryFn: () => apiFetch<EndpointList>("/v1/webhooks", { companyId }),
  });
}

/**
 * The delivery log for one endpoint.
 *
 * Only fetched when somebody opens it. This is a debugging surface — most
 * visits to the section never look at it, and a list that loads fifty rows per
 * endpoint on every page view would make the common case pay for the rare one.
 */
export function useWebhookDeliveries(endpointId: string | null) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.webhookDeliveries(companyId, endpointId ?? ""),
    queryFn: () =>
      apiFetch<{ deliveries: WebhookDelivery[] }>(
        `/v1/webhooks/${endpointId}/deliveries`,
        { companyId },
      ),
    enabled: endpointId !== null,
    // Deliveries move on a five-minute sweeper, so anything more eager than
    // this is asking a question whose answer cannot have changed.
    staleTime: 30_000,
  });
}

export interface CreateEndpointInput {
  url: string;
  events: WebhookEventType[];
  description?: string;
}

export function useCreateWebhookEndpoint() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEndpointInput) =>
      apiFetch<MintedSecret>("/v1/webhooks", {
        companyId,
        method: "POST",
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: keys.webhookEndpoints(companyId),
      }),
  });
}

export interface UpdateEndpointInput {
  id: string;
  url?: string;
  events?: WebhookEventType[];
  description?: string | null;
  active?: boolean;
}

export function useUpdateWebhookEndpoint() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateEndpointInput) =>
      apiFetch<{ endpoint: WebhookEndpoint }>(`/v1/webhooks/${id}`, {
        companyId,
        method: "PATCH",
        body: patch,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: keys.webhookEndpoints(companyId),
      }),
  });
}

export function useDeleteWebhookEndpoint() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`/v1/webhooks/${id}`, { companyId, method: "DELETE" }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: keys.webhookEndpoints(companyId),
      }),
  });
}

export function useRotateWebhookSecret() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<MintedSecret>(`/v1/webhooks/${id}/secret`, {
        companyId,
        method: "POST",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: keys.webhookEndpoints(companyId),
      }),
  });
}

export interface WebhookTestResult {
  ok: boolean;
  status: number | null;
  reason?: "timeout" | "unreachable";
}

/**
 * Send a signed ping and relay what the far end said.
 *
 * Not a `useQuery`: this has a side effect on somebody else's system, and it
 * happens because a person pressed a button. A failing test is a SUCCESSFUL
 * request — the route answers 200 with `ok: false` — so the mutation only
 * rejects when our own API is unreachable.
 */
export function useTestWebhookEndpoint() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<WebhookTestResult>(`/v1/webhooks/${id}/test`, {
        companyId,
        method: "POST",
      }),
  });
}
