"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ScheduledMessageStatus } from "@loonext/shared";

import { undoableToast } from "@/components/ui/optimistic-undo";
import { useT } from "@/i18n/provider";

import { apiFetch } from "./client";
import type { ApiError } from "./error";
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
   * #722: what this member may do to it in its state (`edit`, `cancel`), from
   * the shared machine. Absent from an older server, which allowed both.
   */
  allowed_actions?: readonly string[];
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

export interface QuietHoursConfirmation {
  sendAt: string;
  localHour: number | null;
}

export function scheduledQuietHour(error: ApiError): number | null {
  const rawHour = error.messageVars?.hour;
  if (rawHour === undefined || !/^\d{1,2}$/.test(rawHour)) return null;
  const hour = Number(rawHour);
  return hour <= 23 ? hour : null;
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
  const digits = e164.replaceAll(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return e164;
}

export const scheduledKeys = {
  all: (companyId: string) => [companyId, "scheduled-messages"] as const,
  lists: (companyId: string) => [...scheduledKeys.all(companyId), "list"] as const,
  list: (companyId: string, lineId?: string) =>
    [...scheduledKeys.lists(companyId), ...(lineId ? [lineId] : [])] as const,
  thread: (companyId: string, conversationId: string) =>
    [...scheduledKeys.all(companyId), "thread", conversationId] as const,
};

/**
 * What is queued, for one thread or for the whole workspace.
 *
 * Live rows only. The finished ones are history, and a composer that had to
 * scroll past last month's sent messages to show what is coming would be
 * showing the wrong thing.
 */
export function useScheduledMessages(conversationId?: string, lineId?: string) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: conversationId
      ? scheduledKeys.thread(companyId, conversationId)
      : scheduledKeys.list(companyId, lineId),
    queryFn: () =>
      apiFetch<{ scheduled_messages: ScheduledMessage[] }>(
        conversationId
          ? `/v1/scheduled-messages?conversation_id=${conversationId}`
          : "/v1/scheduled-messages",
        { companyId, searchParams: { phone_number_id: lineId } },
      ),
    select: (data) => data.scheduled_messages,
  });
}

export interface ScheduleInput {
  conversationId: string;
  body: string;
  idempotencyKey?: string;
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
          idempotencyKey: input.idempotencyKey,
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
    onSuccess: () => {
      // The workspace key prefixes every thread's, so this one call covers both.
      void queryClient.invalidateQueries({
        queryKey: scheduledKeys.all(companyId),
      });
    },
  });
}

export function useUpdateScheduledMessage() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      body?: string;
      send_at?: string;
      quiet_hours_confirmed?: boolean;
    }) => apiFetch<{ scheduled_message: ScheduledMessage }>(`/v1/scheduled-messages/${id}`, {
      method: "PATCH",
      companyId,
      body,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduledKeys.all(companyId) });
    },
  });
}

export function useCancelScheduledMessage() {
  const t = useT();
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: scheduledKeys.all(companyId) });
  const restore = useMutation({
    mutationFn: ({ id, canceled_at }: { id: string; canceled_at: string }) =>
      apiFetch(`/v1/scheduled-messages/${id}/restore`, {
        method: "POST",
        companyId,
        body: { canceled_at },
      }),
    onSuccess: () => { void refresh(); },
    onError: () => { toast.error(t("thread.scheduledRestoreFailed")); },
  });
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ canceled_at: string } | undefined>(`/v1/scheduled-messages/${id}`, {
        method: "DELETE",
        companyId,
        searchParams: { undo_receipt: 1 },
      }),
    onSuccess: (receipt, id) => {
      void refresh();
      const message = t("thread.scheduledCancelled");
      if (!receipt) {
        toast.success(message);
        return;
      }
      undoableToast({
        message,
        undoLabel: t("thread.undo"),
        onUndo: () => restore.mutate({ id, canceled_at: receipt.canceled_at }),
      });
    },
  });
}

/** #722: whether the server lets this member take `action` on the text now. */
export function scheduledActionAllowed(row: ScheduledMessage, action: "edit" | "cancel"): boolean {
  return row.allowed_actions?.includes(action) ?? true;
}
