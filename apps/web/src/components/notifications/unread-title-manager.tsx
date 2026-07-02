"use client";

import { useUnreadTitle } from "@/lib/push/use-unread-title";

/**
 * Render-null carrier for the G9 unread indicators (document-title count +
 * favicon dot). Must live inside CompanyProvider + QueryClientProvider —
 * mounted once in the app shell so it covers every signed-in screen.
 */
export function UnreadTitleManager() {
  useUnreadTitle();
  return null;
}
