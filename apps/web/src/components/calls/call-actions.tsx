"use client";

import {
  Copy,
  Info,
  ListPlus,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Trash2,
  User,
  UserPlus,
  Voicemail,
} from "lucide-react";
import { toast } from "sonner";

import { usePlaceCall } from "@/components/calls/call-button";
import { RecordOverflowMenu } from "@/components/ui/record-menu";
import { useT, type Translate } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useDeleteCall, useDeleteVoicemail } from "@/lib/api/trash";
import {
  useCanDeleteRecords,
  useDeletedToast,
} from "@/lib/hooks/use-records-delete";
import type { RecordAction } from "@/lib/record-actions/types";
import { useNavigate } from "@/lib/use-navigate";
import { cn } from "@/lib/utils";

/**
 * #712 — the call's ONE action list. The row's ⋯ and the row's right-click /
 * long-press menu both render it.
 *
 * Call back and Text need somewhere to reach the caller: a thread for Text, a
 * thread or a contact for Call back, a number to copy. A call from a withheld
 * number offers none of them, and a member without `records.delete` is left
 * with only what they can do, or no menu at all.
 */
/**
 * #734: the ONE action a call row draws inline. A missed inbound call or a
 * voicemail wants a call back; an answered or outbound one wants a message.
 * Every other action lives in the row's menu. When the preferred action cannot
 * be done (no thread or contact to ring), the other one stands in, and a
 * caller we cannot reach at all gets none.
 */
export type CallPrimaryAction = "call-back" | "message";

/** Where Message goes: the thread, a new text to the contact, or to the number. */
export function callMessageHref(call: {
  conversation_id: string | null;
  contact_id: string | null;
  caller_e164: string | null;
}): string | null {
  if (call.conversation_id) return `/inbox/${call.conversation_id}`;
  if (call.contact_id) return `/inbox/new?contact=${call.contact_id}`;
  if (call.caller_e164) return `/inbox/new?to=${encodeURIComponent(call.caller_e164)}`;
  return null;
}

export function callPrimaryAction(call: {
  direction: string;
  outcome: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  caller_e164: string | null;
}): CallPrimaryAction | null {
  const canCallBack = call.conversation_id !== null || call.contact_id !== null;
  const canMessage = callMessageHref(call) !== null;
  const wantsCallBack =
    call.direction !== "outbound" &&
    (call.outcome === "missed" || call.outcome === "voicemail");
  if (wantsCallBack) return canCallBack ? "call-back" : canMessage ? "message" : null;
  return canMessage ? "message" : canCallBack ? "call-back" : null;
}

export interface CallActionsInput {
  t: Translate;
  /** The call's own page; absent on that page itself, so Details is not offered. */
  detailsHref?: string | null;
  messageHref?: string | null;
  contactHref?: string | null;
  canMakeTask?: boolean;
  callerName: string;
  hasVoicemail: boolean;
  conversationId: string | null;
  contactId: string | null;
  callerE164: string | null;
  canDelete: boolean;
  calling: boolean;
  deletingCall: boolean;
  deletingVoicemail: boolean;
  run: {
    callBack: () => void;
    text: () => void;
    copyNumber: () => void;
    openContact?: () => void;
    addContact?: () => void;
    makeTask?: () => void;
    openDetails?: () => void;
    deleteVoicemail: () => void;
    deleteCall: () => void;
  };
}

export function buildCallActions(input: CallActionsInput): RecordAction[] {
  const { t, run } = input;
  return [
    {
      id: "call-back",
      label: t("recordMenu.callBack"),
      icon: Phone,
      group: "primary",
      allowed: input.conversationId !== null || input.contactId !== null,
      disabled: input.calling,
      onSelect: run.callBack,
    },
    {
      id: "text",
      label: t("recordMenu.text"),
      icon: MessageSquareText,
      group: "primary",
      allowed: (input.messageHref ?? null) !== null,
      onSelect: run.text,
    },
    {
      id: "copy-number",
      label: t("recordMenu.copyNumber"),
      icon: Copy,
      group: "primary",
      allowed: input.callerE164 !== null,
      onSelect: run.copyNumber,
    },
    {
      id: "contact",
      label: t("shell.callActionContact"),
      icon: User,
      group: "primary",
      allowed: (input.contactHref ?? null) !== null,
      onSelect: run.openContact,
    },
    {
      id: "add-contact",
      label: t("shell.callActionAddContact"),
      icon: UserPlus,
      group: "primary",
      allowed:
        input.contactId === null &&
        input.callerE164 !== null &&
        run.addContact !== undefined,
      onSelect: run.addContact,
    },
    {
      id: "task",
      label: t("shell.callActionTask"),
      icon: ListPlus,
      group: "primary",
      allowed: input.canMakeTask === true && run.makeTask !== undefined,
      onSelect: run.makeTask,
    },
    {
      id: "details",
      label: t("shell.callActionDetails"),
      icon: Info,
      group: "primary",
      allowed: (input.detailsHref ?? null) !== null,
      onSelect: run.openDetails,
    },
    {
      id: "delete-voicemail",
      label: t("trash.deleteVoicemail"),
      icon: Voicemail,
      group: "danger",
      allowed: input.canDelete && input.hasVoicemail,
      destructive: true,
      disabled: input.deletingVoicemail,
      onSelect: run.deleteVoicemail,
    },
    {
      id: "delete-call",
      label: t("trash.deleteCall"),
      icon: Trash2,
      group: "danger",
      allowed: input.canDelete,
      destructive: true,
      disabled: input.deletingCall,
      onSelect: run.deleteCall,
    },
  ];
}

