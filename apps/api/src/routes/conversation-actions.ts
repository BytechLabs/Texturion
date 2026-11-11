import type { MemberRole } from "@loonext/shared";
import { stateMachines } from "@loonext/shared";

import { ApiError } from "../http/errors";

/** Where a conversation stands: its status, and whether it is spam. */
export interface ConversationFacts {
  status: string;
  is_spam: boolean;
}

/**
 * #722: the visibility state of a conversation these routes serve. A trashed
 * conversation is never served (it 404s), so only live and spam occur.
 */
export function conversationVisibilityState(
  row: Pick<ConversationFacts, "is_spam">,
): stateMachines.ConversationVisibilityState {
  return row.is_spam ? "spam" : "live";
}

/**
 * What `role` may do to this conversation now: its status moves, then its
 * visibility actions (spam, trash). One field, one list, for list rows and the
 * detail.
 */
export function conversationAllowedActions(
  row: ConversationFacts,
  role: MemberRole,
): readonly string[] {
  return [
    ...stateMachines.allowedActions(
      stateMachines.conversationMachine,
      row.status as stateMachines.ConversationState,
      role,
    ),
    ...stateMachines.allowedActions(
      stateMachines.conversationVisibilityMachine,
      conversationVisibilityState(row),
      role,
    ),
  ];
}

/** The action a move to `to` is, from the conversation machine's vocabulary. */
export function statusMoveAction(
  from: string,
  to: stateMachines.ConversationState,
): string {
  switch (to) {
    case "open":
      return from === "closed" ? "reopen" : "mark_open";
    case "waiting":
      return "mark_waiting";
    case "closed":
      return "close";
    case "new":
      return "mark_new";
  }
}

/**
 * Refuses a PATCH whose status move or spam flip is not in the member's
 * allowed list. A request that changes nothing is not an action.
 */
export function assertConversationPatchAllowed(
  row: ConversationFacts,
  role: MemberRole,
  body: { status?: stateMachines.ConversationState; is_spam?: boolean },
): void {
  const allowed = conversationAllowedActions(row, role);
  if (body.status !== undefined && body.status !== row.status) {
    const action = statusMoveAction(row.status, body.status);
    if (!allowed.includes(action)) {
      throw new ApiError(
        "conflict",
        `A ${row.status} conversation cannot be moved to ${body.status}.`,
      );
    }
  }
  if (body.is_spam !== undefined && body.is_spam !== row.is_spam) {
    const action = body.is_spam ? "mark_spam" : "unmark_spam";
    if (!allowed.includes(action)) {
      throw new ApiError(
        "conflict",
        row.is_spam
          ? "This conversation is already marked as spam."
          : "This conversation is not marked as spam.",
      );
    }
  }
}
