/**
 * #224 — text-to-pay, the web client's half.
 *
 * Two query keys because they have different lifetimes and different owners:
 * the connected ACCOUNT belongs to the workspace and changes on a settings
 * screen; the REQUESTS belong to one conversation and change when a customer
 * pays, which is a webhook we did not initiate. Sharing a key would mean
 * re-reading Stripe every time a thread opened.
 *
 * #607: both now live in the shared key factory rather than here. The realtime
 * provider has to name the requests key to make a landing deposit live, and a
 * private copy in this file would have been a second place to keep it right.
 * `keys.payments` also records why only ONE of the two is company-prefixed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaymentRequestState, PayoutReadiness } from "@loonext/shared";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";

export interface PayoutAccount {
  connected: boolean;
  readiness: PayoutReadiness;
  /** Server-composed, so all three clients say the same sentence. */
  title: string;
  detail: string;
  action: string | null;
  country: string | null;
  currency: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  disabled_reason: string | null;
  requirements_due: string[];
  requirements_deadline: string | null;
}

export interface PaymentRequest {
  id: string;
  conversation_id: string;
  contact_id: string;
  message_id: string | null;
  amount_cents: number;
  currency: "usd" | "cad";
  description: string;
  status: "requested" | "paid" | "cancelled" | "expired";
  state: PaymentRequestState;
  paid_at: string | null;
  refunded_at: string | null;
  amount_refunded_cents: number | null;
  disputed_at: string | null;
  cancelled_at: string | null;
  expires_at: string;
  created_at: string;
  created_by: string | null;
}

/** GET /v1/payments/account — refreshed from Stripe on the server. */
export function usePayoutAccount(enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.payments.account(companyId),
    queryFn: () => apiFetch<PayoutAccount>("/v1/payments/account", { companyId }),
    enabled,
  });
}

/** POST /v1/payments/account/onboarding — the hosted flow, one link per click. */
export function useStartPayoutOnboarding() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ url: string }>("/v1/payments/account/onboarding", {
        method: "POST",
        companyId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: keys.payments.account(companyId),
      });
    },
  });
}

/** GET /v1/payments/account/dashboard — where a refund is actually issued. */
export function useStripeDashboardLink() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ url: string }>("/v1/payments/account/dashboard", { companyId }),
  });
}

export function usePaymentRequests(conversationId: string, enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.payments.requests(companyId, conversationId),
    queryFn: () =>
      apiFetch<{ payment_requests: PaymentRequest[] }>(
        `/v1/conversations/${conversationId}/payment-requests`,
        { companyId },
      ),
    enabled: enabled && conversationId.length > 0,
  });
}

export function useCreatePaymentRequest(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      amountCents: number;
      description: string;
      idempotencyKey: string;
    }) =>
      apiFetch<PaymentRequest>(
        `/v1/conversations/${conversationId}/payment-requests`,
        {
          method: "POST",
          companyId,
          idempotencyKey: args.idempotencyKey,
          body: { amount_cents: args.amountCents, description: args.description },
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: keys.payments.requests(companyId, conversationId),
      });
      // The request went out as an ordinary text, so the thread has a new
      // message the timeline does not know about yet.
      //
      // This was written as a literal `["messages", companyId, conversationId]`,
      // which is the thread key with its first two segments swapped and
      // therefore matches no query at all — the refetch it names has never once
      // run. It was invisible because the outbound message also arrives as a
      // `message.created` broadcast, which appends it live; the hole only opens
      // for a sender whose socket is down, who then sees the request they just
      // sent nowhere in the thread.
      void queryClient.invalidateQueries({
        queryKey: keys.thread(companyId, conversationId),
      });
    },
  });
}

export function useCancelPaymentRequest(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<PaymentRequest>(`/v1/payment-requests/${id}/cancel`, {
        method: "POST",
        companyId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: keys.payments.requests(companyId, conversationId),
      });
    },
  });
}
