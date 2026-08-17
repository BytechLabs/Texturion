import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { QuoteStatus } from "@loonext/shared";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";

/**
 * #287 — quotes, from the crew's side.
 *
 * `effective_status` is the field to render. The server sends both it and the
 * stored `status`, and the difference is not cosmetic: nothing writes
 * `expired`, so a quote that lapsed an hour ago still says `sent` in the
 * database. Rendering the stored one would show a live offer on a price the
 * business has already withdrawn.
 */

export interface Quote {
  id: string;
  conversation_id: string;
  contact_id: string;
  amount_cents: number;
  currency: string;
  description: string;
  /** What a person DID. Compared against when a transition is checked. */
  status: QuoteStatus;
  /** What to SHOW. Folds in an expiry that nothing wrote. */
  effective_status: QuoteStatus;
  expires_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  decided_at: string | null;
  created_at: string;
}

/** What `POST /quotes/:id/send` returns: the quote, plus two one-time tokens. */
export interface SentQuote extends Quote {
  /**
   * The plaintext tokens, returned ONCE. Whoever composes the text puts them
   * in the URL; nothing can produce them again, because only their SHA-256 is
   * stored. Two of them, and separate on purpose — the link a customer opens
   * views the quote and cannot accept it.
   */
  view_token: string;
  accept_token: string;
}

export function useQuotes(conversationId: string, enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.quotes.forConversation(companyId, conversationId),
    queryFn: () =>
      apiFetch<{ data: Quote[] }>(
        `/v1/quotes?conversation_id=${encodeURIComponent(conversationId)}`,
        { companyId },
      ),
    enabled: enabled && conversationId.length > 0,
  });
}

/**
 * The queue an owner opens every morning: asked for, not yet answered.
 *
 * Filtered SERVER-side, and that is load-bearing rather than tidy. "Still
 * outstanding" includes an expiry derived at read time, so a client filtering
 * a full list would have to re-implement that rule — and the list is capped at
 * 500 rows, so it would also start silently dropping quotes on the first busy
 * workspace.
 */
export function useOutstandingQuotes(enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.quotes.outstanding(companyId),
    queryFn: () =>
      apiFetch<{ data: Quote[] }>("/v1/quotes?status=outstanding", { companyId }),
    enabled,
  });
}

export function useCreateQuote(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      amountCents: number;
      description: string;
      expiresAt: string;
    }) =>
      apiFetch<Quote>("/v1/quotes", {
        method: "POST",
        companyId,
        body: {
          conversation_id: conversationId,
          // No contact either: the conversation knows whose number it is, and
          // the server reads it. See the note on the route's schema.
          amount_cents: args.amountCents,
          // No currency: the server resolves it from the workspace. See the
          // note on the route's schema — asking a crew which currency they
          // bill in, at the moment they are naming a price, invites a quote
          // the business cannot take payment for.
          description: args.description,
          expires_at: args.expiresAt,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: keys.quotes.forConversation(companyId, conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: keys.quotes.outstanding(companyId),
      });
    },
  });
}

export function useSendQuote(conversationId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (quoteId: string) =>
      apiFetch<SentQuote>(`/v1/quotes/${quoteId}/send`, {
        method: "POST",
        companyId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: keys.quotes.forConversation(companyId, conversationId),
      });
      // Sending moves a draft into the outstanding queue, which is a different
      // list on a different screen.
      void queryClient.invalidateQueries({
        queryKey: keys.quotes.outstanding(companyId),
      });
    },
  });
}
