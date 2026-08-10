"use client";

import { CheckCircle2, Circle, MessageSquare, PhoneIncoming } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { CalmEmptyState } from "@/components/settings/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT, type Translate } from "@/i18n/provider";
import {
  useContactTimeline,
  type TimelineEntry,
} from "@/lib/api/contact-timeline";
import { useMembers } from "@/lib/api/team";

/**
 * #324 — "what have we done for this customer?", answered by scrolling once.
 *
 * D7's threading rule means a long relationship is MANY conversations: a
 * customer returning after 31 days starts a new one, so a homeowner serviced
 * once a year for six years is six threads. The prior-conversations list (G6)
 * and the per-contact call history (#205) both already existed and are both
 * still right — but as SEPARATE BLOCKS, with tasks nowhere. The question asked
 * before every visit meant opening threads one at a time.
 *
 * DESIGN NOTES:
 *
 * **One stream, three row shapes.** The kinds are distinguished by icon and by
 * what the line says, not by separate lists — merging them is the entire point,
 * and grouping them back into sections would rebuild the problem.
 *
 * **Day headings, not per-row dates.** A relationship spans years, so the
 * reader is scanning for "when", and repeating a date on every row makes the
 * shape of the history harder to see rather than easier.
 *
 * **Jump-to-date is the same request as pagination.** The cursor is a
 * timestamp, so a date jump seeds the query rather than needing its own
 * endpoint. That is why the control is a plain date input and not a calendar
 * widget: it sets one bound and the existing paging does the rest.
 */
