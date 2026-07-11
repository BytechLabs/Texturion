"use client";

/**
 * #129 Calls — the call-log surface. Composes the shipped vocabulary only:
 * the for-you Section card (uppercase 11px header, one bordered card,
 * hairline row separators), the inbox row anatomy (38px tinted-initial
 * avatar, 14px name, 11.5px tabular time), a StatusPill-recipe outcome pill
 * (missed = warning tint — the row's ONE tinted element; answered/voicemail
 * stay quiet), and CalmEmptyState. Missed is the only filter: the weekly
 * question is "who called and do I need to act?". #133 polish: a muted
 * direction glyph per row, a quiet explainer on unthreaded rows, and a slim
 * module-off banner above the list (history keeps working; calling doesn't).
 */
import { PhoneIncoming, PhoneMissed, PhoneOutgoing } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CalmEmptyState } from "@/components/settings/empty-state";
import { avatarColorClass, avatarInitials } from "@/components/shell/avatar-color";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/api/companies";
import { useCalls, type CallOutcomeFilter } from "@/lib/api/calls";
import type { Call } from "@/lib/api/types";
import { callOutcomeLabel } from "@/lib/format/call";
import { formatPhone } from "@/lib/format/phone";
import { formatRelativeTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";

function callerName(call: Call): string {
  if (call.contact_name) return call.contact_name;
  if (call.caller_e164) return formatPhone(call.caller_e164);
  return "Unknown caller";
}

/** #133: a small muted direction glyph on the meta line — at a glance,
 *  who called whom. Inbound misses get PhoneMissed, every other inbound
 *  call PhoneIncoming, outbound calls PhoneOutgoing. Muted always; the
 *  warning tint stays the OutcomePill's alone (accent budget #64). */
function DirectionIcon({ call }: { call: Call }) {
  const Icon =
    call.direction === "outbound"
      ? PhoneOutgoing
      : call.outcome === "missed"
        ? PhoneMissed
        : PhoneIncoming;
  return (
    <Icon
      aria-hidden
      className="size-3.5 shrink-0 text-app-muted-2"
      strokeWidth={1.75}
    />
  );
}

/** The one tinted element per row (accent budget): INBOUND misses only —
 *  an outbound no-answer is not crew-actionable urgency. */
function OutcomePill({ call }: { call: Call }) {
  const label = callOutcomeLabel(call);
  if (call.outcome === "missed" && call.direction !== "outbound") {
    return (
      <span className="inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-warning/15 dark:text-warning">
        {label}
      </span>
    );
  }
  return <span className="text-[12.5px] text-muted-foreground">{label}</span>;
}

function CallRow({ call }: { call: Call }) {
  const name = callerName(call);
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "grid size-[38px] shrink-0 place-items-center rounded-xl text-[13px] font-semibold text-app-petrol-deep",
          avatarColorClass(call.contact_id || name),
        )}
      >
        {avatarInitials(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14px] font-medium text-app-ink">
            {name}
          </span>
          <span className="shrink-0 text-[11.5px] tabular-nums text-app-muted-2">
            {formatRelativeTime(call.started_at)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <DirectionIcon call={call} />
          <OutcomePill call={call} />
          {/* #133: an unthreaded row (anonymous caller / no open thread) is
              deliberately not a link — say why, quietly. */}
          {!call.conversation_id && (
            <span className="ml-auto shrink-0 text-[12px] text-app-muted-2">
              Not linked to a conversation
            </span>
          )}
        </span>
      </span>
    </>
  );

  const rowClass =
    "flex items-start gap-[11px] border-b border-app-line-soft p-[11px] last:border-b-0";
  // Threaded calls open their conversation; an unthreaded row (anonymous
  // caller, or an answered call with no open thread) is plain — no dead link.
  if (call.conversation_id) {
    return (
      <Link
        href={`/inbox/${call.conversation_id}`}
        aria-label={`Call from ${name}, ${callOutcomeLabel(call).toLowerCase()}`}
        className={cn(
          rowClass,
          "transition-colors duration-150 hover:bg-app-stone-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={rowClass}>{body}</div>;
}

const FILTERS: { label: string; value: CallOutcomeFilter | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Missed", value: "missed" },
];

export function CallsView() {
  const [outcome, setOutcome] = useState<CallOutcomeFilter | undefined>(
    undefined,
  );
  const calls = useCalls(outcome);
  const rows = calls.data?.pages.flatMap((page) => page.data) ?? [];
  // #133: the log keeps working with the voice module off (history is
  // history), but forwarding + outbound calling don't — say so above the
  // list, once the module state has actually loaded (no flash while pending).
  // Member-visible module state (#133 review: GET /v1/billing/modules is
  // admin-only — members reading it 403'd and every member saw "module off").
  const company = useCompany();
  const voiceOff =
    company.data !== undefined &&
    !company.data.enabled_modules.includes("voice");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[17px] font-semibold text-app-ink">Calls</h1>
        {/* The inbox filter-bar segmented control, verbatim shape: a stone
            track with the lifted active pill. */}
        <div
          role="radiogroup"
          aria-label="Filter calls"
          className="flex gap-0.5 rounded-full bg-app-line-soft p-[3px] dark:bg-white/5"
        >
          {FILTERS.map((filter) => {
            const selected = outcome === filter.value;
            return (
              <button
                key={filter.label}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setOutcome(filter.value)}
                className={cn(
                  "rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors duration-150",
                  selected
                    ? "bg-app-white text-app-ink"
                    : "text-app-muted hover:text-app-ink",
                )}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      {voiceOff && rows.length > 0 && (
        <div className="rounded-app-card border border-app-line bg-app-white px-4 py-3 text-[12.5px] leading-relaxed text-app-muted">
          Calls land here, but calling is off — turn on the{" "}
          <Link
            href="/settings/billing"
            className="font-medium text-app-petrol-deep underline underline-offset-4 hover:no-underline"
          >
            Calling add-on
          </Link>{" "}
          to ring your cell and call customers back.
        </div>
      )}

      <section>
        <h2 className="flex items-baseline gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
          Recent calls
        </h2>
        <div className="overflow-hidden rounded-app-card border border-app-line bg-app-white">
          {calls.isPending ? (
            <div className="space-y-0">
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-[11px] border-b border-app-line-soft p-[11px] last:border-b-0"
                >
                  <Skeleton className="size-[38px] rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-36" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : calls.isError ? (
            <CalmEmptyState
              icon={<PhoneIncoming className="size-7" strokeWidth={1.5} />}
              title="Couldn't load your calls."
              description="Check your connection and try again."
              action={
                <Button variant="outline" onClick={() => calls.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <CalmEmptyState
              icon={<PhoneIncoming className="size-7" strokeWidth={1.5} />}
              title={
                outcome === "missed"
                  ? "No missed calls. Nice."
                  : "Calls to your business number will show up here."
              }
              description={
                outcome === "missed"
                  ? undefined
                  : "Turn on the Calling add-on or missed-call text-back and every call lands in this log and its conversation."
              }
              action={
                outcome === "missed" ? undefined : (
                  <Button asChild variant="outline">
                    <Link href="/settings/missed-calls">Set up calls</Link>
                  </Button>
                )
              }
            />
          ) : (
            <>
              {rows.map((call) => (
                <CallRow key={call.id} call={call} />
              ))}
            </>
          )}
        </div>
        {calls.hasNextPage && (
          <div className="flex justify-center pt-3">
            <Button
              variant="ghost"
              onClick={() => calls.fetchNextPage()}
              disabled={calls.isFetchingNextPage}
            >
              {calls.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
