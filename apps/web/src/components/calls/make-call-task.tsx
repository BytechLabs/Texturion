"use client";

import { ListPlus } from "lucide-react";
import { useState } from "react";

import { MakeTaskForm } from "@/components/thread/make-task-form";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useT } from "@/i18n/provider";
import { useCall } from "@/lib/api/calls";
import { cn } from "@/lib/utils";

/**
 * D64: "Make a task" on an answered call. A job agreed on the phone is the most
 * common way work is booked, and until now only a text could become a task.
 *
 * One quiet icon button that opens the same prefilled form a message uses
 * (title seeded with who rang), so the call log, the contact's history and the
 * thread's call line all offer the identical act. The caller renders this only
 * for an answered call that has a conversation: the server refuses any other.
 *
 * The call log knows the call's id. The thread's call line carries only the
 * carrier session id (its event payload predates tasks), so it passes that and
 * the id is read when the form is opened, not once per line in a long thread.
 */
export function MakeCallTask({
  callId,
  sessionId,
  conversationId,
  callerName,
  className,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  callId?: string;
  sessionId?: string;
  conversationId: string;
  callerName: string;
  className?: string;
  /** #734: a trigger of the caller's own, so it matches the row it sits in. */
  trigger?: React.ReactNode;
  /**
   * #734: opened from a menu item instead of a button of its own. The form then
   * hangs off an invisible anchor at the row's top-right, since the menu item
   * that asked for it has already closed.
   */
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {controlled ? (
        <PopoverAnchor asChild>
          <span aria-hidden className="pointer-events-none absolute right-3 top-3 size-0" />
        </PopoverAnchor>
      ) : (
      <PopoverTrigger asChild>
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
      </PopoverTrigger>
      )}
      <PopoverContent align="end" className="w-80">
        <PopoverHeader className="mb-3">
          <PopoverTitle>{t("thread.makeATask")}</PopoverTitle>
        </PopoverHeader>
        {callId !== undefined ? (
          <MakeTaskForm
            call={{
              id: callId,
              title: t("thread.callTaskTitle", { name: callerName }),
            }}
            conversationId={conversationId}
            onDone={() => setOpen(false)}
          />
        ) : sessionId !== undefined ? (
          <FormForSession
            sessionId={sessionId}
            conversationId={conversationId}
            callerName={callerName}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Mounts only while the popover is open, so it is the one place the call is read. */
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
