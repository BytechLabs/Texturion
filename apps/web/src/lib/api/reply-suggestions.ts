"use client";

import { useMutation } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import type { ReplySuggestions } from "./types";

/**
 * Plain-language copy for an empty result. "Nothing to suggest here yet" for
 * every case hid real failures behind what looked like a shrug, so each reason
 * says what actually happened and whether trying again will help.
 */
export function suggestionFailureMessage(
  reason: ReplySuggestions["reason"],
): string {
  switch (reason) {
    case "disabled":
      return "Drafting is turned off for this workspace. Settings, AI turns it back on.";
    case "nothing_to_reply":
      return "Nothing to reply to yet. Type a few words and try again.";
    case "over_cap":
      return "This month's drafting is used up. It starts again next month.";
    case "rate_limited":
      return "That was a lot of drafts at once. Try again in a moment.";
    case "model_error":
    case "unavailable":
      return "Couldn't reach Lou just now. Try again.";
    case "unusable_output":
      return "Nothing came back worth sending. Try again, or add a few words first.";
    default:
      return "No drafts this time. Try again.";
  }
}

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
