"use client";

import {
  Circle,
  CircleCheck,
  Copy,
  ListChecks,
  MoreHorizontal,
  Pin,
  RotateCw,
  Trash2,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { failureReasonOf, isRetryableFailure } from "@loonext/shared";

import {
  RecordContextMenu,
  RecordOverflowMenu,
} from "@/components/ui/record-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { useT, type Translate } from "@/i18n/provider";
import {
  useRetryMessage,
  useSetMessageDone,
  useSetMessagePinned,
} from "@/lib/api/messages";
import { ApiError } from "@/lib/api/error";
import { useDeleteMessage } from "@/lib/api/trash";
import type { Message } from "@/lib/api/types";
import {
  useCanDeleteRecords,
  useDeletedToast,
} from "@/lib/hooks/use-records-delete";
import { prefersReducedMotion } from "@/lib/motion";
import type { RecordAction } from "@/lib/record-actions/types";
import { cn } from "@/lib/utils";

import { deletedMessageKey } from "./delete-message";
import {
  doneToggleLabel,
  isDone,
  isUnsentOutbound,
  shouldPopDone,
} from "./done";
import { MakeTaskForm } from "./make-task-form";

/** A failed outbound with no carrier id assigned can be retried (SPEC §7). */
function isRetryable(message: Message): boolean {
  return (
    // #722: the server's list decides where it was sent (a pinned-list row has none).
    (message.allowed_actions?.includes("retry") ?? true) &&
    message.direction === "outbound" &&
    message.status === "failed" &&
    message.telnyx_message_id === null &&
    // #241: OUR reason, not the vendor's code. This file used to compare
    // against a Telnyx constant, which meant a second carrier would have
    // needed an edit here and in two mobile apps.
    isRetryableFailure(failureReasonOf(message.error_reason, message.error_code))
  );
}

/**
 * The APP-LAYOUT-V2 §4.1 done toggle: a quiet check at the bubble's edge,
 * VERTICALLY CENTERED to the bubble (the row centers it, §4.1). Desktop —
 * revealed on message hover/focus, `stone-400` → petrol on hover; mobile —
 * subtle-always. aria-pressed toggle with "Mark done" / "Mark not done";
 * 150ms ease-out.
 *
 * #4 micro-polish: the two states are now visually distinct BEYOND color —
 * not-done shows a HOLLOW circle (an empty checkbox inviting the tick), done
 * shows a FILLED circle-check. And completing a message earns the house
 * signature motion (the app-check-cascade pop: scale 0.8 → 1.12 → 1) — fired
 * only on the user's done TRANSITION (not on mount, so already-done messages
 * don't pop as they scroll into view), and skipped under reduced-motion via
 * the WAAPI guard (globals.css only zeroes CSS animations, §G11 / lib/motion).
 *
 * AUDITABLE: the click hits the real PATCH /v1/messages/:id done path, which
 * writes the conversation_events message_done/undone row that renders in the
 * timeline (§4.2).
 */
function DoneToggle({
  message,
  conversationId,
}: {
  message: Message;
  conversationId: string;
}) {
  const t = useT();
  const setDone = useSetMessageDone(conversationId);
  const done = isDone(message);
  const iconRef = useRef<SVGSVGElement>(null);
  const wasDone = useRef(done);

  useEffect(() => {
    // The signature check pop, fired ONLY when this message flips
    // not-done → done during the session — never on initial mount (wasDone
    // seeds to the current state), so scrolling through a thread of already-
    // done messages stays still. Mirrors the app-check-cascade keyframe.
    if (
      shouldPopDone(wasDone.current, done) &&
      iconRef.current &&
      typeof iconRef.current.animate === "function" &&
      !prefersReducedMotion()
    ) {
      iconRef.current.animate(
        [
          { transform: "scale(0.8)" },
          { transform: "scale(1.12)", offset: 0.6 },
          { transform: "scale(1)" },
        ],
        { duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
    }
    wasDone.current = done;
  }, [done]);

  const Icon = done ? CircleCheck : Circle;

  return (
    <button
      type="button"
      aria-pressed={done}
      aria-label={doneToggleLabel(done, t)}
      onClick={() => setDone.mutate({ messageId: message.id, done: !done })}
      className={cn(
        // tap-target: the 16px icon + p-1 is 24px; extend the hit area to
        // ≥44px on mobile (§7), where this is the subtle-always action.
        "tap-target shrink-0 rounded-full p-1 transition-[color,opacity] duration-150 ease-out",
        "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        done ? "text-primary" : "text-foreground-tertiary",
        // Mobile: subtle-always. Desktop: revealed on hover/focus of the group.
        !done &&
          "md:opacity-0 md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100 md:focus-visible:opacity-100",
      )}
    >
      <Icon ref={iconRef} aria-hidden className="size-4" strokeWidth={1.75} />
    </button>
  );
}

/**
 * #712 — the message's ONE action list. The bubble's ⋯ menu and the bubble's
 * right-click / long-press menu both render it.
 */
export interface MessageActionsInput {
  t: Translate;
  message: Pick<Message, "body" | "direction"> & { pinned: boolean };
  canDelete: boolean;
  /** A promoted message can't be re-promoted (server 409), and a never-sent one has nothing to track. */
  promotable: boolean;
  retryable: boolean;
  retrying: boolean;
  deleting: boolean;
  run: {
    copyText: () => void;
    retry: () => void;
    makeTask: () => void;
    togglePin: (next: boolean) => void;
    remove: () => void;
  };
}

export function buildMessageActions(input: MessageActionsInput): RecordAction[] {
  const { t, message, run } = input;
  return [
    {
      id: "copy-text",
      label: t("thread.copyText"),
      icon: Copy,
      group: "primary",
      allowed: message.body.trim() !== "",
      onSelect: run.copyText,
    },
    {
      id: "retry",
      label: t("thread.retrySend"),
      icon: RotateCw,
      group: "primary",
      allowed: input.retryable,
      disabled: input.retrying,
      onSelect: run.retry,
    },
    {
      id: "make-task",
      label: t("thread.makeATask"),
      icon: ListChecks,
      group: "state",
      allowed: input.promotable,
      onSelect: run.makeTask,
    },
    {
      // #465: pinned is a STATE, named as one and drawn as a toggle.
      id: "pin",
      label: t("thread.pinned"),
      icon: Pin,
      group: "state",
      allowed: true,
      checked: message.pinned,
      onSelect: () => run.togglePin(!message.pinned),
    },
    {
      id: "delete",
      label: t(
        message.direction === "note" ? "trash.deleteNote" : "trash.deleteMessage",
      ),
      icon: Trash2,
      group: "danger",
      allowed: input.canDelete,
      destructive: true,
      disabled: input.deleting,
      onSelect: run.remove,
    },
  ];
}

interface MessageMenu {
  actions: RecordAction[];
}

/** Outside a MessageMenuScope there is no list, so the ⋯ simply is not offered. */
const MessageMenuContext = createContext<MessageMenu>({ actions: [] });

function useMessageMenu(): MessageMenu {
  return useContext(MessageMenuContext);
}

/**
 * Owns one message's action list and the inline task form it can open, so the
 * ⋯ button and the right-click menu share ONE set of mutations and ONE form.
 * The form is anchored to the message row (`children`), whichever menu opened it.
 */
export function MessageMenuScope({
  message,
  conversationId,
  children,
}: {
  message: Message;
  conversationId: string;
  /** The message row: one element that takes a ref and props. */
  children: React.ReactElement;
}) {
  const t = useT();
  const retry = useRetryMessage(conversationId);
  const setPinned = useSetMessagePinned(conversationId);
  const canDelete = useCanDeleteRecords();
  const deleteMessage = useDeleteMessage();
  const announceDeleted = useDeletedToast();
  const [taskFormOpen, setTaskFormOpen] = useState(false);

  const actions = buildMessageActions({
    t,
    message: {
      body: message.body,
      direction: message.direction,
      pinned: message.pinned_at !== null,
    },
    canDelete,
    // A promoted message can't be re-promoted (server 409); hide the
    // affordance when we already know it's a task. Promoting a never-sent
    // outbound is nonsensical, so it is withheld as well.
    promotable: message.has_task !== true && !isUnsentOutbound(message),
    retryable: isRetryable(message),
    retrying: retry.isPending,
    deleting: deleteMessage.isPending,
    run: {
      copyText: async () => {
        try {
          await navigator.clipboard.writeText(message.body);
          toast.success(t("thread.copied"));
        } catch {
          toast.error(t("thread.copyFailed"));
        }
      },
      retry: () => retry.mutate(message.id),
      // Open the form on the NEXT TICK: the menu is closing, and opening a
      // popover in the same tick lets the menu's dismiss/focus event reach it
      // and close it again (it flashed open then vanished).
      makeTask: () => {
        setTimeout(() => setTaskFormOpen(true), 0);
      },
      togglePin: (next) =>
        setPinned.mutate({ messageId: message.id, pinned: next }),
      // #691: a move to the Trash, so an undo toast and no confirmation. The
      // toast says when the customer still has the text (see deletedMessageKey).
      remove: () =>
        deleteMessage.mutate(message.id, {
          onSuccess: () =>
            announceDeleted(t(deletedMessageKey(message)), [
              { kind: "message", id: message.id },
            ]),
          onError: (error) =>
            toast.error(
              error instanceof ApiError
                ? error.message
                : t("trash.messageDeleteFailed"),
            ),
        }),
    },
  });

  return (
    <MessageMenuContext.Provider value={{ actions }}>
      <Popover open={taskFormOpen} onOpenChange={setTaskFormOpen}>
        <PopoverAnchor asChild>
          <RecordContextMenu actions={actions}>{children}</RecordContextMenu>
        </PopoverAnchor>
        <PopoverContent align="end" className="w-80">
          <PopoverHeader className="mb-3">
            <PopoverTitle>{t("thread.makeATask")}</PopoverTitle>
          </PopoverHeader>
          <MakeTaskForm
            message={message}
            conversationId={conversationId}
            onDone={() => setTaskFormOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </MessageMenuContext.Provider>
  );
}

/**
 * §4.1 overflow (⋯): holds the rest so the bubble edge stays calm (two
 * controls max — done + overflow). Renders the message's action list; the
 * button is absent when nothing is allowed. Same reveal rules as the done toggle.
 */
function MessageOverflow() {
  const t = useT();
  const { actions } = useMessageMenu();
  return (
    <RecordOverflowMenu
      actions={actions}
      label={t("thread.moreActions")}
      contentClassName="w-44"
      trigger={
        <button
          type="button"
          aria-label={t("thread.moreActions")}
          className={cn(
            "tap-target shrink-0 rounded-full p-1 text-foreground-tertiary transition-[color,opacity] duration-150 ease-out",
            "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // Match the done toggle's reveal — subtle-always mobile, hover desktop.
            "data-[state=open]:opacity-100 md:opacity-0 md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100 md:focus-visible:opacity-100",
          )}
        >
          <MoreHorizontal aria-hidden className="size-4" strokeWidth={1.75} />
        </button>
      }
    />
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
  // A never-sent outbound (queued/failed) has no delivered work to complete, so
  // its Done toggle is withheld (marking it done is nonsensical). "Make a task"
  // is withheld from its action list for the same reason. The overflow stays
  // (Copy text / Retry send remain useful on a failed send).
  const done = !isUnsentOutbound(message);
  return (
    <div className="flex shrink-0 items-center gap-0.5 self-center">
      {done && <DoneToggle message={message} conversationId={conversationId} />}
      <MessageOverflow />
    </div>
  );
}
