import type { QueryClient } from "@tanstack/react-query";

import { threadUpsertMessages, type ThreadData } from "@/lib/api/cache";
import { keys } from "@/lib/api/keys";
import type { Message } from "@/lib/api/types";

/**
 * #215 realtime cache application — the imperative QueryClient wiring the pure
 * reducers in `@/lib/api/cache` are applied through. Kept out of the provider
 * closure so the open-thread live-append (the #215 invariant) is unit-testable
 * against a real QueryClient without a DOM/render harness.
 */

/**
 * Append live messages into an OPEN thread's cache — INDEPENDENT of the
 * conversation's spam state. A live message must appear in the thread the user
 * is looking at whether or not it's a spam thread (only the inbox LIST stays
 * spam-gated, SPEC §6.3). No-op + returns false when the thread was never opened
 * (nothing cached to patch); returns true when the open thread was patched.
 */
export function applyLiveThreadAppend(
  queryClient: QueryClient,
  companyId: string,
  conversationId: string,
  messages: Message[],
): boolean {
  const threadKey = keys.thread(companyId, conversationId);
  if (!queryClient.getQueryData<ThreadData>(threadKey)) return false;
  queryClient.setQueryData<ThreadData>(threadKey, (thread) =>
    threadUpsertMessages(thread, messages),
  );
  return true;
}
