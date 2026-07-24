"use client";

import { useMutation } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import type { ReplySuggestions } from "./types";

/**
 * Ask for drafted replies to this thread.
 *
 * A MUTATION, not a query: each call is a metered AI request the person asked
 * for by pressing a button, so it must never be refetched on focus, retried in
 * the background, or served from a cache the way a query would be. The drafts
 * live in component state until one is chosen or the composer moves on.
 *
 * `draft` is whatever is already typed — with it, the server returns finished
 * versions of that sentence instead of three replies of its own.
 */
export function useReplySuggestions(conversationId: string) {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (draft: string) =>
      apiFetch<ReplySuggestions>(
        `/v1/conversations/${conversationId}/reply-suggestions`,
        {
          method: "POST",
          companyId,
          body: draft.trim() === "" ? {} : { draft },
        },
      ),
  });
}
