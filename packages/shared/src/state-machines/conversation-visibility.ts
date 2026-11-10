import { capabilityActions, defineMachine } from "./define-machine";

/**
 * Whether a conversation is shown, derived from is_spam and deleted_at.
 * Marking spam closes the thread (spam-flag.ts); trashing cancels its
 * scheduled texts and hides its tasks (api_trash_conversations) and remembers
 * the status in deleted_prior_status so restore puts it back. Per-member mute
 * lives in conversation_member_prefs and is a preference, not a lifecycle.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type ConversationVisibilityState = "live" | "spam" | "trashed";

export const conversationVisibilityMachine = defineMachine<ConversationVisibilityState>({
  id: "conversation_visibility",
  description: "Whether a conversation is shown, derived from is_spam and deleted_at.",
  authority: "derived",
  db: {
    kind: "none",
    columns: [{ table: "conversations", column: "is_spam" }, { table: "conversations", column: "deleted_at" }],
    note: "derived from is_spam and deleted_at; neither is a vocabulary column",
  },
  states: ["live", "spam", "trashed"],
  initial: ["live"],
  transitions: {
    live: ["spam", "trashed"],
    spam: ["live", "trashed"],
    trashed: ["live"],
  },
  entryEffects: {
    spam: ["close_conversation"],
    trashed: ["cancel_scheduled_messages", "hide_tasks", "stamp_deleted_prior_status"],
  },
  actions: capabilityActions<ConversationVisibilityState>({
    live: [{ action: "mark_spam", capability: "conversations.note" }, { action: "trash", capability: "records.delete" }],
    spam: [{ action: "unmark_spam", capability: "conversations.note" }, { action: "trash", capability: "records.delete" }],
    trashed: [{ action: "restore", capability: "records.delete" }],
  }),
});
