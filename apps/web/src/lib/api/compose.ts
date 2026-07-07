import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { threadUpsertMessages, type ThreadData } from "./cache";
import { apiFetch } from "./client";
import { keys } from "./keys";
import type { OutboundMedia } from "./messages";
import type { ComposeResult } from "./types";

/**
 * POST /v1/conversations — outbound-first compose (SPEC §5/§7, G5):
 * exactly one of contact_id | phone_e164; consent is attested implicitly
 * server-side now (the visible checkbox was removed), so no consent flag is
 * sent. quiet_hours_confirmed only after the user confirms the G5 dialog (the
 * API answers 409 `quiet_hours_confirmation_required` when it's needed).
 */
export interface ComposeInput {
  contact_id?: string;
  phone_e164?: string;
  phone_number_id: string;
  body: string;
  quiet_hours_confirmed?: boolean;
  /** #12 outbound MMS — ≤3 jpeg/png/gif items, ≤1 MB each (§7). */
  media?: OutboundMedia[];
}

export function useStartConversation() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ComposeInput) =>
      apiFetch<ComposeResult>("/v1/conversations", {
        method: "POST",
        companyId,
        idempotencyKey: crypto.randomUUID(),
        body: input,
      }),
    onSuccess: ({ conversation, message }) => {
      // Seed the thread so navigating into /inbox/[id] renders instantly.
      queryClient.setQueryData<ThreadData>(
        keys.thread(companyId, conversation.id),
        (thread) =>
          threadUpsertMessages(thread, [
            { ...message, attachments: message.attachments ?? [] },
          ]),
      );
      // The list needs the contact/tags embed the compose response doesn't
      // carry — one targeted refetch of active lists, then realtime keeps up.
      queryClient.invalidateQueries({
        queryKey: keys.conversations.lists(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: keys.conversations.detail(companyId, conversation.id),
        refetchType: "active",
      });
    },
  });
}
