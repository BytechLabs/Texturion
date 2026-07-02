"use client";

import { Check, CheckCheck, Lock } from "lucide-react";
import { format } from "date-fns";

import { useRetryMessage } from "@/lib/api/messages";
import type { Message } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { AttachmentImage } from "./attachment-image";

/** Telnyx error for a send blocked by the profile-level opt-out list (§5). */
const OPTED_OUT_ERROR_CODE = "40300";

/**
 * Delivery-state line (G5): "Sending…" → "Sent ✓" → "Delivered ✓✓";
 * Failed = red "Not delivered — Retry" (retry only while the Telnyx API call
 * never assigned an id, SPEC §7); 40300 failures read "This customer opted
 * out" instead. Includes screen-reader text (G11).
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
    return (
      <span className="text-[11px] text-destructive" role="status">
        {optedOut ? "This customer opted out" : "Not delivered"}
        {retryable && (
          <>
            {" — "}
            <button
              type="button"
              onClick={() => retry.mutate(message.id)}
              disabled={retry.isPending}
              className="font-medium underline-offset-2 hover:underline disabled:opacity-50"
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
    <span className="text-[11px] text-muted-foreground/80">
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
 * One message bubble (G5): inbound = white card + stone border, left;
 * outbound = teal-50/teal-900 (dark teal-950/teal-100), right; note =
 * amber-50 dashed border + lock + "Internal note". Max width 65% (85%
 * mobile). Text selectable, 15/16px.
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

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-1",
        outbound || note ? "items-end" : "items-start",
      )}
    >
      {attachments.length > 0 && (
        <div
          className={cn(
            "flex max-w-[85%] flex-wrap gap-1.5 md:max-w-[65%]",
            outbound ? "justify-end" : "justify-start",
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
            "max-w-[85%] whitespace-pre-wrap break-words rounded-[10px] px-3 py-2 text-[16px] leading-normal md:max-w-[65%] md:text-[15px]",
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
          {message.body}
        </div>
      )}
      {(isLastOfCluster || failed) &&
        (note ? (
          <span className="text-[11px] text-muted-foreground/80">
            {format(new Date(message.created_at), "h:mm a")}
          </span>
        ) : outbound ? (
          <DeliveryState message={message} conversationId={conversationId} />
        ) : (
          <span className="text-[11px] text-muted-foreground/80">
            {format(new Date(message.created_at), "h:mm a")}
          </span>
        ))}
    </div>
  );
}
