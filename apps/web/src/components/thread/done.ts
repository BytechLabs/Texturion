import { format } from "date-fns";

import type { ConversationEvent, Message } from "@/lib/api/types";

/**
 * Pure D14 done-state selectors (unit-tested directly): the strikethrough
 * flag, the aria labels for the toggle, the badge tooltip
 * ("Done · Sam · 2:14 PM"), and the APP-LAYOUT-V2 §4.3 auditable timeline
 * sentence for the message_done / message_undone events.
 */

/** §4.3: quote + truncate a message body for the done timeline line. */
const DONE_EXCERPT_MAX = 48;
export function doneEventExcerpt(body: string): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (clean === "") return "a photo";
  if (clean.length <= DONE_EXCERPT_MAX) return `"${clean}"`;
  return `"${clean.slice(0, DONE_EXCERPT_MAX).trimEnd()}…"`;
}

/**
 * §4.2/§4.3: the audited done/undone timeline sentence. The body is joined
 * LIVE from the message the event points at (`payload.message_id`) — never a
 * stored excerpt (D8 PII posture). A cache-miss (the message isn't loaded, or
 * was pruned) degrades to "a message" rather than inventing text.
 *
 *   Sam marked "Can you come Thursday?" done
 *   Sam marked "Can you come Thursday?" not done
 */
export function doneEventSentence(
  event: Pick<ConversationEvent, "type" | "payload">,
  actorName: string,
  messageBody: string | undefined,
): string {
  const excerpt =
    messageBody !== undefined ? doneEventExcerpt(messageBody) : "a message";
  const verb = event.type === "message_undone" ? "not done" : "done";
  return `${actorName} marked ${excerpt} ${verb}`;
}

/** A message is done exactly when done_at is set. */
export function isDone(message: Pick<Message, "done_at">): boolean {
  return message.done_at !== null;
}

/**
 * True for an outbound message that has never actually been sent — a `queued`
 * (still waiting to go out) or `failed` (send rejected) outbound. Marking such a
 * message "done" or promoting it to a task is nonsensical: nothing was ever
 * delivered to the customer, so there is no work to complete or track. Both the
 * per-message Done toggle and "Make a task" are withheld for these (message-
 * actions.tsx). Received inbound, sent/delivered outbound, and notes are all
 * unaffected.
 */
export function isUnsentOutbound(
  message: Pick<Message, "direction" | "status">,
): boolean {
  return (
    message.direction === "outbound" &&
    (message.status === "queued" || message.status === "failed")
  );
}

/** aria-pressed toggle label (D14): "Mark done" / "Mark not done". */
export function doneToggleLabel(done: boolean): string {
  return done ? "Mark not done" : "Mark done";
}

/**
 * The badge tooltip: "Done · {name} · {time}". `memberName` resolves
 * done_by_user_id via the members list; an unresolvable id (deactivated
 * member cache miss, optimistic patch before /me settles) degrades to
 * "Done · {time}" rather than inventing a name.
 */
export function doneBadgeLabel(
  message: Pick<Message, "done_at" | "done_by_user_id">,
  memberName: (userId: string) => string | undefined,
): string {
  if (message.done_at === null) return "";
  const time = format(new Date(message.done_at), "h:mm a");
  const name =
    message.done_by_user_id !== null
      ? memberName(message.done_by_user_id)
      : undefined;
  return name ? `Done · ${name} · ${time}` : `Done · ${time}`;
}
