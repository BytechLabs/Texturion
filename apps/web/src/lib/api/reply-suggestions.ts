"use client";

import { useMutation } from "@tanstack/react-query";
import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import type { ReplySuggestions } from "./types";

/**
 * Plain-language copy for an empty result. "Nothing to suggest here yet" for
 * every case hid real failures behind what looked like a shrug, so each reason
 * says what actually happened and whether trying again will help.
 *
 * #228: the sentences live in `i18n/sections/thread.ts`, and `t` comes from the
 * composer that shows them. The default is English, which is what every reader
 * saw before the catalogue existed.
 */
export function suggestionFailureMessage(
  reason: ReplySuggestions["reason"],
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): string {
  switch (reason) {
    case "disabled":
      return t("thread.draftsDisabled");
    case "spam":
      return t("thread.draftsSpam");
    case "nothing_to_reply":
      return t("thread.draftsNothingToReply");
    case "subscription_inactive":
      // Billing, not breakage — so it must not say "try again", which is not
      // what fixes it. The same KEY every feature Lou refuses for this reason
      // reads, so the wording cannot drift between them (#581).
      return t("thread.louPausedForBilling");
    case "over_cap":
      return t("thread.draftsOverCap");
    case "rate_limited":
      return t("thread.draftsRateLimited");
    case "model_error":
    case "unavailable":
      return t("thread.louUnreachable");
    case "unusable_output":
      return t("thread.draftsUnusable");
    default:
      return t("thread.draftsNone");
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
