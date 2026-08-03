"use client";

import { AlertTriangle, Clock, X } from "lucide-react";

import { scheduledClockProvenance } from "@loonext/shared";

import {
  useCancelScheduledMessage,
  useScheduledMessages,
  type ScheduledMessage,
} from "@/lib/api/scheduled-messages";
import { cn } from "@/lib/utils";

/**
 * #233 — what this thread is about to say, before it says it.
 *
 * Design notes:
 *
 * - **It sits with the COMPOSER, not in the message history.** A scheduled
 *   message is not a message; it has no delivery status and may never become
 *   one. Putting it in the transcript would mean the reader has to check a
 *   badge before believing that anything above the fold was actually sent, and
 *   the whole reason this is a separate table is that nothing which reads
 *   messages should ever show an unsent one.
 * - **Zen of Clarity.** One line each, and the strip disappears entirely when
 *   nothing is queued — which is almost always. A permanently-present empty
 *   panel would cost every reader attention to tell them nothing.
 * - **Disclosure is the point.** A held message says WHY in the words the API
 *   chose, and wears the amber accent this product already uses for "needs a
 *   human". `docs/DECISIONS.md` makes that binding: silent disappearance is the
 *   one unacceptable option, and a strip that showed only the time would be
 *   silent about the only state that matters.
 * - **No ethical friction.** Cancelling something that has not gone is
 *   reversible in the only sense that counts — you can schedule it again — so
 *   it is one click and a toast, not a dialog.
 */
export function ScheduledStrip({
  conversationId,
}: {
  conversationId: string;
}) {
  const scheduled = useScheduledMessages(conversationId);
  const cancel = useCancelScheduledMessage(conversationId);

  const rows = scheduled.data ?? [];
  // No skeleton and no empty state. This is a strip that is usually absent, and
  // reserving space for it on every thread would be a permanent cost paid for a
  // rare event.
  if (rows.length === 0) return null;

  return (
    <ul className="mx-auto flex max-w-[42rem] flex-col gap-1 px-1 pb-1.5">
      {rows.map((row) => (
        <ScheduledRow
          key={row.id}
          row={row}
          onCancel={() => cancel.mutate(row.id)}
          cancelling={cancel.isPending && cancel.variables === row.id}
        />
      ))}
    </ul>
  );
}

function ScheduledRow({
  row,
  onCancel,
  cancelling,
}: {
  row: ScheduledMessage;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const held = row.status === "held";
  return (
    <li
      className={cn(
        "flex items-start gap-2 rounded-app-ctrl border px-2.5 py-1.5 text-xs",
        held
          ? "border-app-amber/40 bg-app-amber/10 text-foreground"
          : "border-border bg-secondary/40 text-muted-foreground",
      )}
    >
      {held ? (
        <AlertTriangle
          className="mt-0.5 size-3.5 shrink-0 text-app-amber"
          strokeWidth={1.75}
          aria-hidden
        />
      ) : (
        <Clock className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <span className="font-medium text-foreground">
            {held ? "Waiting" : sendAtLabel(row)}
          </span>
          {" — "}
          {row.body}
        </p>
        {/* The reason, in the API's own words. Not paraphrased here: three
            clients paraphrasing one sentence is how one of them ends up saying
            nothing at all. */}
        {held && row.held_reason && (
          <p className="mt-0.5 text-app-amber">{row.held_reason}</p>
        )}
        {!held && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {scheduledClockProvenance(row.clock_source)}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        aria-label={`Cancel the message scheduled for ${sendAtLabel(row)}`}
        className="tap-target -mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-out hover:bg-secondary hover:text-foreground disabled:opacity-45"
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </li>
  );
}

/**
 * "Tomorrow, 8:00 AM" in the DESTINATION's zone.
 *
 * The zone is the one stored on the row, not the reader's: a dispatcher in
 * Toronto looking at a send scheduled for a customer in Vancouver must see the
 * time that customer will experience, because that is the time the sender
 * chose.
 */
export function sendAtLabel(row: {
  send_at: string;
  clock_timezone: string;
}): string {
  const at = new Date(row.send_at);
  if (Number.isNaN(at.getTime())) return "Scheduled";
  return at.toLocaleString(undefined, {
    timeZone: row.clock_timezone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
