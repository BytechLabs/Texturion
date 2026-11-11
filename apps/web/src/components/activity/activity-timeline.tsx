"use client";

import { ListSkeleton } from "@/components/ui/list-skeleton";
import {
  AtSign,
  Ban,
  CheckCircle2,
  Clock,
  GitMerge,
  Link2,
  MessageSquare,
  Pencil,
  Phone,
  Tag,
  Trash2,
  UserRound,
  Voicemail,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { SECTION_LABEL_CLASS } from "@/components/ui/section-label";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Timestamp } from "@/components/ui/timestamp";
import { type Translate, useT } from "@/i18n/provider";
import { flattenPages } from "@/lib/api/pagination";
import {
  useRecordActivity,
  type ActivityCategory,
  type ActivityItem,
  type ActivityRecordType,
} from "@/lib/api/record-activity";
import { useMembers } from "@/lib/api/team";
import { reducedMotionScrollBehavior } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { activityLine, type ActivityIcon } from "./activity-line";

/**
 * #714: the ONE timeline every record uses (a customer, a job, a thread, a
 * call). The server writes the rows, so this only reads them: a filter row
 * (All, Messages, Calls, Changes, applied by the server so paging stays right),
 * the date jump, and per row the sentence, who did it, when, and a link to the
 * source.
 *
 * `extraItems` lets a surface that has rows of its own in the same story (a
 * job's comments) fold them in by time, under All and Changes.
 * *Applying: Chunking (one list, four filters) and Zen of Clarity (an icon and
 * one sentence per row; detail in the tooltip of the time).*
 */
export interface ActivityExtraItem {
  id: string;
  occurred_at: string;
  node: React.ReactNode;
}

type Filter = "all" | ActivityCategory;

const FILTERS: { value: Filter; key: "filterAll" | "filterMessages" | "filterCalls" | "filterChanges" }[] = [
  { value: "all", key: "filterAll" },
  { value: "message", key: "filterMessages" },
  { value: "call", key: "filterCalls" },
  { value: "change", key: "filterChanges" },
];

const ICONS: Record<ActivityIcon, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  text: MessageSquare,
  call: Phone,
  voicemail: Voicemail,
  edit: Pencil,
  tag: Tag,
  person: UserRound,
  link: Link2,
  stop: Ban,
  check: CheckCircle2,
  merge: GitMerge,
  trash: Trash2,
  mention: AtSign,
  clock: Clock,
};

/** #725: who stands behind an automated change: the calendar sync, the repeat schedule, or just "Automation". */
function automationName(origin: unknown, t: Translate): string {
  if (origin === "calendar") return t("activity.originCalendar");
  if (origin === "repeat") return t("activity.originRepeat");
  return t("activity.actorAutomation");
}

type Entry =
  | { type: "event"; at: string; key: string; item: ActivityItem }
  | { type: "extra"; at: string; key: string; extra: ActivityExtraItem };

export function ActivityTimeline({
  recordType,
  recordId,
  extraItems,
  extraMore,
  oldestFirst = false,
  compact = false,
  hideHeading = false,
}: {
  recordType: ActivityRecordType;
  recordId: string;
  extraItems?: ActivityExtraItem[];
  /** The surface's own rows may have earlier pages too; "Show earlier" fetches them with ours. */
  extraMore?: { hasMore: boolean; fetching: boolean; fetch: () => void };
  /** A pinned composer under the list reads oldest to newest. */
  oldestFirst?: boolean;
  /** For a side panel: no card, tighter rows. */
  compact?: boolean;
  hideHeading?: boolean;
}) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const category = filter === "all" ? null : filter;
  const activity = useRecordActivity(recordType, recordId, category);
  const members = useMembers();
  const nameOf = (userId: string | null): string | null =>
    userId ? (members.data?.data.find((m) => m.user_id === userId)?.display_name ?? null) : null;

  const entries = useMemo<Entry[]>(() => {
    const events: Entry[] = flattenPages(activity.data).map((item) => ({
      type: "event",
      at: item.occurred_at,
      key: `e:${item.id}`,
      item,
    }));
    const extras: Entry[] =
      filter === "all" || filter === "change"
        ? (extraItems ?? []).map((extra) => ({
            type: "extra",
            at: extra.occurred_at,
            key: `x:${extra.id}`,
            extra,
          }))
        : [];
    const merged = [...events, ...extras].sort((a, b) => b.at.localeCompare(a.at));
    return oldestFirst ? merged.reverse() : merged;
  }, [activity.data, extraItems, filter, oldestFirst]);

  const moreExtra = (filter === "all" || filter === "change") && extraMore?.hasMore === true;
  const fetchingMore = activity.isFetchingNextPage || (moreExtra && extraMore?.fetching === true);
  const loadMore = activity.hasNextPage || moreExtra ? (
    <div className={cn("text-center", oldestFirst ? "pb-2" : "border-t border-app-line-soft p-2")}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          if (activity.hasNextPage) void activity.fetchNextPage();
          if (moreExtra) extraMore?.fetch();
        }}
        disabled={fetchingMore}
      >
        {fetchingMore ? t("activity.loadingMore") : t("activity.showEarlier")}
      </Button>
    </div>
  ) : null;

  let body: React.ReactNode;
  if (activity.isPending) {
    body = (
      <ListSkeleton
        rows={3}
        avatar
        lines={2}
        label={t("activity.loading")}
        className="p-3"
      />
    );
  } else if (activity.isError) {
    body = (
      <EmptyState
        className="py-8"
        icon={<MessageSquare className="size-7" strokeWidth={1.5} />}
        title={t("activity.loadFailed")}
        description={t("activity.loadFailedDetail")}
      />
    );
  } else if (entries.length === 0) {
    body = (
      <EmptyState
        className="py-8"
        icon={<MessageSquare className="size-7" strokeWidth={1.5} />}
        title={filter === "all" ? t("activity.empty") : t("activity.emptyFiltered")}
        description={filter === "all" ? t("activity.emptyDetail") : undefined}
      />
    );
  } else {
    body = (
      <>
        {oldestFirst ? loadMore : null}
        <ol>
          {groupByDay(entries, t.locale).map(({ isoDay, label, rows }) => (
            <li key={isoDay}>
              {/* The jump target, keyed by the local day an <input type="date"> emits. */}
              <h3
                data-timeline-day={isoDay}
                className={cn(SECTION_LABEL_CLASS, "bg-app-tint px-3 py-1.5")}
              >
                {label}
              </h3>
              <ol className="divide-y divide-app-line-soft">
                {rows.map((entry) =>
                  entry.type === "extra" ? (
                    <li key={entry.key} className="px-3 py-2.5">
                      {entry.extra.node}
                    </li>
                  ) : (
                    <ActivityRow
                      key={entry.key}
                      item={entry.item}
                      recordType={recordType}
                      recordId={recordId}
                      nameOf={nameOf}
                      compact={compact}
                    />
                  ),
                )}
              </ol>
            </li>
          ))}
        </ol>
        {oldestFirst ? null : loadMore}
      </>
    );
  }

  return (
    <section>
      {hideHeading ? null : (
        <h2 className={cn(SECTION_LABEL_CLASS, "flex items-baseline gap-2 px-1 pb-2")}>
          {t("activity.heading")}
          {entries.length > 0 ? <JumpToDate /> : null}
        </h2>
      )}
      <div role="group" aria-label={t("activity.filterAria")} className="flex flex-wrap gap-1.5 pb-2">
        {FILTERS.map((option) => (
          <ChoiceChip
            key={option.value}
            chosen={filter === option.value}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {t(`activity.${option.key}`)}
          </ChoiceChip>
        ))}
      </div>
      <div
        className={cn(
          "overflow-hidden",
          compact ? "" : "rounded-app-card border border-app-line bg-app-paper",
        )}
      >
        {body}
      </div>
    </section>
  );
}