export function ContactTimeline({ contactId }: { contactId: string }) {
  const t = useT();
  const timeline = useContactTimeline(contactId);
  // #517: the roster, so an answered call can say who took it. Read here and
  // passed down rather than per row — one query for the page, not one per
  // call, and every early return below leaves the hook order intact.
  const members = useMembers();
  const entries = useMemo(
    () => (timeline.data?.pages ?? []).flatMap((page) => page.entries),
    [timeline.data],
  );
  const memberName = (userId: string | null): string | null =>
    userId
      ? (members.data?.data.find((m) => m.user_id === userId)?.display_name ??
        null)
      : null;

  if (timeline.isPending) {
    return (
      <Section>
        <div className="space-y-0" aria-label={t("contacts.historyLoading")}>
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="flex items-center gap-[11px] border-b border-app-line-soft p-[11px] last:border-b-0"
            >
              <Skeleton className="size-[38px] rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  if (timeline.isError) {
    return (
      <Section>
        <CalmEmptyState
          className="py-10"
          icon={<MessageSquare className="size-7" strokeWidth={1.5} />}
          title={t("contacts.historyLoadFailed")}
          description={t("contacts.historyLoadFailedDetail")}
        />
      </Section>
    );
  }

  if (entries.length === 0) {
    return (
      <Section>
        <CalmEmptyState
          className="py-10"
          icon={<MessageSquare className="size-7" strokeWidth={1.5} />}
          title={t("contacts.historyEmpty")}
          description={t("contacts.historyEmptyDetail")}
        />
      </Section>
    );
  }

  return (
    <Section showJump>
      <ol className="divide-y divide-app-line-soft">
        {groupByDay(entries).map(({ isoDay, label, rows }) => (
          <li key={isoDay}>
            {/* The jump target. Keyed by ISO day because that is what a
                <input type="date"> produces; the heading itself is localised. */}
            <h3
              data-timeline-day={isoDay}
              className="bg-app-tint px-[11px] py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2"
            >
              {label}
            </h3>
            <ol className="divide-y divide-app-line-soft">
              {rows.map((entry) => (
                <TimelineRow
                  key={`${entry.kind}:${entry.id}`}
                  entry={entry}
                  memberName={memberName}
                />
              ))}
            </ol>
          </li>
        ))}
      </ol>
      {timeline.hasNextPage ? (
        <div className="border-t border-app-line-soft p-2 text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void timeline.fetchNextPage()}
            disabled={timeline.isFetchingNextPage}
          >
            {timeline.isFetchingNextPage
              ? t("contacts.loading")
              : t("contacts.showEarlier")}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

function Section({
  children,
  showJump = false,
}: {
  children: React.ReactNode;
  /** Only with entries on screen: a date picker over nothing is furniture. */
  showJump?: boolean;
}) {
  const t = useT();
  return (
    <section>
      <h2 className="flex items-baseline gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
        {t("contacts.historyHeading")}
        {showJump ? <JumpToDate /> : null}
      </h2>
      <div className="overflow-hidden rounded-app-card border border-app-line bg-app-paper">
        {children}
      </div>
    </section>
  );
}

/**
 * The date jump. Scrolls to the first entry on or before the chosen day rather
 * than refetching: everything already loaded is in the DOM, and a jump that
 * discards it would make going back cost another round trip.
 */
function JumpToDate() {
  const t = useT();
  const [value, setValue] = useState("");
  return (
    <label className="ml-auto flex items-center gap-1.5 text-[11px] font-normal normal-case tracking-normal text-app-muted-2">
      <span className="sr-only">{t("contacts.jumpToDate")}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          if (!next) return;
          const target = document.querySelector<HTMLElement>(
            `[data-timeline-day="${next}"]`,
          );
          target?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        className="rounded-md border border-app-line bg-app-paper px-1.5 py-0.5 text-[11px]"
      />
    </label>
  );
}

function TimelineRow({
  entry,
  memberName,
}: {
  entry: TimelineEntry;
  memberName: (userId: string | null) => string | null;
}) {
  const t = useT();
  const body = (
    <div className="flex items-center gap-[11px] p-[11px]">
      <span className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-app-tint text-app-muted-2">
        <RowIcon entry={entry} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-app-ink">
          {rowTitle(entry, memberName, t)}
        </p>
        <p className="truncate text-xs text-app-muted-2">
          {rowDetail(entry, t)}
        </p>
      </div>
      <time
        className="shrink-0 text-xs tabular-nums text-app-muted-2"
        dateTime={entry.occurred_at}
      >
        {timeOf(entry.occurred_at)}
      </time>
    </div>
  );

  // A call that never threaded has nowhere to go, and a dead link is worse
  // than a plain row.
  return (
    <li>
      {entry.conversation_id ? (
        <Link
          href={`/inbox/${entry.conversation_id}`}
          className="block hover:bg-app-tint/60"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

function RowIcon({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === "call") {
    return <PhoneIncoming className="size-4" strokeWidth={1.75} />;
  }
  if (entry.kind === "task") {
    return entry.done ? (
      <CheckCircle2 className="size-4" strokeWidth={1.75} />
    ) : (
      <Circle className="size-4" strokeWidth={1.75} />
    );
  }
  return <MessageSquare className="size-4" strokeWidth={1.75} />;
}

function rowTitle(
  entry: TimelineEntry,
  memberName: (userId: string | null) => string | null,
  t: Translate,
): string {
  if (entry.kind === "task") return entry.detail ?? t("contacts.timelineJob");
  if (entry.kind === "call") {
    if (entry.status === "answered") {
      // #517: the same line the thread shows, so the two surfaces describing
      // one call never disagree. Falls back to the bare label when the
      // answerer is unknown or has left the crew — "Call answered by " with
      // nothing after it is worse than the label it replaced.
      const who = memberName(entry.answered_by_user_id ?? null);
      return who
        ? t("contacts.timelineCallAnsweredBy", { name: who })
        : t("contacts.timelineCallAnswered");
    }
    if (entry.status === "voicemail") return t("contacts.timelineVoicemail");
    return t("contacts.timelineMissedCall");
  }
  return t("contacts.timelineConversation");
}

function rowDetail(entry: TimelineEntry, t: Translate): string {
  if (entry.kind === "task") {
    if (entry.done) return t("contacts.timelineDone");
    return entry.due_at
      ? t("contacts.timelineDue", { date: dayOf(entry.due_at) })
      : t("contacts.timelineOpen");
  }
  if (entry.kind === "call") {
    const seconds = entry.talk_seconds ?? 0;
    // Talk time only, and only when there was any: "0:00" on a missed call
    // reads as a fault rather than as an absence.
    return seconds > 0
      ? t("contacts.timelineTalkedFor", { duration: minutes(seconds) })
      : t("contacts.timelineNoAnswer");
  }
  return t(
    entry.status === "closed" ? "contacts.timelineClosed" : "contacts.timelineOpen",
  );
}

function minutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

interface DayGroup {
  /** YYYY-MM-DD, in LOCAL time — what <input type="date"> emits. */
  isoDay: string;
  label: string;
  rows: TimelineEntry[];
}

/**
 * Day headings, newest first; the entries already arrive in that order.
 *
 * The key is the local calendar day rather than `occurred_at.slice(0, 10)`,
 * which would be the UTC day: an evening call in Vancouver falls on the next
 * UTC date, so a jump to the day the crew remembers would land on the wrong
 * heading, or on none.
 */
function groupByDay(entries: TimelineEntry[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const entry of entries) {
    const at = new Date(entry.occurred_at);
    const isoDay = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
    const existing = groups.get(isoDay);
    if (existing) {
      existing.rows.push(entry);
      continue;
    }
    groups.set(isoDay, {
      isoDay,
      label: at.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      rows: [entry],
    });
  }
  return [...groups.values()];
}
