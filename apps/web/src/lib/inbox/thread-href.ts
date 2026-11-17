const INBOX_LIST_PARAMS = ["status", "assignee", "tag", "unread", "spam", "snoozed", "awaiting", "q"];

/**
 * The ONE builder for "open this thread, here" (#718).
 *
 * Every link that lands inside a conversation (a task's source, a mention or
 * assignment notification, a search hit, the contact timeline, a For you card)
 * goes through here, so the thread reads one set of params and there is one
 * anchored open to test. Without a target it is the plain thread.
 *
 * - `messageId`: open at that message (the API loads the window around it) and
 *   highlight it.
 * - `callSessionId`: the same, for the call's line in the stream (a task
 *   promoted from a call anchors to the call, not to the top).
 * - `taskId`: open that task in the side panel instead of the contact panel.
 */
export interface ThreadTarget {
  messageId?: string | null;
  callSessionId?: string | null;
  taskId?: string | null;
}

interface InboxHrefOptions {
  conversationId?: string;
  target?: ThreadTarget;
  listQuery?: string;
  contactId?: string;
}

export const THREAD_MESSAGE_PARAM = "message";
export const THREAD_CALL_PARAM = "call";
export const THREAD_TASK_PARAM = "task";

export function threadHref(
  conversationId: string,
  target: ThreadTarget = {},
): string {
  return inboxHref({ conversationId, target });
}

export function mergeInboxListParams(currentQuery: string, listQuery: string): URLSearchParams {
  const params = new URLSearchParams(currentQuery);
  const list = new URLSearchParams(listQuery);
  for (const key of INBOX_LIST_PARAMS) {
    const value = list.get(key);
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return params;
}

export function inboxHref({ conversationId, target = {}, listQuery = "", contactId }: InboxHrefOptions = {}): string {
  const params = mergeInboxListParams("", listQuery);
  if (target.messageId) params.set(THREAD_MESSAGE_PARAM, target.messageId);
  else if (target.callSessionId) params.set(THREAD_CALL_PARAM, target.callSessionId);
  if (target.taskId) params.set(THREAD_TASK_PARAM, target.taskId);
  if (contactId) params.set("contact", contactId);
  const pathname = conversationId ? `/inbox/${conversationId}` : "/inbox";
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
