export interface PendingNotification {
  category: string;
  conversation_id: string | null;
}

export function pendingNotificationCounts(rows: readonly PendingNotification[]) {
  const counts = new Map<string, number>();
  const conversations = new Set<string>();
  for (const row of rows) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    if ((row.category === "messages_mine" || row.category === "messages_all") && row.conversation_id) {
      conversations.add(row.conversation_id);
    }
  }
  return { counts, conversationCount: conversations.size };
}