export interface CallActionsProps {
  /** The call-log row's `id`, not its `call_session_id`. */
  callId: string;
  callerName: string;
  hasVoicemail: boolean;
  /** Where Text and Call back go. Absent for a caller we cannot reach. */
  conversationId?: string | null;
  contactId?: string | null;
  callerE164?: string | null;
  /** #734: the call row wires these; the call's own page leaves them out. */
  callSessionId?: string | null;
  /** D64: only an answered call in a conversation can become a task. */
  canMakeTask?: boolean;
  onMakeTask?: () => void;
  onAddContact?: () => void;
  /** After a whole-call delete, e.g. leaving the call's own page. */
  onDeleted?: () => void;
  className?: string;
}

/**
 * #691 — delete a call, or just its voicemail, from the call log; #712 adds the
 * ways to reach the caller. Both deletes are moves to the Trash, so both answer
 * with an undo toast rather than a confirmation. Deleting the voicemail alone
 * leaves the call in the log, which is the point of offering it separately: a
 * spam recording does not need its missed-call line erased with it.
 */
export function useCallActions({
  callId,
  callerName,
  hasVoicemail,
  conversationId = null,
  contactId = null,
  callerE164 = null,
  callSessionId = null,
  canMakeTask = false,
  onMakeTask,
  onAddContact,
  onDeleted,
}: CallActionsProps): RecordAction[] {
  const t = useT();
  const navigate = useNavigate();
  const canDelete = useCanDeleteRecords();
  const deleteCall = useDeleteCall();
  const deleteVoicemail = useDeleteVoicemail();
  const announceDeleted = useDeletedToast();
  const { place, busy } = usePlaceCall();
  const failure = (error: unknown, fallback: string) =>
    toast.error(error instanceof ApiError ? error.message : fallback);

  const messageHref = callMessageHref({
    conversation_id: conversationId,
    contact_id: contactId,
    caller_e164: callerE164,
  });
  const detailsHref = callSessionId ? `/calls/${callSessionId}` : null;
  const contactHref = contactId ? `/contacts/${contactId}` : null;

  return buildCallActions({
    t,
    detailsHref,
    messageHref,
    contactHref,
    canMakeTask,
    callerName,
    hasVoicemail,
    conversationId,
    contactId,
    callerE164,
    canDelete,
    calling: busy,
    deletingCall: deleteCall.isPending,
    deletingVoicemail: deleteVoicemail.isPending,
    run: {
      callBack: () =>
        place({
          conversationId: conversationId ?? undefined,
          contactId: conversationId ? undefined : (contactId ?? undefined),
          contactName: callerName,
        }),
      text: () => messageHref && navigate(messageHref),
      openContact: () => contactHref && navigate(contactHref),
      addContact: onAddContact,
      makeTask: onMakeTask,
      openDetails: () => detailsHref && navigate(detailsHref),
      copyNumber: async () => {
        try {
          await navigator.clipboard.writeText(callerE164 ?? "");
          toast.success(t("thread.numberCopied"));
        } catch {
          toast.error(t("thread.copyFailed"));
        }
      },
      deleteVoicemail: () =>
        deleteVoicemail.mutate(callId, {
          onSuccess: () =>
            announceDeleted(t("trash.voicemailDeleted"), [
              { kind: "voicemail", id: callId },
            ]),
          onError: (error) => failure(error, t("trash.voicemailDeleteFailed")),
        }),
      deleteCall: () =>
        deleteCall.mutate(callId, {
          onSuccess: () => {
            announceDeleted(t("trash.callDeleted"), [
              { kind: "call", id: callId },
            ]);
            onDeleted?.();
          },
          onError: (error) => failure(error, t("trash.callDeleteFailed")),
        }),
    },
  });
}

/** The ⋯ button for a call's action list; absent when nothing is allowed. */
export function CallActionsMenu({
  actions,
  callerName,
  className,
}: {
  actions: readonly RecordAction[];
  callerName: string;
  className?: string;
}) {
  const t = useT();
  return (
    <RecordOverflowMenu
      actions={actions}
      label={t("trash.callActionsAria", { name: callerName })}
      trigger={
        <button
          type="button"
          aria-label={t("trash.callActionsAria", { name: callerName })}
          className={cn(
            "tap-target relative z-[1] grid size-8 shrink-0 place-items-center rounded-full text-app-muted-2 transition-colors duration-150",
            "hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <MoreHorizontal aria-hidden className="size-4" strokeWidth={1.75} />
        </button>
      }
    />
  );
}

export function CallActions(props: CallActionsProps) {
  const actions = useCallActions(props);
  return (
    <CallActionsMenu
      actions={actions}
      callerName={props.callerName}
      className={props.className}
    />
  );
}
