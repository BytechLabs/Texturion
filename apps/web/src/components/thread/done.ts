import { format } from "date-fns";

import type { Message } from "@/lib/api/types";

/**
 * Pure D14 done-state selectors (unit-tested directly): the strikethrough
 * flag, the aria labels for the toggle, and the badge tooltip
 * ("Done · Sam · 2:14 PM").
 */

/** A message is done exactly when done_at is set. */
export function isDone(message: Pick<Message, "done_at">): boolean {
  return message.done_at !== null;
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
