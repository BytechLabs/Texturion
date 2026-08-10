"use client";

/**
 * #233 — everything the workspace has queued, in one place.
 *
 * The issue asks for this "so nobody is surprised", and that phrasing is the
 * whole brief. A crew shares one inbox: the owner writing six follow-ups on a
 * Sunday night is invisible to the tech who answers the same customer on
 * Monday morning, and the tech finds out when the customer replies to a
 * message they never saw.
 *
 * Design notes, and the principles behind them:
 *
 * - **Grouped by DAY, not by thread.** The question this page answers is "what
 *   is about to go out", and the axis of that question is time. Grouping by
 *   conversation would answer "which threads have something queued", which the
 *   thread's own strip already answers better.
 * - **Chunking.** Held rows lift into their own group at the top. A held
 *   message is the only kind that needs a decision, and mixed into a
 *   chronological list it reads as one more thing that is going fine.
 * - **Zen of Clarity.** One line per row: who, when, and the words. The reason
 *   is the only second line, and only when there is one.
 * - **No ethical friction.** Cancelling something that has not gone is
 *   reversible in the only sense that counts — you can schedule it again — so
 *   it is one click and a toast.
 *
 * The rows deliberately do NOT offer editing. A body worth rewriting is worth
 * rewriting in the thread it belongs to, where the conversation above it is
 * visible; an edit box here would let somebody change what a customer reads
 * without seeing what they said last.
 */
import { AlertTriangle, CalendarClock, Clock } from "lucide-react";
import Link from "next/link";

import { SCHEDULED_SEND_COPY, scheduledClockProvenance } from "@loonext/shared";

import { CalmEmptyState } from "@/components/settings/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { sendAtLabel } from "@/components/thread/scheduled-strip";
import { useT } from "@/i18n/provider";
import {
  scheduledRecipient,
  useCancelScheduledMessage,
  useScheduledMessages,
  type ScheduledMessage,
} from "@/lib/api/scheduled-messages";
import { cn } from "@/lib/utils";

export function ScheduledView() {
  const t = useT();
  const scheduled = useScheduledMessages();
  const cancel = useCancelScheduledMessage();

  const rows = scheduled.data ?? [];
  const held = rows.filter((row) => row.status === "held");
  const pending = rows.filter((row) => row.status !== "held");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[17px] font-semibold text-app-ink">
          {t("tasks.scheduledTitle")}
        </h1>
        {rows.length > 0 && (
          <p className="text-[12.5px] text-app-muted">
            {rows.length === 1
              ? t("tasks.scheduledOneWaiting")
              : t("tasks.scheduledManyWaiting", { count: rows.length })}
          </p>
        )}
      </div>

      {scheduled.isPending ? (
        <div className="overflow-hidden rounded-app-card border border-app-line bg-app-paper">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="space-y-2 border-b border-app-line-soft p-[11px] last:border-b-0"
            >
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          ))}
        </div>
      ) : scheduled.isError ? (
        <CalmEmptyState
          icon={<CalendarClock className="size-7" strokeWidth={1.5} />}
          title={t("tasks.scheduledLoadFailed")}
          description={t("tasks.scheduledLoadFailedHint")}
        />
      ) : rows.length === 0 ? (
        // The two halves of the shared `nothing_scheduled` sentence, split
        // across CalmEmptyState's two slots — the same words the phones say in
        // one line. Reassurance IS the honest empty answer here: the question
        // this page exists to settle is "is something about to go out that I
        // don't know about", and "no" is a complete reply.
        <CalmEmptyState
          icon={<CalendarClock className="size-7" strokeWidth={1.5} />}
          title={SCHEDULED_SEND_COPY.nothing_scheduled.split(". ")[0] + "."}
          description={SCHEDULED_SEND_COPY.nothing_scheduled.split(". ")[1]}
        />
      ) : (
        <div className="space-y-6">
          {/* Held first. These are the only rows that need a person, and
              chronological order would bury them among the ones going fine.
              *Applying: Chunking.* */}
          {held.length > 0 && (
            <ScheduledGroup
              title={t("tasks.scheduledNeedsYou")}
              rows={held}
              onCancel={(id) => cancel.mutate(id)}
              cancelling={cancel.isPending ? String(cancel.variables) : null}
            />
          )}
          {pending.length > 0 && (
            <ScheduledGroup
              title={t("tasks.scheduledGoingOut")}
              rows={pending}
              onCancel={(id) => cancel.mutate(id)}
              cancelling={cancel.isPending ? String(cancel.variables) : null}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ScheduledGroup({
  title,
  rows,
  onCancel,
  cancelling,
}: {
  title: string;
  rows: ScheduledMessage[];
  onCancel: (id: string) => void;
  cancelling: string | null;
}) {
  return (
    <section>
      <h2 className="flex items-baseline gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
        {title}
      </h2>
      <ul className="overflow-hidden rounded-app-card border border-app-line bg-app-paper">
        {rows.map((row) => (
          <ScheduledListRow
            key={row.id}
            row={row}
            onCancel={() => onCancel(row.id)}
            cancelling={cancelling === row.id}
          />
        ))}
      </ul>
    </section>
  );
}

function ScheduledListRow({
  row,
  onCancel,
  cancelling,
}: {
  row: ScheduledMessage;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const t = useT();
  const held = row.status === "held";
  return (
    <li className="flex items-start gap-[11px] border-b border-app-line-soft p-[11px] last:border-b-0">
      {held ? (
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-app-amber"
          strokeWidth={1.75}
          aria-hidden
        />
      ) : (
        <Clock
          className="mt-0.5 size-4 shrink-0 text-app-muted-2"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          {/* The thread, not a modal. A queued text only makes sense beside
              what the customer last said, and that lives one click away. */}
          <Link
            href={`/inbox/${row.conversation_id}`}
            className="truncate text-[13.5px] font-medium text-app-ink hover:underline"
          >
            {scheduledRecipient(row)}
          </Link>
          <span
            className={cn(
              "shrink-0 text-[12px] tabular-nums",
              held ? "text-app-amber" : "text-app-muted",
            )}
          >
            {held ? t("tasks.scheduledWaiting") : sendAtLabel(row)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12.5px] text-app-muted">{row.body}</p>
        {/* The reason, in the API's own words. Not paraphrased per surface:
            two surfaces paraphrasing one sentence is how they end up
            disagreeing about why a text did not go. */}
        {held && row.held_reason ? (
          <p className="mt-1 text-[12px] text-app-amber">{row.held_reason}</p>
        ) : (
          <p className="mt-1 text-[11px] text-app-muted-2">
            {scheduledClockProvenance(row.clock_source)}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        className="tap-target shrink-0 rounded-app-ctrl px-2 py-1 text-[12px] font-medium text-app-muted transition-colors duration-150 ease-out hover:bg-app-line-soft hover:text-app-ink disabled:opacity-45"
      >
        {t("common.cancel")}
      </button>
    </li>
  );
}
