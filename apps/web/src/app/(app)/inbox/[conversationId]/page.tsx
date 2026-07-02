import { ThreadView } from "@/components/thread/thread-view";

/**
 * /inbox/[conversationId] — the G5 thread. Mobile: full-screen push with a
 * back header (the inbox layout hides the list pane); desktop: the thread
 * pane beside the list.
 */
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <ThreadView conversationId={conversationId} />;
}
