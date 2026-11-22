"use client";

import { AlertTriangle, Clock, Ellipsis, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SCHEDULED_BODY_MAX, scheduledClockProvenance, scheduledHoldText } from "@loonext/shared";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useT } from '@/i18n/provider';
import type { Translate } from '@/i18n/provider';

import { ApiError } from "@/lib/api/error";
import {
  scheduledActionAllowed,
  scheduledQuietHour,
  useCancelScheduledMessage,
  useScheduledMessages,
  useUpdateScheduledMessage,
} from "@/lib/api/scheduled-messages";
import type { QuietHoursConfirmation, ScheduledMessage } from "@/lib/api/scheduled-messages";
import type { DestinationClock } from "@/lib/api/types";
import { twoClockLabel, twoClockSpoken } from "@/lib/format/time";
import { cn } from "@/lib/utils";
import { QuietHoursConfirm, SendLaterDialog } from "./send-later-menu";

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
 * - A row opens to show the full text. The strip hides when the queue is empty.
 * - **Disclosure is the point.** A held message says WHY in the words the API
 *   chose, and wears the amber accent this product already uses for "needs a
 *   human". `docs/DECISIONS.md` makes that binding: silent disappearance is the
 *   one unacceptable option, and a strip that showed only the time would be
 *   silent about the only state that matters.
 * - Cancel takes effect immediately. The toast offers Undo.
 */
export function ScheduledStrip({ conversationId, clock }: {
  conversationId: string;
  clock: DestinationClock | null;
}) {
  const scheduled = useScheduledMessages(conversationId);
  const cancel = useCancelScheduledMessage();

  const rows = scheduled.data ?? [];
  // No skeleton and no empty state. This is a strip that is usually absent, and
  // reserving space for it on every thread would be a permanent cost paid for a
  // rare event.
  if (rows.length === 0) return null;

  return (
    <ul className="mx-auto flex w-full max-w-[42rem] flex-col gap-1 px-1 pb-1.5">
      {rows.map((row) => (
        <ScheduledRow
          key={row.id}
          row={row}
          clock={clock}
          onCancel={() => cancel.mutate(row.id)}
          cancelling={cancel.isPending && cancel.variables === row.id}
        />
      ))}
    </ul>
  );
}

function ScheduledRow({
  row,
  clock,
  onCancel,
  cancelling,
}: {
  row: ScheduledMessage;
  clock: DestinationClock | null;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const t = useT();
  const update = useUpdateScheduledMessage();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [pickingTime, setPickingTime] = useState(false);
  const [quietTime, setQuietTime] = useState<QuietHoursConfirmation | null>(null);
  const held = row.status === "held";
  const holdText = scheduledHoldText(row.held_reason_key, row.held_reason, t);
  const canEdit = scheduledActionAllowed(row, "edit");

  async function save(patch: { body?: string; send_at?: string; quiet_hours_confirmed?: boolean }) {
    try {
      await update.mutateAsync({ id: row.id, ...patch });
      setDraft(null);
    } catch (error) {
      if (error instanceof ApiError && error.code === "quiet_hours_confirmation_required" && patch.send_at) {
        setQuietTime({ sendAt: patch.send_at, localHour: scheduledQuietHour(error) });
        return;
      }
      toast.error(t("thread.scheduledUpdateFailed"));
    }
  }

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
        <Clock
          className="mt-0.5 size-3.5 shrink-0"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          aria-expanded={expanded}
          className={cn("block min-h-11 w-full text-left md:min-h-8", expanded ? "whitespace-pre-wrap break-words" : "truncate")}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="font-medium text-foreground">
            {held ? t("tasks.scheduledWaiting") : sendAtLabel(row, t)}
          </span>
          {" — "}
          {row.body}
        </button>
        {/* The reason, in ONE sentence chosen by the shared module. Not
            paraphrased here: three clients paraphrasing one sentence is how one
            of them ends up saying nothing at all.

            #228: the key where we have words for it, the stored English
            otherwise. */}
        {held && holdText && (
          <p className="mt-0.5 text-app-amber">{holdText}</p>
        )}
        {!held && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t(scheduledClockProvenance(row.clock_source))}
          </p>
        )}
        {held && canEdit && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            disabled={update.isPending || cancelling}
            onClick={() => setPickingTime(true)}
          >
            {t("thread.pickAnotherTime")}
          </Button>
        )}
      </div>
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="tap-target size-6"
              aria-label={t("thread.scheduledActions")}
              disabled={update.isPending || cancelling}
            >
              <Ellipsis className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDraft(row.body)}>{t("thread.scheduledEditText")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPickingTime(true)}>{t("thread.scheduledChangeTime")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {scheduledActionAllowed(row, "cancel") && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling || update.isPending}
          aria-label={t("thread.scheduledCancelAria", {
            when: sendAtSpoken(row, t),
          })}
          className="tap-target -mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-out hover:bg-secondary hover:text-foreground disabled:opacity-45"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
      <ConfirmDialog
        open={draft !== null}
        onOpenChange={(open) => { if (!open) setDraft(null); }}
        title={t("thread.scheduledEditText")}
        confirmLabel={t("common.save")}
        tone="default"
        pending={update.isPending}
        confirmDisabled={!draft?.trim()}
        onConfirm={() => { if (draft) void save({ body: draft }); }}
      >
        <Textarea
          aria-label={t("thread.scheduledEditText")}
          value={draft ?? ""}
          maxLength={SCHEDULED_BODY_MAX}
          onChange={(event) => setDraft(event.target.value)}
        />
      </ConfirmDialog>
      {pickingTime && (
        <SendLaterDialog
          open
          clock={clock}
          onOpenChange={setPickingTime}
          onConfirm={(send_at) => { void save({ send_at }); }}
        />
      )}
      <QuietHoursConfirm
        open={quietTime !== null}
        localHour={quietTime?.localHour ?? null}
        onOpenChange={(open) => { if (!open) setQuietTime(null); }}
        onConfirm={() => { if (quietTime) void save({ send_at: quietTime.sendAt, quiet_hours_confirmed: true }); }}
      />
    </li>
  );
}

/**
 * "Tue 8:00 AM" in the DESTINATION's zone — and the reader's own, when they
 * differ.
 *
 * The zone is the one stored on the row, not the reader's: a dispatcher in
 * Toronto looking at a send scheduled for a customer in Vancouver must see the
 * time that customer will experience, because that is the time the sender chose.
 *
 * #539: AND IT HAS TO SAY SO. This used to render the destination's clock with
 * nothing marking it, so the Toronto dispatcher above read "8:00 AM" as their own
 * eight o'clock and was three hours out — the string was correct and the reader
 * was wrong, which is the worst kind of label because there is nothing on screen
 * to argue with. The shared rule adds "their time · yours" only when the two
 * clocks actually read differently, so a crew whose customers are all in town
 * still sees one plain time.
 */
export function sendAtLabel(
  row: {
    send_at: string;
    clock_timezone: string;
  },
  t: Translate,
): string {
  return (
    twoClockLabel(row.send_at, row.clock_timezone, undefined, t.locale) ||
    t("thread.scheduledFallback")
  );
}

/** The same, as a sentence, for the cancel button's accessible name. */
export function sendAtSpoken(
  row: {
    send_at: string;
    clock_timezone: string;
  },
  t: Translate,
): string {
  return (
    twoClockSpoken(row.send_at, row.clock_timezone, undefined, t.locale) ||
    t("thread.scheduledFallback")
  );
}
