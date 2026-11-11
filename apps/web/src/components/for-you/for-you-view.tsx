"use client";

import { ArrowRight, Check, LayoutGrid, Plus, RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { NotificationBell } from "@/components/notifications/notification-bell";
import { SECTION_LABEL_CLASS } from "@/components/ui/section-label";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLeaveTransition } from "@/components/ui/motion";
import { undoableToast } from "@/components/ui/optimistic-undo";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDue } from "@/components/tasks/task-format";
import { useT } from "@/i18n/provider";
import { useCalls } from "@/lib/api/calls";
import { ApiError } from "@/lib/api/error";
import { useUpdateConversation } from "@/lib/api/conversations";
import {
  useCompleteForYouTask,
  useForYou,
  useSpamReview,
} from "@/lib/api/for-you";
import {
  useDashboardLayout,
  useHiddenPanels,
  useSetDashboardLayout,
  useSetHiddenPanels,
} from "@/lib/api/me-company";
import type {
  Call,
  ForYou,
  ForYouFollowUp,
  ForYouTask,
  ForYouTriageConversation,
  ForYouTriageTask,
  ForYouUnread,
  ForYouWaiting,
  SpamReviewItem,
} from "@/lib/api/types";
import { useTaskDrawer } from "@/components/tasks/use-task-drawer";
import { callOutcomeLabel } from "@/lib/format/call";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { Timestamp } from "@/components/ui/timestamp";
import { formatTimestamp } from "@/lib/format/time";
import { BentoLayout, type BentoEditing } from "@/components/for-you/bento-layout";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  PANEL_LABEL_KEYS,
  PANEL_NOTE_KEYS,
  PANEL_SIZE_KEYS,
} from "@/components/for-you/panel-catalogue";
import { OutstandingQuotesSection } from "@/components/for-you/outstanding-quotes-section";
import { Section } from "@/components/for-you/section";
import { LeadSourcesCard } from "@/components/for-you/lead-sources-card";
import { PipelineCard } from "@/components/for-you/pipeline-card";
import { ReferralAsk } from "@/components/for-you/referral-ask";
import { ResponseTimeCard } from "@/components/for-you/response-time-card";
import { SatisfactionCard } from "@/components/for-you/satisfaction-card";
import { WhileYouWait } from "@/components/for-you/while-you-wait";
import {
  addPanel,
  avatarInitials,
  DASHBOARD_PANEL_IDS,
  DASHBOARD_TILE_LABELS,
  type DashboardLayout,
  type DashboardPanelId,
  dashboardTiles,
  type DashboardTile,
  type DashboardTileId,
  defaultDashboardLayout,
  LAYOUT_PANEL_IDS,
  type LayoutPanelId,
  movePanel,
  movePanelTo,
  nextPanelSize,
  normaliseHiddenPanels,
  QUEUE_PANEL_IDS,
  removePanel,
  resizePanel,
} from "@loonext/shared";
import { cn } from "@/lib/utils";
import { LoadError } from "@/components/ui/load-error";

/** Open the shared command-K palette (the search glyph in the header). */
function openCommand() {
  window.dispatchEvent(new Event("loonext:open-command"));
}

/**
 * The WHY-IT'S-HERE line (PORTAL-UX §3.1): the concrete signal that placed a
 * card in the queue — "overdue task", "unread 2h", "waiting 3h" — never a
 * black-box score. This is what earns owner trust. Quiet by default; the
 * overdue signal takes the one warm mark.
 */
function Why({ text, warn }: { text: string; warn?: boolean }) {
  return (
    <span
      className={cn(
        "text-[11.5px]",
        warn ? "font-semibold text-app-clay" : "text-app-muted-2",
      )}
    >
      {text}
    </span>
  );
}

/** A flat single-tone avatar (petrol-tint bg, petrol-deep initials). */
function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-full bg-app-tint text-[12px] font-semibold text-app-olive-deep"
    >
      {avatarInitials(name)}
    </span>
  );
}

/** Shared card chrome: a calm row with a hairline divider and a hover fill. */
function Card({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-b border-app-line-soft px-4 py-3 transition-colors duration-150 ease-out last:border-b-0 hover:bg-app-hover"
    >
      {children}
      <ArrowRight
        className="size-4 shrink-0 text-app-muted-2"
        strokeWidth={1.75}
        aria-hidden
      />
    </Link>
  );
}

// --- Waiting on you — my open/waiting threads, urgency-sorted server-side. ---

function WaitingRow({ item }: { item: ForYouWaiting }) {
  const t = useT();
  const name = contactDisplayName(item.contact);
  const why = item.has_overdue_task
    ? t("inbox.forYouWhyOverdueTask")
    : item.unread
      ? t("inbox.forYouWhyUnread", {
          when: formatTimestamp(item.last_message_at, { style: "long", t }),
        })
      : t("inbox.forYouWhyWaiting", {
          when: formatTimestamp(item.last_message_at, { style: "long", t }),
        });
  return (
    <Card href={`/inbox/${item.conversation_id}`}>
      {item.unread && (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-app-olive" />
      )}
      <Avatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-app-ink">
          {name}
        </span>
        <span className="mt-0.5 block">
          <Why text={why} warn={item.has_overdue_task} />
        </span>
      </span>
    </Card>
  );
}

