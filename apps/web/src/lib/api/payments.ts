/**
 * #224 — text-to-pay, the web client's half.
 *
 * Two query keys because they have different lifetimes and different owners:
 * the connected ACCOUNT belongs to the workspace and changes on a settings
 * screen; the REQUESTS belong to one conversation and change when a customer
 * pays, which is a webhook we did not initiate. Sharing a key would mean
 * re-reading Stripe every time a thread opened.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaymentRequestState, PayoutReadiness } from "@loonext/shared";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";

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

const keys = {
  account: (companyId: string) => ["payments", "account", companyId] as const,
  requests: (companyId: string, conversationId: string) =>
    ["payments", "requests", companyId, conversationId] as const,
};

/** GET /v1/payments/account — refreshed from Stripe on the server. */
export function usePayoutAccount(enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.account(companyId),
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
      void queryClient.invalidateQueries({ queryKey: keys.account(companyId) });
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
    queryKey: keys.requests(companyId, conversationId),
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
        queryKey: keys.requests(companyId, conversationId),
      });
      // The request went out as an ordinary text, so the thread has a new
      // message the timeline does not know about yet.
      void queryClient.invalidateQueries({
        queryKey: ["messages", companyId, conversationId],
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
        queryKey: keys.requests(companyId, conversationId),
      });
    },
  });
}
