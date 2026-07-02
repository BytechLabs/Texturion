/**
 * The thread being read right now: /inbox/[conversationId]. `new` is the
 * compose flow, not a conversation. Pure — used by the realtime provider to
 * decide toast/unread behavior (G9) and unit-tested directly.
 */
export function activeConversationFromPath(pathname: string): string | null {
  const match = /^\/inbox\/([^/]+)$/.exec(pathname);
  if (!match || match[1] === "new") return null;
  return match[1];
}
