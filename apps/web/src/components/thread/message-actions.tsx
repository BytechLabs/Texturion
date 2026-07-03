"use client";

import { CircleCheck, Copy, ListChecks, MoreHorizontal, RotateCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError } from "@/lib/api/error";
import { useRetryMessage, useSetMessageDone } from "@/lib/api/messages";
import { useCreateTaskFromMessage } from "@/lib/api/tasks";
import type { Message } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { doneToggleLabel, isDone } from "./done";

/** Telnyx error for a send blocked by the profile-level opt-out list. */
const OPTED_OUT_ERROR_CODE = "40300";

/** A failed outbound with no carrier id assigned can be retried (SPEC §7). */
function isRetryable(message: Message): boolean {
  return (
    message.direction === "outbound" &&
    message.status === "failed" &&
    message.telnyx_message_id === null &&
    message.error_code !== OPTED_OUT_ERROR_CODE
  );
}

/**
 * The APP-LAYOUT-V2 §4.1 done toggle: a quiet circle-check at the bubble's
 * edge, VERTICALLY CENTERED to the bubble (the row centers it, §4.1). Desktop —
 * revealed on message hover/focus, `stone-400` → petrol on hover; mobile —
 * subtle-always. aria-pressed toggle with "Mark done" / "Mark not done";
 * 150ms ease-out. AUDITABLE: the click hits the real PATCH /v1/messages/:id
 * done path, which writes the conversation_events message_done/undone row that
 * renders in the timeline (§4.2).
 */
function DoneToggle({
  message,
  conversationId,
}: {
  message: Message;
  conversationId: string;
}) {
  const setDone = useSetMessageDone(conversationId);
  const done = isDone(message);

  return (
    <button
      type="button"
      aria-pressed={done}
      aria-label={doneToggleLabel(done)}
      onClick={() => setDone.mutate({ messageId: message.id, done: !done })}
      className={cn(
        // tap-target: the 16px icon + p-1 is 24px; extend the hit area to
        // ≥44px on mobile (§7), where this is the subtle-always action.
        "tap-target shrink-0 rounded-full p-1 transition-[color,opacity] duration-150 ease-out",
        "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        done ? "text-primary" : "text-foreground-tertiary",
        // Mobile: subtle-always. Desktop: revealed on hover/focus of the group.
        !done &&
          "md:opacity-0 md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100 md:focus-visible:opacity-100",
      )}
    >
      <CircleCheck aria-hidden className="size-4" strokeWidth={1.75} />
    </button>
  );
}

/**
 * §4.1 overflow (⋯): holds the rest so the bubble edge stays calm (two
 * controls max — done + overflow). Make a task (D17 promote, real POST
 * /v1/tasks {message_id}), Copy text, and (failed-retryable outbound) Retry.
 * Same reveal rules as the done toggle.
 */
function MessageOverflow({
  message,
  conversationId,
}: {
  message: Message;
  conversationId: string;
}) {
  const retry = useRetryMessage(conversationId);
  const createTask = useCreateTaskFromMessage(conversationId);
  const [open, setOpen] = useState(false);
  const retryable = isRetryable(message);
  const hasBody = message.body.trim() !== "";

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(message.body);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  };

  // §4.1 / T5.1: promote a message to a task via the real /v1 write. The hook
  // refetches the conversation checklist (so the new task appears in the context
  // panel at once) + the /tasks lists + the `task_created` audit line. Omitting
  // the title lets the RPC seed it from the message body (T5.1 default). A
  // re-promote is blocked server-side (409 conflict → "already a task").
  const makeTask = async () => {
    try {
      await createTask.mutateAsync({ message_id: message.id });
      toast.success("Made a task from this message.");
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.code === "conflict"
          ? "This message is already a task."
          : "Couldn't make a task. Try again.",
      );
    } finally {
      setOpen(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More actions"
          className={cn(
            "tap-target shrink-0 rounded-full p-1 text-foreground-tertiary transition-[color,opacity] duration-150 ease-out",
            "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            // Match the done toggle's reveal — subtle-always mobile, hover desktop.
            "data-[state=open]:opacity-100 md:opacity-0 md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100 md:focus-visible:opacity-100",
          )}
        >
          <MoreHorizontal aria-hidden className="size-4" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onSelect={() => void makeTask()}
          disabled={createTask.isPending}
        >
          <ListChecks className="size-4" strokeWidth={1.75} aria-hidden />
          Make a task
        </DropdownMenuItem>
        {hasBody && (
          <DropdownMenuItem onSelect={() => void copyText()}>
            <Copy className="size-4" strokeWidth={1.75} aria-hidden />
            Copy text
          </DropdownMenuItem>
        )}
        {retryable && (
          <DropdownMenuItem
            onSelect={() => retry.mutate(message.id)}
            disabled={retry.isPending}
          >
            <RotateCw className="size-4" strokeWidth={1.75} aria-hidden />
            Retry send
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The §4.1 per-message action cluster: done toggle + overflow, vertically
 * centered beside the bubble (the parent row centers them). Two controls max.
 */
export function MessageActions({
  message,
  conversationId,
}: {
  message: Message;
  conversationId: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 self-center">
      <DoneToggle message={message} conversationId={conversationId} />
      <MessageOverflow message={message} conversationId={conversationId} />
    </div>
  );
}
