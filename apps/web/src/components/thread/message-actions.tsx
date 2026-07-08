"use client";

import {
  Circle,
  CircleCheck,
  Copy,
  ListChecks,
  MoreHorizontal,
  Pin,
  PinOff,
  RotateCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import {
  useRetryMessage,
  useSetMessageDone,
  useSetMessagePinned,
} from "@/lib/api/messages";
import type { Message } from "@/lib/api/types";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  doneToggleLabel,
  isDone,
  isUnsentOutbound,
  shouldPopDone,
} from "./done";
import { MakeTaskForm } from "./make-task-form";

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
      <Icon ref={iconRef} aria-hidden className="size-4" strokeWidth={1.75} />
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
  const setPinned = useSetMessagePinned(conversationId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const retryable = isRetryable(message);
  const pinned = message.pinned_at !== null;
  const hasBody = message.body.trim() !== "";
  // A promoted message can't be re-promoted (server 409); hide the affordance
  // when we already know it's a task, so the primary path is a clean create.
  const alreadyTask = message.has_task === true;
  // Promoting a never-sent outbound (queued/failed) to a task is nonsensical —
  // nothing reached the customer, so there is nothing to track. Withhold "Make
  // a task" alongside the Done toggle (withheld in MessageActions below).
  const promotable = !alreadyTask && !isUnsentOutbound(message);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(message.body);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Couldn't copy. Your browser blocked clipboard access.");
    }
  };

  return (
    // The task form Popover is ANCHORED to the same overflow button (its
    // trigger), so selecting "Make a task" closes the menu and opens a compact
    // inline prefilled form in place (T5.1) — not a direct create.
    <Popover open={taskFormOpen} onOpenChange={setTaskFormOpen}>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        {/* PopoverAnchor (positioning only, no click handler) so the click that
            opens the menu can't also toggle the popover — the popover opens
            solely via setTaskFormOpen when "Make a task" is selected. */}
        <PopoverAnchor asChild>
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
        </PopoverAnchor>
        <DropdownMenuContent
          align="end"
          className="w-44"
          // The Popover shares this menu's anchor button but via PopoverAnchor
          // (not PopoverTrigger), so it is NOT excluded from the popover's
          // outside-dismiss. If the menu returns focus to that button on close,
          // the popover sees a focus-outside and closes instantly (the "Make a
          // task" form flashed open then vanished). Suppress the focus return.
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {/* #3: pin/unpin surfaces an important message (address, quote, gate
              code) at the top of the thread. Shared/team-wide, any message. */}
          <DropdownMenuItem
            onSelect={() =>
              setPinned.mutate({ messageId: message.id, pinned: !pinned })
            }
          >
            {pinned ? (
              <PinOff className="size-4" strokeWidth={1.75} aria-hidden />
            ) : (
              <Pin className="size-4" strokeWidth={1.75} aria-hidden />
            )}
            {pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          {promotable && (
            <DropdownMenuItem
              onSelect={() => {
                // Close the menu, then open the inline form on the NEXT TICK.
                // Both share the overflow button as anchor; opening the popover
                // in the same tick lets the menu's closing dismiss/focus event
                // reach the popover and immediately close it (it flashed open
                // then vanished). Deferring past the menu's teardown fixes it.
                setMenuOpen(false);
                setTimeout(() => setTaskFormOpen(true), 0);
              }}
            >
              <ListChecks className="size-4" strokeWidth={1.75} aria-hidden />
              Make a task
            </DropdownMenuItem>
          )}
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
      <PopoverContent align="end" className="w-80">
        <PopoverHeader className="mb-3">
          <PopoverTitle>Make a task</PopoverTitle>
        </PopoverHeader>
        <MakeTaskForm
          message={message}
          conversationId={conversationId}
          onDone={() => setTaskFormOpen(false)}
        />
      </PopoverContent>
    </Popover>
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
  // is withheld inside MessageOverflow for the same reason. The overflow itself
  // stays (Copy text / Retry send remain useful on a failed send).
  const done = !isUnsentOutbound(message);
  return (
    <div className="flex shrink-0 items-center gap-0.5 self-center">
      {done && <DoneToggle message={message} conversationId={conversationId} />}
      <MessageOverflow message={message} conversationId={conversationId} />
    </div>
  );
}