function ActivityRow({
  item,
  recordType,
  recordId,
  nameOf,
  compact,
}: {
  item: ActivityItem;
  recordType: ActivityRecordType;
  recordId: string;
  nameOf: (userId: string | null) => string | null;
  compact: boolean;
}) {
  const t = useT();
  const line = activityLine(item, { t, recordType, recordId, nameOf });
  const Icon = ICONS[line.icon];
  const who =
    item.actor.type === "member"
      ? (item.actor.display_name ?? nameOf(item.actor.user_id) ?? t("activity.actorTeammate"))
      : item.actor.type === "customer"
        ? t("activity.actorCustomer")
        : item.actor.type === "automation"
          ? automationName(item.payload.origin, t)
          : t("activity.actorSystem");

  const content = (
    <div className={cn("flex items-center gap-3", compact ? "px-1 py-2" : "p-3")}>
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-app-tint text-app-muted-2">
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-app-ink [overflow-wrap:anywhere]">{line.text}</p>
        <p className="text-xs text-app-muted-2">
          {who} · <Timestamp at={item.occurred_at} style="long" />
        </p>
      </div>
    </div>
  );

  return (
    <li>
      {line.href ? (
        <Link href={line.href} className="block hover:bg-app-tint/60">
          {content}
        </Link>
      ) : (
        content
      )}
    </li>
  );
}

/**
 * The date jump: scrolls to the first loaded day on or before the chosen one
 * instead of refetching, so going back costs nothing.
 */
function JumpToDate() {
  const t = useT();
  const [value, setValue] = useState("");
  return (
    <label className="ml-auto flex items-center gap-1.5 text-[11px] font-normal normal-case tracking-normal text-app-muted-2">
      <span className="sr-only">{t("activity.jumpToDate")}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          if (!next) return;
          const days = [...document.querySelectorAll<HTMLElement>("[data-timeline-day]")];
          const target =
            days.find((day) => day.dataset.timelineDay === next) ??
            days.find((day) => (day.dataset.timelineDay ?? "") < next) ??
            days[days.length - 1];
          target?.scrollIntoView({ behavior: reducedMotionScrollBehavior(), block: "start" });
        }}
        className="rounded-md border border-app-line bg-app-paper px-1.5 py-0.5 text-base outline-none md:text-[11px] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring"
      />
    </label>
  );
}

interface DayGroup {
  /** YYYY-MM-DD in LOCAL time, which is what <input type="date"> emits. */
  isoDay: string;
  label: string;
  rows: Entry[];
}

/** Contiguous day groups in the order given. The key is the local day, not the UTC one. */
export function groupByDay(entries: Entry[], locale: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const at = new Date(entry.at);
    const isoDay = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
    const last = groups[groups.length - 1];
    if (last && last.isoDay === isoDay) {
      last.rows.push(entry);
      continue;
    }
    groups.push({
      isoDay,
      label: at.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }),
      rows: [entry],
    });
  }
  return groups;
}