/**
 * #293 — a follow-up reminder that has come due.
 *
 * The row leads with the REASON, not the contact's last message time, because
 * that is what the member wrote down and the only thing that makes the card
 * actionable three days later: "chase the quote" is a job, "Chase this" is a
 * chore. Falls back to the naming the queue uses everywhere else when no
 * reason was given.
 *
 * `warn` is deliberately off. An overdue task is somebody late on their own
 * commitment; this is a customer who has not answered yet, which is ordinary.
 * Painting it as a problem would be the alert fatigue (#244) this whole feature
 * exists to reduce.
 */
function FollowUpRow({ item }: { item: ForYouFollowUp }) {
  const t = useT();
  const name = contactDisplayName(item.contact);
  const why = item.note
    ? t("inbox.forYouWhyFollowUpNote", {
        note: item.note,
        when: formatTimestamp(item.due_at, { style: "long", t }),
      })
    : t("inbox.forYouWhyNoReply", {
        when: formatTimestamp(item.last_message_at, { style: "long", t }),
      });
  return (
    <Card href={`/inbox/${item.conversation_id}`}>
      <Avatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-app-ink">
          {name}
        </span>
        <span className="mt-0.5 block">
          <Why text={why} />
        </span>
      </span>
    </Card>
  );
}

// --- My tasks — overdue/soon; inline complete (optimistic + undo). ---

function TaskRow({ task }: { task: ForYouTask }) {
  const t = useT();
  const { openTask } = useTaskDrawer();
  const complete = useCompleteForYouTask();
  // #11: play the 150ms slide+fade closure BEFORE the optimistic mutation
  // splices the row out, so a completed task leaves calmly instead of blinking
  // away. Reduced motion runs the mutation immediately (no in-between frames).
  const { leaving, leave } = useLeaveTransition();

  const onComplete = () => {
    leave(() =>
      complete.mutate(
        { task, done: true },
        {
          onError: (e) =>
            toast.error(
              e instanceof ApiError
                ? e.message
                : t("inbox.forYouTaskCompleteFailed"),
            ),
          onSuccess: () =>
            undoableToast({
              undoLabel: t("thread.undo"),
              message: t("inbox.forYouTaskCompleted"),
              onUndo: () =>
                complete.mutate(
                  { task, done: false },
                  {
                    onError: (e) =>
                      toast.error(
                        e instanceof ApiError
                          ? e.message
                          : t("inbox.forYouUndoFailed"),
                      ),
                  },
                ),
            }),
        },
      ),
    );
  };

  const why = task.overdue
    ? t("inbox.forYouWhyOverdueTask")
    : task.due_at
      ? t("inbox.forYouWhyDue", { when: formatDue(task.due_at, t) })
      : t("inbox.forYouWhyOpenTask");

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-app-line-soft px-4 py-3 transition-colors duration-150 ease-out last:border-b-0 hover:bg-app-hover",
        leaving && "app-motion-row-leave",
      )}
    >
      {/* A calm checkbox: hairline square → petrol-filled check on complete. */}
      <button
        type="button"
        onClick={onComplete}
        disabled={complete.isPending}
        aria-label={t("inbox.forYouCompleteTaskAria", { title: task.title })}
        className="tap-target grid size-[18px] shrink-0 place-items-center rounded-[6px] border-[1.6px] border-app-muted-2 transition-colors hover:border-app-olive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      {/* #113: the task title opens the TASK itself (the drawer) — this is the
          task queue, so the task is the point. The arrow is the secondary jump
          to its conversation. */}
      <button
        type="button"
        onClick={() => openTask(task.task_id)}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-[13.5px] font-semibold text-app-ink">
          {task.title}
        </span>
        <span className="mt-0.5 block">
          <Why text={why} warn={task.overdue} />
        </span>
      </button>
      {task.conversation_id !== null && (
        <Link
          href={`/inbox/${task.conversation_id}`}
          aria-label={t("inbox.forYouOpenConversationAria")}
          className="shrink-0 text-app-muted-2 transition-colors hover:text-app-ink"
        >
          <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
        </Link>
      )}
    </div>
  );
}

// --- Unread — my conversations with unread inbound. ---

function UnreadRow({ item }: { item: ForYouUnread }) {
  const t = useT();
  const name = contactDisplayName(item.contact);
  return (
    <Card href={`/inbox/${item.conversation_id}`}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-app-olive" />
      <Avatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-app-ink">
          {name}
        </span>
        <span className="mt-0.5 block">
          <Why
            text={t("inbox.forYouWhyUnread", {
              when: formatTimestamp(item.last_message_at, { style: "long", t }),
            })}
          />
        </span>
      </span>
    </Card>
  );
}

// --- Triage (owner/admin) — unassigned leads + tasks to dispatch. ---

function TriageConvRow({ item }: { item: ForYouTriageConversation }) {
  const t = useT();
  const name = contactDisplayName(item.contact);
  return (
    <Card href={`/inbox/${item.conversation_id}`}>
      {item.unread && (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-app-olive" />
      )}
      <Avatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-[13.5px] font-semibold text-app-ink">
            {name}
          </span>
          <span className="shrink-0 rounded-full bg-app-tint px-2 py-[2px] text-[10.5px] font-semibold text-app-olive-deep">
            {t("inbox.forYouNewLead")}
          </span>
        </span>
        <span className="mt-0.5 block">
          <Why text={formatTimestamp(item.last_message_at, { style: "long", t })} />
        </span>
      </span>
    </Card>
  );
}

