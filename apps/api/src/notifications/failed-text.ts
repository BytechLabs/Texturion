import type { SupabaseClient } from "@supabase/supabase-js";

import { listConversationViewers } from "../auth/conversation-audience";
import type { Env } from "../env";
import type { MessageRow } from "../messaging/types";
import { loadConversationPrefs, withoutMuted } from "./conversation-prefs";
import { deliverPush } from "./deliver";

const COPY = {
  en: {
    title: "Text not delivered",
    body: "Open the conversation to see what happened.",
  },
  "fr-CA": {
    title: "Texto non livré",
    body: "Ouvrez la conversation pour voir ce qui s’est passé.",
  },
};

type FailedText = Pick<MessageRow, "id" | "company_id" | "sent_by_user_id" | "automated"> & {
  conversation_id: string | null;
};

export async function notifyFailedText(
  env: Env,
  db: SupabaseClient,
  message: FailedText,
): Promise<void> {
  const conversationId = message.conversation_id;
  const companyId = message.company_id;
  if (message.automated !== false || !message.sent_by_user_id || !conversationId) return;

  try {
    const [scheduled, conversation, prefs] = await Promise.all([
      db.from("scheduled_messages")
        .select("created_by")
        .eq("company_id", companyId)
        .eq("conversation_id", conversationId)
        .eq("sent_message_id", message.id)
        .limit(1)
        .maybeSingle(),
      db.from("conversations")
        .select("phone_number_id")
        .eq("company_id", companyId)
        .eq("id", conversationId)
        .maybeSingle(),
      loadConversationPrefs(db, companyId, conversationId),
    ]);
    if (scheduled.error) throw new Error(scheduled.error.message);
    if (conversation.error) throw new Error(conversation.error.message);
    if (!conversation.data) return;

    const recipient = scheduled.data?.created_by ?? message.sent_by_user_id;
    const audience = withoutMuted([recipient], prefs);
    if (audience.length === 0) return;
    const viewers = await listConversationViewers(db, {
      companyId,
      phoneNumberId: conversation.data.phone_number_id,
    });
    if (!viewers.some((viewer) => viewer.user_id === recipient)) return;

    const failures: unknown[] = [];
    await deliverPush(env, db, {
      category: scheduled.data ? "scheduled_texts" : "send_failures",
      companyId,
      userIds: audience,
      collapseKey: `send-failed:${conversationId}`,
      content: { written: "us" },
      web: (locale) => ({
        ...COPY[locale],
        url: `${env.APP_ORIGIN}/inbox/${conversationId}`,
      }),
      failures,
    });
    if (failures.length > 0) {
      console.warn(`Failed text ${message.id}: ${failures.length} push delivery failures`);
    }
  } catch (error) {
    console.warn(`Failed text ${message.id}: notification failed`, error);
  }
}
