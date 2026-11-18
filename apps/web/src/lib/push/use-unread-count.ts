"use client";

import { useNotificationsUnreadCount } from "@/lib/api/notifications";

export function useUnreadConversationCount(): number {
  return useNotificationsUnreadCount().data?.unread_conversations ?? 0;
}
