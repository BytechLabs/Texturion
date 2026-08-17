"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ScheduledMessageStatus } from "@loonext/shared";

import { useT } from "@/i18n/provider";

import { apiFetch } from "./client";
import { useCompanyId } from "@/lib/company/provider";

/**
 * #233 — the texts that have not gone yet.
 *
 * A scheduled message is deliberately NOT a `messages` row (see the migration
 * header), so it has its own cache key and never touches the thread cache. That
 * separation is the point: nothing that reads messages can accidentally show an
 * unsent one as sent.
 */
export interface ScheduledMessage {
  id: string;
  conversation_id: string;
  body: string;
  send_at: string;
  clock_timezone: string;
  clock_source: "contact" | "area_code" | "company";
  status: ScheduledMessageStatus;
  /** Why it is not going, in words. Null while it is simply waiting. */
  held_reason: string | null;
  /**
   * #228: the same reason as a catalogue key, so it can be read in the
   * reader's language. Null on rows written before 2026-08-17 — render it
   * through `scheduledHoldText`, which falls back to `held_reason`.
   */
  held_reason_key: string | null;
  held_at: string | null;
  expires_at: string;
  sent_message_id: string | null;
  created_by: string;
  created_at: string;
  /**
   * Who it is going to, embedded by the list route.
   *
   * The thread strip does not need this — the customer's name is already in
   * the header above it — but the workspace view is a list of texts to
   * DIFFERENT people, and a list of bodies with no names is the surprise #233
   * asks us to prevent rather than the answer to it.
   */
  conversations?: {
    contacts: { name: string | null; phone_e164: string } | null;
  } | null;
}

/** The customer's name, their number, or an honest fallback. */
export function scheduledRecipient(row: ScheduledMessage): string {
  const contact = row.conversations?.contacts;
  if (!contact) return "This conversation";
  const name = contact.name?.trim();
  return name && name !== "" ? name : formatE164(contact.phone_e164);
}

/** "(416) 555-0134" for NANP, otherwise the number as stored. */
function formatE164(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return e164;
}

export const scheduledKeys = {
  /** Everything queued in the workspace. */
  all: (companyId: string) => ["scheduled-messages", companyId] as const,
  /** ...and one thread's slice of it. */
  thread: (companyId: string, conversationId: string) =>
    ["scheduled-messages", companyId, conversationId] as const,
};

/**
 * What is queued, for one thread or for the whole workspace.
 *
 * Live rows only. The finished ones are history, and a composer that had to
 * scroll past last month's sent messages to show what is coming would be
 * showing the wrong thing.
 */
export function useScheduledMessages(conversationId?: string) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: conversationId
      ? scheduledKeys.thread(companyId, conversationId)
      : scheduledKeys.all(companyId),
    queryFn: () =>
      apiFetch<{ scheduled_messages: ScheduledMessage[] }>(
        conversationId
          ? `/v1/scheduled-messages?conversation_id=${conversationId}`
          : "/v1/scheduled-messages",
        { companyId },
      ),
    select: (data) => data.scheduled_messages,
  });
}

export interface ScheduleInput {
  conversationId: string;
  body: string;
  /** The instant, absolute. The picker resolves the wall clock. */
  sendAt: string;
  /**
   * Set once the person has seen the quiet-hours warning and chosen to go
   * ahead. Mirrors compose's flag — #225 ask 2 is warned, never blocked.
   */
  quietHoursConfirmed?: boolean;
}

export function useScheduleMessage() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduleInput) =>
      apiFetch<{ scheduled_message: ScheduledMessage }>(
        "/v1/scheduled-messages",
        {
          method: "POST",
          companyId,
          body: {
            conversation_id: input.conversationId,
            body: input.body,
            send_at: input.sendAt,
            ...(input.quietHoursConfirmed
              ? { quiet_hours_confirmed: true }
              : {}),
          },
        },
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: scheduledKeys.all(companyId),
      });
      void queryClient.invalidateQueries({
        queryKey: scheduledKeys.thread(
          companyId,
          result.scheduled_message.conversation_id,
        ),
      });
    },
  });
}

export function useCancelScheduledMessage(conversationId?: string) {
  const t = useT();
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/v1/scheduled-messages/${id}`, {
        method: "DELETE",
        companyId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: scheduledKeys.all(companyId),
      });
      if (conversationId) {
        void queryClient.invalidateQueries({
          queryKey: scheduledKeys.thread(companyId, conversationId),
        });
      }
      // Plain confirmation, not a dialog. Cancelling something that has not
      // gone is reversible in the only sense that matters — you can schedule it
      // again — so friction here would be friction for its own sake.
      toast.success(t("thread.scheduledCancelled"));
    },
  });
}