function TriageTaskRow({ task }: { task: ForYouTriageTask }) {
  const t = useT();
  return (
    <Card
      href={
        // #718: a task row opens the task, not the thread it came from.
        `/tasks?task=${task.task_id}`
      }
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-app-ink">
          {task.title}
        </span>
        <span className="mt-0.5 block">
          <Why
            text={
              task.overdue
                ? t("inbox.forYouWhyUnassignedOverdue")
                : t("inbox.forYouWhyUnassignedTask")
            }
            warn={task.overdue}
          />
        </span>
      </span>
    </Card>
  );
}

// --- Recent calls (#133) — ambient call history, the mobile entry point to
// --- /calls. NEVER part of the queue: no header-count contribution, no
// --- effect on the caught-up card, no skeleton (it appears when data lands).

const RECENT_CALLS_LIMIT = 3;

/** Caller display, /calls vocabulary: name → formatted number → unknown. */
function recentCallerName(call: Call, unknown: string): string {
  if (call.contact_name) return call.contact_name;
  if (call.caller_e164) return formatPhone(call.caller_e164);
  return unknown;
}

function RecentCallRow({ call }: { call: Call }) {
  const t = useT();
  const name = recentCallerName(call, t("inbox.forYouUnknownCaller"));
  // The /calls accent rule (#64): INBOUND misses are the one warning-tinted
  // element; everything else (answered, voicemail, outbound) stays quiet.
  const missedInbound =
    call.outcome === "missed" && call.direction !== "outbound";
  return (
    <Card
      href={call.conversation_id ? `/inbox/${call.conversation_id}` : "/calls"}
    >
      <Avatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-[13.5px] font-semibold text-app-ink">
            {name}
          </span>
          <Timestamp
            at={call.started_at}
            style="short"
            className="shrink-0 text-[11.5px] text-app-muted-2"
          />
        </span>
        {/* #566: the same unbounded label as the /calls row, on a card that is
            narrower still. `callOutcomeLabel` renders "Answered by
            <display_name> · 4m 32s" and display_name is capped at 80 characters
            (routes/me.ts), so it wrapped here too. This row has no screening chip
            to displace, so the only symptom was a card that grew — which is why
            nobody reported it, and why it would have drifted back out of step
            with the row it was copied from. */}
        <span className="mt-0.5 flex min-w-0 items-center">
          {missedInbound ? (
            <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-warning/15 dark:text-warning">
              {callOutcomeLabel(call, t)}
            </span>
          ) : (
            <span
              className="min-w-0 truncate text-[11.5px] text-app-muted-2"
              title={callOutcomeLabel(call, t)}
            >
              {callOutcomeLabel(call, t)}
            </span>
          )}
        </span>
      </span>
    </Card>
  );
}

/**
 * The first three calls of the log's first page, in the Section/Card
 * vocabulary, capped by a quiet "View all calls" jump. Renders nothing until
 * there is at least one call — absence (while loading, on error, or with an
 * empty log) is the correct calm state for ambient history.
 */
function RecentCallsSection() {
  const t = useT();
  const calls = useCalls();
  const recent = (calls.data?.pages[0]?.data ?? []).slice(
    0,
    RECENT_CALLS_LIMIT,
  );
  if (recent.length === 0) return null;
  return (
    <Section label={t("inbox.forYouRecentCalls")}>
      {recent.map((call) => (
        <RecentCallRow key={call.id} call={call} />
      ))}
      <Link
        href="/calls"
        className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-[12.5px] font-medium text-app-muted transition-colors duration-150 ease-out hover:bg-app-hover hover:text-app-ink"
      >
        {t("inbox.forYouViewAllCalls")}
        <ArrowRight className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      </Link>
    </Section>
  );
}


