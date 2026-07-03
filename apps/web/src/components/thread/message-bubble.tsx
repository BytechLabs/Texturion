"use client";

import { Check, CheckCheck, CircleCheck, Lock } from "lucide-react";
import { format } from "date-fns";

import { useMemberNames } from "@/components/inbox/member-avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRetryMessage, useSetMessageDone } from "@/lib/api/messages";
import type { Message } from "@/lib/api/types";
import { formatAbsoluteDateTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";

import { AttachmentImage } from "./attachment-image";
import { doneBadgeLabel, doneToggleLabel, isDone } from "./done";

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
            {" — "}
            <button
              type="button"
              onClick={() => retry.mutate(message.id)}
              disabled={retry.isPending}
              // tap-target: ≥44px hit area on mobile (G11) without visual bloat.
              className="tap-target font-medium underline-offset-2 hover:underline disabled:opacity-50"
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
 * The D14 done toggle: a quiet circle-check at the bubble's edge. Desktop —
 * appears on message hover (and keyboard focus), `stone-400` → petrol on
 * hover; mobile — always visible. aria-pressed with "Mark done"/"Mark not
 * done" labels; 150ms ease-out transition.
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
        // ≥44px on mobile (G11), where this is the always-visible D14 action.
        "tap-target shrink-0 rounded-full p-1 transition-[color,opacity] duration-150 ease-out",
        "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        done ? "text-primary" : "text-foreground-tertiary",
        // Mobile: always visible on the bubble's action row; desktop: revealed
        // on hover/focus of the message group.
        !done &&
          "md:opacity-0 md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100 md:focus-visible:opacity-100",
      )}
    >
      <CircleCheck aria-hidden className="size-4" strokeWidth={1.75} />
    </button>
  );
}

/**
 * The small petrol check badge a done message carries, with the D14 tooltip
 * "Done · Sam · 2:14 PM" (and the same text for screen readers).
 */
function DoneBadge({ message }: { message: Message }) {
  const memberNames = useMemberNames();
  const label = doneBadgeLabel(message, (userId) => memberNames.get(userId));

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center rounded-full bg-primary/10 p-0.5 text-primary"
          tabIndex={0}
        >
          <CircleCheck aria-hidden className="size-3" strokeWidth={2} />
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
}: {
  message: Message;
  isLastOfCluster: boolean;
  conversationId: string;
  contactName: string;
}) {
  const outbound = message.direction === "outbound";
  const note = message.direction === "note";
  const attachments = message.attachments ?? [];
  const failed = message.status === "failed";
  const done = isDone(message);

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
          "flex min-w-0 max-w-[85%] flex-col gap-1 md:max-w-[65%]",
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
              "max-w-full whitespace-pre-wrap break-words rounded-[10px] px-3 py-2 text-[16px] leading-normal md:text-[15px]",
              note
                ? "border border-dashed border-amber-300 bg-amber-50 text-stone-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
                : outbound
                  ? "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100"
                  : "border border-border bg-card text-card-foreground",
            )}
          >
            {/* Label is amber-800 on the amber-50 card for the G11 4.5:1 text
                bar (--warning amber-600 only hits ~2:1 there). */}
            {note && (
              <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-warning">
                <Lock className="size-3" strokeWidth={1.75} aria-hidden />
                Internal note
              </span>
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
        {(isLastOfCluster || failed || done) && (
          <span className="flex items-center gap-1.5">
            {done && <DoneBadge message={message} />}
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
      <DoneToggle message={message} conversationId={conversationId} />
    </div>
  );
}
