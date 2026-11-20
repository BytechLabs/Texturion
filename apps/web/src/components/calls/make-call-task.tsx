"use client";

import { ListPlus } from "lucide-react";
import type { VoicemailTaskDraft } from "@loonext/shared";
import { useState } from "react";

import { MakeTaskDialogContent, MakeTaskForm } from "@/components/thread/make-task-form";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/provider";
import { useCall } from "@/lib/api/calls";
import { cn } from "@/lib/utils";

/** Answered call lines resolve their call ID when the editor opens. */
export function MakeCallTask({
  callId,
  sessionId,
  conversationId,
  callerName,
  voicemailDraft,
  className,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  callId?: string;
  sessionId?: string;
  conversationId: string;
  callerName: string;
  voicemailDraft?: VoicemailTaskDraft;
  className?: string;
  /** #734: a trigger of the caller's own, so it matches the row it sits in. */
  trigger?: React.ReactNode;
  /** A menu item can open the dialog without a separate trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setOwnOpen(next);
    onOpenChange?.(next);
  };

  let callAction;
  if (voicemailDraft) {
    callAction = (
      <MakeTaskForm
        call={{
          id: voicemailDraft.call_id,
          title: voicemailDraft.title ?? t("thread.callTaskTitle", { name: callerName }),
          voicemailDescription: voicemailDraft.description,
        }}
        conversationId={conversationId}
        onDone={() => setOpen(false)}
      />
    );
  } else if (callId === undefined) {
    callAction = sessionId === undefined
      ? null
      : (
        <FormForSession
          sessionId={sessionId}
          conversationId={conversationId}
          callerName={callerName}
          onDone={() => setOpen(false)}
        />
      );
  } else {
    callAction = (
      <MakeTaskForm
        call={{
          id: callId,
          title: t("thread.callTaskTitle", { name: callerName }),
        }}
        conversationId={conversationId}
        onDone={() => setOpen(false)}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          {trigger ?? <button
            type="button"
            aria-label={t("thread.makeTaskFromCallAria")}
            title={t("thread.makeATask")}
            className={cn(
              "tap-target relative z-[1] grid size-8 shrink-0 place-items-center rounded-full text-app-muted-2 transition-colors duration-150",
              "hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            <ListPlus aria-hidden className="size-4" strokeWidth={1.75} />
          </button>}
        </DialogTrigger>
      )}
      <MakeTaskDialogContent>
        {callAction}
      </MakeTaskDialogContent>
    </Dialog>
  );
}

function FormForSession({
  sessionId,
  conversationId,
  callerName,
  onDone,
}: {
  sessionId: string;
  conversationId: string;
  callerName: string;
  onDone: () => void;
}) {
  const t = useT();
  const call = useCall(sessionId);
  if (!call.data) {
    return (
      <p className="text-[13px] text-muted-foreground" role="status">
        {call.isError ? t("thread.taskCreateFailed") : t("thread.loadingMore")}
      </p>
    );
  }
  return (
    <MakeTaskForm
      call={{
        id: call.data.id,
        title: t("thread.callTaskTitle", { name: callerName }),
      }}
      conversationId={conversationId}
      onDone={onDone}
    />
  );
}
