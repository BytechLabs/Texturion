"use client";

import {
  Check,
  CheckCheck,
  CircleCheck,
  ListChecks,
  Lock,
  Pin,
} from "lucide-react";
import { format } from "date-fns";

import { useMemberNames } from "@/components/inbox/member-avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRetryMessage } from "@/lib/api/messages";
import type { Message, MessageTaskLink } from "@/lib/api/types";
import { formatAbsoluteDateTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";

import { NoteAttachments } from "@/components/attachments/note-attachments";

import { useTaskDrawer } from "@/components/tasks/use-task-drawer";

import { AttachmentImage } from "./attachment-image";
import { doneBadgeLabel, isDone } from "./done";
import { MessageActions } from "./message-actions";

/** Telnyx error for a send blocked by the profile-level opt-out list (§5). */
const OPTED_OUT_ERROR_CODE = "40300";

/**
 * Delivery-state line (G5): "Sending…" → "Sent ✓" → "Delivered ✓✓";
 * Failed = red "Not delivered — Retry" (retry only while the Telnyx API call
 * never assigned an id, SPEC §7); 40300 failures read "This customer opted
 * out" instead. Includes screen-reader text (G11). Hovering the time shows
 * the absolute datetime with zone abbreviation (D15).
 */
export function DeliveryState({
  message,
  conversationId,
}: {
  message: Message;
  conversationId: string;
}) {
  const retry = useRetryMessage(conversationId);

  if (message.status === "failed") {
    const optedOut = message.error_code === OPTED_OUT_ERROR_CODE;
    const retryable = message.telnyx_message_id === null && !optedOut;
    // red-600 clears 4.5:1 on every light bubble; red-400 is needed on the
    // dark teal-950 outbound bubble (red-500 there is only 3.79:1). 12px.
    return (
      <span
        className="text-[12px] text-destructive dark:text-red-400"
        role="status"
      >
        {optedOut ? "This customer opted out" : "Not delivered"}
        {retryable && (
          <>
            {". "}
            <button
              type="button"
              onClick={() => retry.mutate(message.id)}
              disabled={retry.isPending}
              // tap-target: ≥44px hit area on mobile (G11) without visual bloat.
              className="tap-target rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              {retry.isPending ? "Retrying…" : "Retry"}
            </button>
          </>
        )}
      </span>
    );
  }

  const time = format(new Date(message.created_at), "h:mm a");
  let state: React.ReactNode = null;
  let srState = "";
  if (message.status === "queued") {
    state = "Sending…";
    srState = "sending";
  } else if (message.status === "sent") {
    state = (
      <>
        Sent <Check aria-hidden className="inline size-3" strokeWidth={1.75} />
      </>
    );
    srState = "sent";
  } else if (message.status === "delivered") {
    state = (
      <>
        Delivered{" "}
        <CheckCheck aria-hidden className="inline size-3" strokeWidth={1.75} />
      </>
    );
    srState = "delivered";
  }

  return (
    <span
      className="text-[12px] text-muted-foreground"
      title={formatAbsoluteDateTime(message.created_at)}
    >
      <span aria-hidden>{time}</span>
      {state !== null && (
        <>
          <span aria-hidden> · </span>
          <span aria-hidden>{state}</span>
        </>
      )}
      <span className="sr-only">
        {`${time}${srState ? `, ${srState}` : ""}`}
      </span>
    </span>
  );
}

/**
 * #3: the calm "Pinned" chip a pinned message carries in its action row. A
 * quiet stone chip with a pin glyph — a distinct fact from the stone "Task"
 * chip (different glyph) and the petrol "Done" pill (different color). The
 * pin/unpin action itself lives in the message overflow (⋯) menu.
 */
function PinnedBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-app-line-soft px-1.5 py-0.5 text-[11px] font-medium text-app-muted"
      title="Pinned"
    >
      <Pin aria-hidden className="size-3" strokeWidth={2} />
      Pinned
      <span className="sr-only">, pinned message</span>
    </span>
  );
}

/**
 * The small petrol check badge a done message carries, with the D14 tooltip
 * "Done · Sam · 2:14 PM" (and the same text for screen readers).
 */
