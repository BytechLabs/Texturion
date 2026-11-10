import { capabilityActions, defineMachine } from "./define-machine";

/**
 * conversations.status. Today there is NO transition rule: PATCH
 * /v1/conversations validates the enum only, api_bulk_conversations accepts
 * any target, and inbound mail reopens a closed thread by writing new or open
 * (thread_inbound_message, claim_missed_call_text). The full mesh states that
 * honestly; phase 2 decides which edges are real. Trash and spam are a
 * separate overlay, conversation_visibility.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type ConversationState = "new" | "open" | "waiting" | "closed";

/** conversations.status. */
export const conversationMachine = defineMachine<ConversationState>({
  id: "conversation",
  authority: "internal",
  db: {
    kind: "enum",
    enumType: "conversation_status",
    columns: [{ table: "conversations", column: "status" }],
  },
  states: ["new", "open", "waiting", "closed"],
  initial: ["new", "open"],
  transitions: {
    new: ["open", "waiting", "closed"],
    open: ["new", "waiting", "closed"],
    waiting: ["new", "open", "closed"],
    closed: ["new", "open", "waiting"],
  },
  entryEffects: {
    closed: ["stamp_closed_at"],
  },
  actions: capabilityActions<ConversationState>({
    new: [{ action: "mark_open", capability: "conversations.note" }, { action: "close", capability: "conversations.note" }],
    open: [{ action: "mark_waiting", capability: "conversations.note" }, { action: "close", capability: "conversations.note" }],
    waiting: [{ action: "mark_open", capability: "conversations.note" }, { action: "close", capability: "conversations.note" }],
    closed: [{ action: "reopen", capability: "conversations.note" }],
  }),
});
