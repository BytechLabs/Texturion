"use client";

import { MoreHorizontal, Trash2, Voicemail } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useDeleteCall, useDeleteVoicemail } from "@/lib/api/trash";
import {
  useCanDeleteRecords,
  useDeletedToast,
} from "@/lib/hooks/use-records-delete";
import { cn } from "@/lib/utils";

/**
 * #691 — delete a call, or just its voicemail, from the call log.
 *
 * Both are moves to the Trash, so both answer with an undo toast rather than a
 * confirmation. Deleting the voicemail alone leaves the call in the log, which
 * is the point of offering it separately: a spam recording does not need its
 * missed-call line erased with it. Renders nothing for a member without
 * `records.delete`, so the overflow never appears as a menu of nothing.
 */
export function CallActions(props: CallActionsProps) {
  const canDelete = useCanDeleteRecords();
  return canDelete ? <CallActionsMenu {...props} /> : null;
}

interface CallActionsProps {
  /** The call-log row's `id`, not its `call_session_id`. */
  callId: string;
  callerName: string;
  hasVoicemail: boolean;
  /** After a whole-call delete, e.g. leaving the call's own page. */
  onDeleted?: () => void;
  className?: string;
}

function CallActionsMenu({
  callId,
  callerName,
  hasVoicemail,
  onDeleted,
  className,
}: CallActionsProps) {
  const t = useT();
  const deleteCall = useDeleteCall();
  const deleteVoicemail = useDeleteVoicemail();
  const announceDeleted = useDeletedToast();
  const failure = (error: unknown, fallback: string) =>
    toast.error(error instanceof ApiError ? error.message : fallback);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {hasVoicemail && (
          <DropdownMenuItem
            variant="destructive"
            disabled={deleteVoicemail.isPending}
            onSelect={() =>
              deleteVoicemail.mutate(callId, {
                onSuccess: () =>
                  announceDeleted(t("trash.voicemailDeleted"), [
                    { kind: "voicemail", id: callId },
                  ]),
                onError: (error) =>
                  failure(error, t("trash.voicemailDeleteFailed")),
              })
            }
          >
            <Voicemail className="size-4" strokeWidth={1.75} aria-hidden />
            {t("trash.deleteVoicemail")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          disabled={deleteCall.isPending}
          onSelect={() =>
            deleteCall.mutate(callId, {
              onSuccess: () => {
                announceDeleted(t("trash.callDeleted"), [
                  { kind: "call", id: callId },
                ]);
                onDeleted?.();
              },
              onError: (error) => failure(error, t("trash.callDeleteFailed")),
            })
          }
        >
          <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
          {t("trash.deleteCall")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
