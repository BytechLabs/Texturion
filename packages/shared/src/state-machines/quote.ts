import { capabilityActions, defineMachine } from "./define-machine";

/**
 * A quote (#287). Vocabulary and edges already live in quotes.ts
 * (QUOTE_STATUSES, canTransitionQuote) and this machine restates them; a test
 * asserts they agree. The column is free text on purpose (check length > 0
 * only): the vocabulary lives in shared code. Two writes break the shared
 * table: unsend() in routes/quotes.ts writes sent back to draft after a failed
 * send, and nothing writes declined or expired (expiry is folded in on read by
 * effectiveQuoteStatus).
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type QuoteState = "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired";

export const quoteMachine = defineMachine<QuoteState>({
  id: "quote",
  description: "A quote (#287).",
  authority: "internal",
  db: {
    kind: "none",
    columns: [{ table: "quotes", column: "status" }],
    note: "free text with check (length(status) > 0); the vocabulary is QUOTE_STATUSES in shared code",
  },
  states: ["draft", "sent", "viewed", "accepted", "declined", "expired"],
  initial: ["draft"],
  transitions: {
    draft: ["sent"],
    sent: ["viewed", "accepted", "declined", "expired"],
    viewed: ["accepted", "declined", "expired"],
    accepted: [],
    declined: [],
    expired: [],
  },
  entryEffects: {
    sent: ["send_sms_with_link"],
    viewed: ["stamp_viewed_at"],
    accepted: ["thread_event_quote_accepted", "stamp_decided_at"],
  },
  actions: capabilityActions<QuoteState>({
    draft: [{ action: "edit", capability: "conversations.send" }, { action: "send", capability: "conversations.send" }],
  }),
});