function DoneBadge({ message }: { message: Message }) {
  const memberNames = useMemberNames();
  const label = doneBadgeLabel(message, (userId) => memberNames.get(userId));

  // A labeled petrol "Done" pill — legible at a glance on touch (no hover
  // needed) and unmistakably distinct from the stone "Task" chip. The tooltip
  // still carries the "Done · Sam · 2:14 PM" detail for pointer users.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          tabIndex={0}
        >
          <CircleCheck aria-hidden className="size-3" strokeWidth={2.25} />
          Done
          <span className="sr-only">, {label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * T5.1 / APP-LAYOUT-V2 §4.1: the "Task" chip a promoted message carries in its
 * action row. A labeled STONE chip — distinct from the petrol "Done" pill
 * (petrol stays reserved for done, so the two never converge in color) and
 * legible on touch without hover. Clicking OPENS THE TASK in the drawer
 * (`?task=<id>`), the same target every other task affordance uses — not a
 * no-op link back to the conversation you're already reading.
 */
function TaskIndicator({ task }: { task: MessageTaskLink }) {
  const { openTask } = useTaskDrawer();
  return (
    <button
      type="button"
      onClick={() => openTask(task.id)}
      aria-label={`Open the task: ${task.title}`}
      className="tap-target inline-flex items-center gap-1 rounded-full bg-app-line-soft px-1.5 py-0.5 text-[11px] font-medium text-app-muted transition-colors duration-150 ease-out hover:bg-app-line hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <ListChecks aria-hidden className="size-3" strokeWidth={2} />
      Task
    </button>
  );
}

/**
 * TASKS-V2 D-D: the "on: <task title>" chip a task-linked note carries so its
 * context is clear in the thread. Clicking it opens the task drawer (`?task=`),
 * the same target every task line uses. Quiet stone chip on the amber note card.
 */
function NoteTaskChip({ task }: { task: { id: string; title: string } }) {
  const { openTask } = useTaskDrawer();
  return (
    <button
      type="button"
      onClick={() => openTask(task.id)}
      className="tap-target mb-1 inline-flex max-w-full items-center gap-1 rounded-full border border-app-amber-line bg-app-white/60 px-2 py-0.5 text-[11px] font-medium text-app-amber-ink transition-colors hover:bg-app-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <ListChecks className="size-3 shrink-0" strokeWidth={2} aria-hidden />
      <span className="truncate">on: {task.title}</span>
    </button>
  );
}

/**
 * One message bubble (G5): inbound = white card + stone border, left;
 * outbound = teal-50/teal-900 (dark teal-950/teal-100), right; note =
 * amber-50 dashed border + lock + "Internal note". Max width 65% (85%
 * mobile). Text selectable, 15/16px.
 *
 * D14: every bubble (inbound, outbound, notes) carries the done toggle at
 * its edge; done messages render the text struck through at 55% opacity plus
 * the petrol check badge on the action row.
 */
export function MessageBubble({
  message,
  isLastOfCluster,
  conversationId,
  contactName,
  senderName = null,
}: {
  message: Message;
  isLastOfCluster: boolean;
  conversationId: string;
  contactName: string;
  /** #101 shared-inbox attribution: the teammate who sent/wrote this cluster.
   * Null for inbound (the contact) and for system sends (auto-replies — the
   * timeline's event lines already narrate those). */
  senderName?: string | null;
}) {
  const outbound = message.direction === "outbound";
  const note = message.direction === "note";
  const attachments = message.attachments ?? [];
  const failed = message.status === "failed";
  const done = isDone(message);
  const hasTask = message.has_task === true;
  const pinned = message.pinned_at !== null;

  return (
    <div
      className={cn(
        "group/message flex w-full items-center gap-0.5",
        // Mirrored for right-aligned bubbles so the toggle stays at the
        // bubble's inner edge (on-screen) instead of in the gutter.
        (outbound || note) && "flex-row-reverse",
      )}
    >
      <div
        className={cn(
          // §1.2: an ABSOLUTE measure cap — min(90%, 34rem) inside the 42rem
          // reading track — so the bubble holds ~66ch regardless of monitor
          // width (replaces the old pane-relative max-w-65% that blew past
          // 100ch on wide screens). 85% on mobile.
          "flex min-w-0 max-w-[85%] flex-col gap-1 md:max-w-[min(90%,34rem)]",
          outbound || note ? "items-end" : "items-start",
        )}
      >
        {attachments.length > 0 && (
          <div
            className={cn(
              "flex max-w-full flex-wrap gap-1.5 transition-opacity duration-150 ease-out",
              outbound ? "justify-end" : "justify-start",
              done && "opacity-55",
            )}
          >
            {attachments.map((attachment) => (
              <AttachmentImage
                key={attachment.id}
                attachment={attachment}
                alt={`Photo ${outbound ? "sent to" : "from"} ${contactName}`}
              />
            ))}
          </div>
        )}
        {message.body.trim() !== "" && (
          <div
            className={cn(
              // APP-SHELL-REDESIGN bubbles (mockup): 16px radius with the inner
              // corner squared to 5px; real depth (soft shadow + hairline).
              "max-w-full whitespace-pre-wrap break-words rounded-app-bub px-3.5 py-2.5 text-[16px] leading-[1.5] md:text-[13.5px]",
              note
                ? "border border-app-amber-line bg-app-amber-bg text-app-amber-ink [border-bottom-right-radius:5px]"
                : outbound
                  ? // The app-bubble-out utility carries its own theme-paired
                    // text color (#26): white on petrol in light, near-black on
                    // the lifted petrol in dark — AA in both.
                    "app-bubble-out [border-top-right-radius:5px]"
                  : "border border-app-line bg-app-white text-app-ink [border-top-left-radius:5px]",
            )}
          >
            {/* Amber internal-note label on the amber-tint card — with the
                author, so a shared inbox knows whose note this is. */}
            {note && (
              <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-app-amber">
                <Lock className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="truncate">
                  Internal note{senderName ? ` · ${senderName}` : ""}
                </span>
              </span>
            )}
            {/* D-D: a task-linked note shows its task chip. */}
            {note && message.task && (
              <div className="mb-1">
                <NoteTaskChip task={message.task} />
              </div>
            )}
            {/* D14 done: strikethrough + 55% opacity, 150ms ease-out. */}
            <span
              className={cn(
                "transition-opacity duration-150 ease-out",
                done && "line-through opacity-55",
              )}
            >
              {message.body}
            </span>
          </div>
        )}
        {/* D19: internal-note attachment area — a quiet "Files" disclosure
            under the note bubble (any file type, 25 MB). Notes are the only
            generic-attachment owner shown in-thread; MMS media on real messages
            still renders via AttachmentImage above. */}
        {note && <NoteAttachments noteId={message.id} />}
        {(isLastOfCluster || failed || done || hasTask || pinned) && (
          <span className="flex items-center gap-1.5">
            {/* Labeled chips, orthogonal facts: a "Pinned" chip, a stone "Task"
                chip (opens the task), and a petrol "Done" pill — never the same
                glyph or color. */}
            {pinned && <PinnedBadge />}
            {hasTask && message.promoted_task && (
              <TaskIndicator task={message.promoted_task} />
            )}
            {done && <DoneBadge message={message} />}
            {/* #101 shared-inbox attribution: outbound meta leads with the
                teammate who sent it ("Dana · 7:18 AM · Delivered"). Notes carry
                their author in the card label instead. */}
            {outbound && senderName && (isLastOfCluster || failed) && (
              <span className="text-[12px] text-muted-foreground">
                {senderName}
                <span aria-hidden> ·</span>
              </span>
            )}
            {(isLastOfCluster || failed) &&
              (note || !outbound ? (
                <span
                  className="text-[12px] text-muted-foreground"
                  title={formatAbsoluteDateTime(message.created_at)}
                >
                  {format(new Date(message.created_at), "h:mm a")}
                </span>
              ) : (
                <DeliveryState
                  message={message}
                  conversationId={conversationId}
                />
              ))}
          </span>
        )}
      </div>
      {/* §4.1: done + overflow, vertically CENTERED beside the bubble (the row
          is items-center; the cluster is self-center). */}
      <MessageActions message={message} conversationId={conversationId} />
    </div>
  );
}
