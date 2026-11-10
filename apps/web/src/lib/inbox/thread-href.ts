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

export const THREAD_MESSAGE_PARAM = "message";
export const THREAD_CALL_PARAM = "call";
export const THREAD_TASK_PARAM = "task";

export function threadHref(
  conversationId: string,
  target: ThreadTarget = {},
): string {
  const params = new URLSearchParams();
  if (target.messageId) params.set(THREAD_MESSAGE_PARAM, target.messageId);
  else if (target.callSessionId) params.set(THREAD_CALL_PARAM, target.callSessionId);
  if (target.taskId) params.set(THREAD_TASK_PARAM, target.taskId);
  const query = params.toString();
  return query ? `/inbox/${conversationId}?${query}` : `/inbox/${conversationId}`;
}