/** A gentle 3-line skeleton for one section while the queue first loads. */
function SectionSkeleton() {
  return (
    <div>
      <Skeleton className="ml-1 mb-2 h-3 w-24" />
      <div className="overflow-hidden rounded-app-card border border-app-line bg-app-paper">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-app-line-soft px-4 py-3 last:border-b-0"
          >
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One count in the dashboard's summary strip. Quiet by default; a tile with
 * work in it lifts to white so the eye lands on it first. Not a control — the
 * sections below are where you act, and inventing navigation here would just
 * add a second way to do the same thing.
 */
/**
 * #540 — one tile of the summary strip.
 *
 * WAS a `div` holding a number and a label, in a fixed slot, doing nothing when
 * pressed. Three changes, each answering a word in the complaint:
 *
 *   dynamic     the strip's ORDER now comes from `dashboardTiles`, so the first
 *               tile is the thing to do first rather than whichever category
 *               happened to be written first.
 *   contextual  a count with no age is not a signal. "4 unread" is a different
 *               morning depending on whether the oldest is four minutes or four
 *               days old, so the tile says which.
 *   not amateur it is an anchor. The number that tells you where the work is now
 *               takes you to it.
 *
 * *Applying: Meaningful Highlights & Context — never a bare stat; pair it with
 * the thing to do about it.*
 */
function SummaryTile({
  tile,
  href,
}: {
  tile: DashboardTile;
  href: string;
}) {
  const t = useT();
  const active = tile.count > 0;
  const overdue = tile.signal?.kind === "overdue";
  // The one warm mark on the strip, spent on the only state that has actually
  // slipped. Everything else stays quiet — a strip where four things shout is a
  // strip that says nothing.
  const signal =
    tile.signal === null
      ? null
      : tile.signal.kind === "overdue"
        ? t("inbox.forYouTileOverdue", { count: tile.signal.count })
        : t("inbox.forYouTileOldest", {
            when: formatTimestamp(
              new Date(Date.now() - tile.signal.ageMillis).toISOString(),
              { style: "short", t },
            ),
          });

  const body = (
    <>
      <p
        className={cn(
          "text-[20px] font-semibold leading-none tabular-nums",
          active ? "text-app-ink" : "text-app-muted-2",
        )}
      >
        {tile.count}
      </p>
      <p className={cn(SECTION_LABEL_CLASS, "mt-1 truncate")}>
        {t(DASHBOARD_TILE_LABELS[tile.id])}
      </p>
      {/* Reserved whether or not there is a signal, so the tiles keep one height
          and the strip does not jump as items age past four hours. */}
      <p
        className={cn(
          "mt-0.5 h-4 truncate text-[11px]",
          overdue ? "font-semibold text-app-clay" : "text-app-muted-2",
        )}
      >
        {signal ?? ""}
      </p>
    </>
  );

  const shell = cn(
    "block rounded-app-card border px-3 py-2.5 text-left transition-colors",
    active
      ? "border-app-line bg-app-paper hover:bg-app-hover"
      : "border-transparent bg-app-inset",
  );

  // An empty tile is not a link. It keeps its place in the strip — "nothing
  // unassigned" is worth seeing — but sending somebody to an empty section is a
  // dead end dressed as an action.
  if (!active) {
    return (
      <div className={shell} aria-hidden={false}>
        {body}
      </div>
    );
  }
  return (
    <a
      href={href}
      className={cn(
        shell,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {body}
    </a>
  );
}

/**
 * /for-you — the triage home (PORTAL-UX §3.1), the DEFAULT landing. A single
 * scrollable stage of typed cards in labeled sections rendered from api_for_you:
 * Triage (owner/lead), Waiting on you, My tasks, Unread. Each card shows WHY it
 * is here (the concrete signal). The header carries a quiet sub-line, the bell,
 * and the search glyph (opens ⌘K). Calm empty state when the queue clears.
 * #133 adds an ambient "Recent calls" section below everything — history, not
 * workload, so it never touches the header count or the caught-up card.
 */
/**
 * The number of distinct things needing the reader, for the line above the
 * queue. Conversations are counted once however many sections carry them:
 * "waiting on you" and "unread" overlap by design, since the second is a
 * cross-cut of the first rather than a separate pile of work.
 *
 * #306: this counts the ROWS, and the rows are capped at the section limit, so
 * it is bounded by the page size rather than by the work — a member with 60
 * conversations waiting on them read "20 things need you". The server now
 * sends the real numbers; this stays as the fallback for a client running
 * ahead of the Worker, where an undercount is at least today's behaviour
 * rather than a new wrong answer.
 */
export function countDistinctWork(data: ForYou): number {
  const conversations = new Set<string>();
  for (const row of data.waiting_on_you) conversations.add(row.conversation_id);
  for (const row of data.unread) conversations.add(row.conversation_id);
  // #293: a due reminder is work. Leaving it out here made the header say
  // "You're all caught up" while a section below it listed a quote to chase —
  // the exact "the count lies in the other direction" this feature is about.
  // The Set is what keeps it honest when the same thread is also unread.
  for (const row of data.follow_ups ?? []) conversations.add(row.conversation_id);
  for (const row of data.triage?.conversations ?? []) {
    conversations.add(row.conversation_id);
  }
  const tasks = new Set<string>();
  for (const row of data.my_tasks) tasks.add(row.task_id);
  for (const row of data.triage?.tasks ?? []) tasks.add(row.task_id);
  return conversations.size + tasks.size;
}

/** #306: the honest headline, or the row-derived one if the server is older. */
export function headlineWork(data: ForYou): number {
  return data.totals?.distinct_work ?? countDistinctWork(data);
}

/**
 * #306 — the footer a section grows when it is showing a page of something
 * bigger. Without it the queue simply ends at twenty and reads as finished.
 *
 * It states the shape of the truncation ("20 of 63") rather than just offering
 * a link, because the number is the information: the reader needs to know how
 * far behind they are, which is the whole point of the issue.
 *
 * Applying: Meaningful Highlights (the count is context, not decoration) and
 * the repo's standing rule that a limited view says it is limited.
 */
function Overflow({
  shown,
  total,
  href,
  label,
}: {
  shown: number;
  total: number;
  href: string;
  label: string;
}) {
  const t = useT();
  if (total <= shown) return null;
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 border-t border-app-line-soft px-4 py-2.5 text-[12.5px] text-app-muted transition-colors duration-150 ease-out hover:bg-app-hover"
    >
      <span>
        {t("inbox.forYouOverflowShowing", { shown })}
        <span className="tabular-nums">{total}</span>
        {t("inbox.forYouOverflowLabel", { label })}
      </span>
      <ArrowRight className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
    </Link>
  );
}

export function ForYouView() {
  const t = useT();
  const forYou = useForYou();

  // How many THINGS need you, not how many rows are on screen. The unread
  // section is a cross-cut, so a thread assigned to you that nobody has read
  // appears there and under "waiting on you" as well. Adding the sections up
  // counted that thread twice and reported more work than there was.
  //
  // #306: and not how many rows the SERVER sent either — that was capped at 20,
  // so the busiest crews were told they were the least busy.
  const total = forYou.data ? headlineWork(forYou.data) : 0;
  // #736: arranging the page is a mode, entered and left from the header.
  const [editing, setEditing] = useState(false);

  // #540: the strip, ordered by what to do first and carrying the age that makes
  // a count mean something.
  //
  // The COUNTS come from `totals` where the Worker sent them, because the rows are
  // one page of a section and a strip reporting 20 for a crew with 300 is the bug
  // #306 fixed in the headings. The SIGNAL comes from the rows, which is the
  // honest limit of it: the oldest row we were given is not necessarily the oldest
  // in the section, so an under-report is possible and an over-report is not. A
  // signal that is never worse than the truth is the right direction for one that
  // decides where somebody looks first.
  const strip = useMemo(() => {
    const data = forYou.data;
    if (!data) return [];
    const now = Date.now();
    const age = (iso: string) => Math.max(0, now - new Date(iso).getTime());
    const ordered = dashboardTiles({
      unassignedAgesMillis: [
        ...(data.triage?.conversations ?? []).map((row) => age(row.last_message_at)),
        // A triage task has no timestamp of its own on this payload, so it counts
        // towards the number without claiming an age it cannot support.
        ...(data.triage?.tasks ?? []).map(() => 0),
      ],
      waiting: data.waiting_on_you.map((row) => ({
        ageMillis: age(row.last_message_at),
        overdue: row.has_overdue_task,
      })),
      tasks: data.my_tasks.map((row) => ({
        ageMillis: row.due_at ? age(row.due_at) : null,
        overdue: row.overdue,
      })),
      unreadAgesMillis: data.unread.map((row) => age(row.last_message_at)),
    });
    // Swap the row-derived counts for the section totals where we have them.
    const counts: Record<string, number> = {
      unassigned:
        (data.totals?.triage_conversations ?? data.triage?.conversations.length ?? 0) +
        (data.totals?.triage_tasks ?? data.triage?.tasks.length ?? 0),
      waiting: data.totals?.waiting_on_you ?? data.waiting_on_you.length,
      tasks: data.totals?.my_tasks ?? data.my_tasks.length,
      unread: data.totals?.unread ?? data.unread.length,
    };
    return ordered.map((tile) => ({ ...tile, count: counts[tile.id] ?? tile.count }));
  }, [forYou.data]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8 lg:max-w-5xl xl:max-w-7xl">
      <PageHeader
        className="mb-6"
        title={t("inbox.forYouTitle")}
        description={
          total > 0
            ? t(total === 1 ? "inbox.forYouWorkOne" : "inbox.forYouWorkMany", { count: total })
            : t("inbox.forYouAllCaughtUp")
        }
        secondary={
          <>
            {/* Desktop hosts search + bell in the top bar; keep those two here
                only on mobile (which has no top bar) so they aren't duplicated
                on lg+. */}
            <button
              type="button"
              onClick={openCommand}
              aria-label={t("inbox.forYouSearchAria")}
              aria-keyshortcuts="Meta+K Control+K"
              className="grid size-8 place-items-center rounded-[9px] border border-app-line bg-app-paper text-app-muted transition-colors hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            >
              <Search className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
            <span className="lg:hidden">
              <NotificationBell />
            </span>
            {/* #736: arranging the page belongs to this screen, so it stays at
                every width. Outline: For you has no main action of its own. */}
            {forYou.data && (
              <Button
                variant={editing ? "default" : "outline"}
                size="sm"
                aria-pressed={editing}
                onClick={() => setEditing((on) => !on)}
              >
                <LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden />
                {editing ? t("inbox.forYouDoneEditing") : t("inbox.forYouEditLayout")}
              </Button>
            )}
          </>
        }
      />

      {/* #310: only while the carriers have it. Above the queue because during
          the wait the queue is empty by definition — texting is the thing that
          fills it, and that is exactly what has not started yet. */}
      <div className="mb-6">
        <WhileYouWait />
      </div>

      {/* The dashboard's summary strip: where the work is, before you read a
          single card. Hidden while loading and when the queue is empty, where
          the caught-up card already says everything. */}
      {/* #540: the summary strip. Its ORDER is decided by `dashboardTiles`, so
          the first tile is the thing to do first — the previous version was four
          fixed slots that looked the same whatever was happening. Hidden while
          loading and when the queue is empty, where the caught-up card already
          says everything. */}
      {forYou.data && total > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {strip.map((tile) => (
            <SummaryTile
              key={tile.id}
              tile={tile}
              href={`#for-you-${tile.id}`}
            />
          ))}
        </div>
      )}

      {forYou.isError ? (
        <LoadError message={t("inbox.forYouLoadFailed")} onRetry={() => void forYou.refetch()} />
      ) : forYou.isPending ? (
        <div className="space-y-7">
          <SectionSkeleton />
          <SectionSkeleton />
        </div>
      ) : (
        <ForYouSections
          data={forYou.data}
          order={strip.map((tile) => tile.id)}
          editing={editing}
        />
      )}
    </div>
  );
}

/**
 * #342 — spam marks that do not look like spam.
 *
 * A spam-marked thread appends silently, never notifies, and is frozen at the
 * moment it was marked, so it sinks in every list including the spam filter
 * itself. For a robotexter that is the point. For a mis-tap it means the
 * customer keeps texting and the business believes they stopped.
 *
 * This strip is the evidence, and it renders NOTHING on almost every day — it
 * lists only the threads whose activity does not look like spam, because a
 * review list full of robotexters is the noise the silence exists to remove.
 * No badge, no push, no count anywhere else: a signal you find, not one that
 * finds you.
 *
 * Applying: Meaningful Highlights (the row says why it is here, not just that
 * it is), Loss Aversion (the framing is the customer you are about to lose).
 */
function SpamReviewSection() {
  const t = useT();
  const review = useSpamReview();
  const items = review.data?.data ?? [];
  if (items.length === 0) return null;

  return (
    <Section label={t("inbox.forYouSectionSpamReview")} count={items.length}>
      {items.map((item) => (
        <SpamReviewRow key={item.conversation_id} item={item} />
      ))}
    </Section>
  );
}

function SpamReviewRow({ item }: { item: SpamReviewItem }) {
  const t = useT();
  const update = useUpdateConversation(item.conversation_id);
  const name = contactDisplayName(item.contact);

  // Say which signal raised it. "4 messages since" alone reads as a counter;
  // "you texted them before marking this" reads as the mistake it probably is.
  const why = item.we_texted_them
    ? t("inbox.forYouSpamWhyTexted")
    : item.sustained
      ? t("inbox.forYouSpamWhySustained", {
          when: formatTimestamp(item.last_inbound_at, { style: "long", t }),
        })
      : t("inbox.forYouSpamWhyCount", { count: item.inbound_since });

  return (
    <div className="flex items-center gap-3 border-b border-app-line-soft px-4 py-3 last:border-b-0">
      <Avatar name={name} />
      <Link
        href={`/inbox/${item.conversation_id}`}
        className="min-w-0 flex-1 transition-opacity duration-150 ease-out hover:opacity-80"
      >
        <span className="block truncate text-[13.5px] font-semibold text-app-ink">
          {name}
        </span>
        <span className="mt-0.5 block">
          <Why text={why} warn={item.we_texted_them} />
        </span>
      </Link>
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 px-2 text-xs"
        disabled={update.isPending}
        onClick={() =>
          update.mutate(
            { is_spam: false },
            {
              onSuccess: () => toast.success(t("inbox.forYouBackInInbox")),
              onError: (e) =>
                toast.error(
                  e instanceof ApiError
                    ? e.message
                    : t("inbox.forYouUndoMarkFailed"),
                ),
            },
          )
        }
      >
        {t("inbox.forYouNotSpam")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 text-xs text-app-muted"
        disabled={update.isPending}
        onClick={() =>
          update.mutate(
            { spam_reviewed: true },
            {
              // Not a toast worth celebrating — it says "nothing changed",
              // which is exactly what happened.
              onSuccess: () => toast.success(t("inbox.forYouLeftAsSpam")),
              onError: (e) =>
                toast.error(
                  e instanceof ApiError
                    ? e.message
                    : t("inbox.forYouSaveFailed"),
                ),
            },
          )
        }
      >
        {t("inbox.forYouStillSpam")}
      </Button>
    </div>
  );
}

/** #540's hidden set is still honoured for the five panels the phones can put away. */
function isHideablePanel(id: LayoutPanelId): id is DashboardPanelId {
  return (DASHBOARD_PANEL_IDS as readonly string[]).includes(id);
}

/**
 * The calm, kind empty state (PORTAL-UX §3.1 / §6): every queue is clear. The
 * measures and the call history still show below it, because a caught-up
 * morning is the best moment to look at how the business is doing (#540).
 */
function CaughtUpCard() {
  const t = useT();
  return (
    <div className="rounded-app-card border border-app-line bg-app-paper">
      <EmptyState
        icon={<Check strokeWidth={1.75} />}
        title={t("inbox.forYouAllCaughtUp")}
        description={t("inbox.forYouNewLeadsHere")}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/inbox">{t("inbox.forYouOpenInbox")}</Link>
          </Button>
        }
      />
    </div>
  );
}

/**
 * #736: a queue taken off the page that still has work in it. Taking a panel
 * away is the member's choice; a customer nobody answered going quiet is not,
 * so the count stays on the page and one tap puts the panel back.
 */
function OffPageWork({
  items,
  onShow,
}: {
  items: readonly { id: LayoutPanelId; count: number }[];
  onShow: (id: LayoutPanelId) => void;
}) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <ul className="divide-y divide-app-line-soft rounded-app-card border border-app-line bg-app-paper">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[13px] text-app-ink">
            {t("inbox.forYouHiddenQueue", {
              panel: t(PANEL_LABEL_KEYS[item.id]),
              count: item.count,
            })}
          </span>
          <Button variant="outline" size="sm" onClick={() => onShow(item.id)}>
            {t("inbox.forYouShowPanel")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** #736: what arranging the page offers beyond each panel's own controls. */
function LayoutToolbar({
  addable,
  onAdd,
  onReset,
}: {
  addable: readonly LayoutPanelId[];
  onAdd: (id: LayoutPanelId) => void;
  onReset: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-app-card border border-dashed border-app-line bg-app-inset px-4 py-3">
      <p className="mr-auto min-w-0 text-[13px] text-app-muted">{t("inbox.forYouEditingHint")}</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
            {t("inbox.forYouAddPanel")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {addable.length === 0 ? (
            <DropdownMenuItem disabled>{t("inbox.forYouAddPanelNone")}</DropdownMenuItem>
          ) : (
            addable.map((id) => (
              <DropdownMenuItem key={id} onSelect={() => onAdd(id)} className="flex-col items-start gap-0.5">
                <span className="text-[13px] font-medium text-app-ink">{t(PANEL_LABEL_KEYS[id])}</span>
                <span className="text-[12px] text-app-muted">{t(PANEL_NOTE_KEYS[id])}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" onClick={onReset}>
        <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden />
        {t("inbox.forYouResetLayout")}
      </Button>
    </div>
  );
}

function ForYouSections({
  data,
  order,
  editing,
}: {
  data: ForYou;
  /** #540: the urgency order, which the default layout follows. */
  order: readonly DashboardTileId[];
  /** #736: the member is arranging the page. */
  editing: boolean;
}) {
  const t = useT();
  // Read off the /v1/me payload the shell already holds, so the page is laid
  // out before it paints rather than rearranged after.
  const hidden = useHiddenPanels();
  const stored = useDashboardLayout();
  const saveLayout = useSetDashboardLayout();
  const saveHidden = useSetHiddenPanels();
  const [announcement, setAnnouncement] = useState("");

  const { waiting_on_you, my_tasks, unread, triage } = data;
  // #293: absent from an older Worker, which is "no reminders".
  const followUps = data.follow_ups ?? [];
  // #306: the heading count is what the section HOLDS; the rows are a page of it.
  const totals = data.totals;
  const waitingTotal = totals?.waiting_on_you ?? waiting_on_you.length;
  const tasksTotal = totals?.my_tasks ?? my_tasks.length;
  const unreadTotal = totals?.unread ?? unread.length;
  const triageConvTotal = totals?.triage_conversations ?? triage?.conversations.length ?? 0;
  const triageTaskTotal = totals?.triage_tasks ?? triage?.tasks.length ?? 0;
  const triageCount = triageConvTotal + triageTaskTotal;
  const followUpTotal = totals?.follow_ups ?? followUps.length;

  const queuesEmpty =
    followUps.length === 0 &&
    waiting_on_you.length === 0 &&
    my_tasks.length === 0 &&
    unread.length === 0 &&
    triageCount === 0;

  const layout = stored ?? defaultDashboardLayout(order);
  const entries = layout.panels.filter((entry) => !(isHideablePanel(entry.id) && hidden.includes(entry.id)));
  const onPage = new Set(entries.map((entry) => entry.id));

  const queueCounts: Partial<Record<LayoutPanelId, number>> = {
    follow_ups: followUps.length > 0 ? followUpTotal : 0,
    unassigned: triageCount,
    waiting: waiting_on_you.length > 0 ? waitingTotal : 0,
    tasks: my_tasks.length > 0 ? tasksTotal : 0,
    unread: unread.length > 0 ? unreadTotal : 0,
  };
  const offPage = QUEUE_PANEL_IDS.filter((id) => !onPage.has(id) && (queueCounts[id] ?? 0) > 0).map(
    (id) => ({ id, count: queueCounts[id] ?? 0 }),
  );

  const name = (id: LayoutPanelId) => t(PANEL_LABEL_KEYS[id]);
  const commit = (next: DashboardLayout, message: string) => {
    saveLayout.mutate(next);
    setAnnouncement(message);
  };
  const moved = (next: DashboardLayout, id: LayoutPanelId) =>
    commit(
      next,
      t("inbox.forYouPanelMoved", {
        panel: name(id),
        position: next.panels.findIndex((entry) => entry.id === id) + 1,
        count: next.panels.length,
      }),
    );
  const show = (id: LayoutPanelId) => {
    if (!layout.panels.some((entry) => entry.id === id)) {
      commit(addPanel(layout, id), t("inbox.forYouPanelAdded", { panel: name(id) }));
    } else {
      setAnnouncement(t("inbox.forYouPanelAdded", { panel: name(id) }));
    }
    if (isHideablePanel(id) && hidden.includes(id)) {
      saveHidden.mutate(hidden.filter((panel) => panel !== id));
    }
  };
  const editingHandlers: BentoEditing = {
    onMove: (id, delta) => moved(movePanel(layout, id, delta), id),
    onMoveTo: (id, target) => moved(movePanelTo(layout, id, target), id),
    onResize: (id) => {
      const current = layout.panels.find((entry) => entry.id === id);
      if (!current) return;
      const size = nextPanelSize(current.size);
      commit(
        resizePanel(layout, id, size),
        t("inbox.forYouPanelResized", { panel: name(id), size: t(PANEL_SIZE_KEYS[size]) }),
      );
    },
    onRemove: (id) => {
      commit(removePanel(layout, id), t("inbox.forYouPanelRemoved", { panel: name(id) }));
      // The phones still read the hidden set, so they put it away too.
      if (isHideablePanel(id) && !hidden.includes(id)) {
        saveHidden.mutate(normaliseHiddenPanels([...hidden, id]));
      }
    },
  };

  const panels: Record<LayoutPanelId, React.ReactNode> = {
    // #293: only ever here because the member asked to be reminded.
    follow_ups: followUps.length > 0 && (
      <Section label={t("inbox.forYouSectionChaseThese")} count={followUpTotal}>
        {followUps.map((item) => (
          <FollowUpRow key={item.conversation_id} item={item} />
        ))}
      </Section>
    ),
    unassigned: triageCount > 0 && (
      <Section id="for-you-unassigned" label={t("inbox.forYouSectionUnassigned")} count={triageCount}>
        {triage?.conversations.map((item) => (
          <TriageConvRow key={item.conversation_id} item={item} />
        ))}
        {/* Two kinds of thing under one heading, so two footers: one "view
            all" cannot land a reader on the rows they are missing when only
            the other half is truncated. */}
        <Overflow
          shown={triage?.conversations.length ?? 0}
          total={triageConvTotal}
          href="/inbox"
          label={t("inbox.forYouOverflowUnassignedConversations")}
        />
        {triage?.tasks.map((task) => (
          <TriageTaskRow key={task.task_id} task={task} />
        ))}
        <Overflow
          shown={triage?.tasks.length ?? 0}
          total={triageTaskTotal}
          href="/tasks"
          label={t("inbox.forYouOverflowAllTasks")}
        />
      </Section>
    ),
    waiting: waiting_on_you.length > 0 && (
      <Section id="for-you-waiting" label={t("inbox.forYouSectionWaiting")} count={waitingTotal}>
        {waiting_on_you.map((item) => (
          <WaitingRow key={item.conversation_id} item={item} />
        ))}
        {/* /inbox?assignee=me is a SUPERSET of this section, so the link is a
            place to continue, not "the other 43". */}
        <Overflow
          shown={waiting_on_you.length}
          total={waitingTotal}
          href="/inbox?assignee=me"
          label={t("inbox.forYouOverflowRestInInbox")}
        />
      </Section>
    ),
    tasks: my_tasks.length > 0 && (
      <Section id="for-you-tasks" label={t("inbox.forYouSectionTasks")} count={tasksTotal}>
        {my_tasks.map((task) => (
          <TaskRow key={task.task_id} task={task} />
        ))}
        {/* Bare /tasks is List · Open · Mine, the exact match for this section. */}
        <Overflow
          shown={my_tasks.length}
          total={tasksTotal}
          href="/tasks"
          label={t("inbox.forYouOverflowOpenTasks")}
        />
      </Section>
    ),
    unread: unread.length > 0 && (
      <Section id="for-you-unread" label={t("inbox.forYouSectionUnread")} count={unreadTotal}>
        {unread.map((item) => (
          <UnreadRow key={item.conversation_id} item={item} />
        ))}
        <Overflow
          shown={unread.length}
          total={unreadTotal}
          href="/inbox?assignee=me&unread=true"
          label={t("inbox.forYouOverflowRestInInbox")}
        />
      </Section>
    ),
    // #287: money a customer was asked for and has not answered.
    outstanding_quotes: <OutstandingQuotesSection />,
    recent_calls: <RecentCallsSection />,
    // #239: the claim we sell, measured.
    response_time: <ResponseTimeCard />,
    // #354: absent entirely until there is something true to say.
    pipeline: <PipelineCard />,
    // #313: whether the answers landed, beside how fast they came.
    satisfaction: <SatisfactionCard />,
    // #301: where customers came from, the slower question.
    lead_sources: <LeadSourcesCard />,
  };

  return (
    <div className="space-y-6">
      {/* #342: the one strip whose absence is the whole problem it solves;
          read before anything else. */}
      <SpamReviewSection />
      {queuesEmpty && <CaughtUpCard />}
      <OffPageWork items={offPage} onShow={show} />
      {editing && (
        <LayoutToolbar
          addable={LAYOUT_PANEL_IDS.filter((id) => !onPage.has(id))}
          onAdd={show}
          onReset={() => {
            saveLayout.mutate(null);
            if (hidden.length > 0) saveHidden.mutate([]);
          }}
        />
      )}
      <BentoLayout
        cells={entries.map((entry) => ({ id: entry.id, size: entry.size, node: panels[entry.id] }))}
        editing={editing ? editingHandlers : undefined}
      />
      {/* #288: after the work and the owner's own results, so the ask lands
          as earned rather than as an interruption. */}
      <ReferralAsk />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
