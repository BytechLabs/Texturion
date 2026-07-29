"use client";

import { ArrowRight, Check, Search } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { avatarInitials } from "@/components/shell/avatar-color";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { useLeaveTransition } from "@/components/ui/motion";
import { undoableToast } from "@/components/ui/optimistic-undo";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDue } from "@/components/tasks/task-format";
import { useCalls } from "@/lib/api/calls";
import { ApiError } from "@/lib/api/error";
import { useUpdateConversation } from "@/lib/api/conversations";
import {
  useCompleteForYouTask,
  useForYou,
  useSpamReview,
} from "@/lib/api/for-you";
import type {
  Call,
  ForYou,
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
import { formatRelativeTime } from "@/lib/format/time";
import { WhileYouWait } from "@/components/for-you/while-you-wait";
import { cn } from "@/lib/utils";

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
      className="grid size-9 shrink-0 place-items-center rounded-full bg-app-tint text-[12px] font-semibold text-app-petrol-deep"
    >
      {avatarInitials(name)}
    </span>
  );
}

/** A labeled section: small uppercase label + count, then the calm card list.
 *  `count` is omitted for ambient sections (Recent calls) — a history count
 *  is not a workload number. */
function Section({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="flex items-baseline gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
        {label}
        {count !== undefined && count > 0 && (
          <span className="tabular-nums">{count}</span>
        )}
      </h2>
      <div className="overflow-hidden rounded-app-card border border-app-line bg-app-white">
        {children}
      </div>
    </section>
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
  const name = contactDisplayName(item.contact);
  const why = item.has_overdue_task
    ? "Overdue task"
    : item.unread
      ? `Unread · ${formatRelativeTime(item.last_message_at)}`
      : `Waiting · ${formatRelativeTime(item.last_message_at)}`;
  return (
    <Card href={`/inbox/${item.conversation_id}`}>
      {item.unread && (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-app-petrol" />
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

// --- My tasks — overdue/soon; inline complete (optimistic + undo). ---

function TaskRow({ task }: { task: ForYouTask }) {
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
              e instanceof ApiError ? e.message : "Couldn't complete the task.",
            ),
          onSuccess: () =>
            undoableToast({
              message: "Task completed",
              onUndo: () =>
                complete.mutate(
                  { task, done: false },
                  {
                    onError: (e) =>
                      toast.error(
                        e instanceof ApiError ? e.message : "Couldn't undo.",
                      ),
                  },
                ),
            }),
        },
      ),
    );
  };

  const why = task.overdue
    ? "Overdue task"
    : task.due_at
      ? // formatDue (forward-looking: Today / Tomorrow / MMM d), NOT
        // formatRelativeTime — the latter is an ELAPSED-time helper for PAST
        // timestamps, so a future due_at collapsed to "Due now" for every task.
        `Due ${formatDue(task.due_at)}`
      : "Open task";

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
        aria-label={`Complete task: ${task.title}`}
        className="tap-target grid size-[18px] shrink-0 place-items-center rounded-[6px] border-[1.6px] border-app-muted-2 transition-colors hover:border-app-petrol focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
      <Link
        href={`/inbox/${task.conversation_id}`}
        aria-label="Open conversation"
        className="shrink-0 text-app-muted-2 transition-colors hover:text-app-ink"
      >
        <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
      </Link>
    </div>
  );
}

// --- Unread — my conversations with unread inbound. ---

function UnreadRow({ item }: { item: ForYouUnread }) {
  const name = contactDisplayName(item.contact);
  return (
    <Card href={`/inbox/${item.conversation_id}`}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-app-petrol" />
      <Avatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-app-ink">
          {name}
        </span>
        <span className="mt-0.5 block">
          <Why text={`Unread · ${formatRelativeTime(item.last_message_at)}`} />
        </span>
      </span>
    </Card>
  );
}

// --- Triage (owner/admin) — unassigned leads + tasks to dispatch. ---

function TriageConvRow({ item }: { item: ForYouTriageConversation }) {
  const name = contactDisplayName(item.contact);
  return (
    <Card href={`/inbox/${item.conversation_id}`}>
      {item.unread && (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-app-petrol" />
      )}
      <Avatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-[13.5px] font-semibold text-app-ink">
            {name}
          </span>
          <span className="shrink-0 rounded-full bg-app-tint px-2 py-[2px] text-[10.5px] font-semibold text-app-petrol-deep">
            New lead
          </span>
        </span>
        <span className="mt-0.5 block">
          <Why text={formatRelativeTime(item.last_message_at)} />
        </span>
      </span>
    </Card>
  );
}

function TriageTaskRow({ task }: { task: ForYouTriageTask }) {
  return (
    <Card href={`/inbox/${task.conversation_id}`}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-app-ink">
          {task.title}
        </span>
        <span className="mt-0.5 block">
          <Why
            text={task.overdue ? "Unassigned · overdue" : "Unassigned task"}
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
function recentCallerName(call: Call): string {
  if (call.contact_name) return call.contact_name;
  if (call.caller_e164) return formatPhone(call.caller_e164);
  return "Unknown caller";
}

function RecentCallRow({ call }: { call: Call }) {
  const name = recentCallerName(call);
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
          <span className="shrink-0 text-[11.5px] tabular-nums text-app-muted-2">
            {formatRelativeTime(call.started_at)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center">
          {missedInbound ? (
            <span className="inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-warning/15 dark:text-warning">
              {callOutcomeLabel(call)}
            </span>
          ) : (
            <span className="text-[11.5px] text-app-muted-2">
              {callOutcomeLabel(call)}
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
  const calls = useCalls();
  const recent = (calls.data?.pages[0]?.data ?? []).slice(
    0,
    RECENT_CALLS_LIMIT,
  );
  if (recent.length === 0) return null;
  return (
    <Section label="Recent calls">
      {recent.map((call) => (
        <RecentCallRow key={call.id} call={call} />
      ))}
      <Link
        href="/calls"
        className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-[12.5px] font-medium text-app-muted transition-colors duration-150 ease-out hover:bg-app-hover hover:text-app-ink"
      >
        View all calls
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
      <div className="overflow-hidden rounded-app-card border border-app-line bg-app-white">
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
function SummaryTile({ label, count }: { label: string; count: number }) {
  const active = count > 0;
  return (
    <div
      className={cn(
        "rounded-app-card border px-3 py-2.5",
        active
          ? "border-app-line bg-app-white"
          : "border-transparent bg-app-stone-1",
      )}
    >
      <p
        className={cn(
          "text-[20px] font-semibold leading-none tabular-nums",
          active ? "text-app-ink" : "text-app-muted-2",
        )}
      >
        {count}
      </p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.06em] text-app-muted-2">
        {label}
      </p>
    </div>
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
  if (total <= shown) return null;
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 border-t border-app-line-soft px-4 py-2.5 text-[12.5px] text-app-muted transition-colors duration-150 ease-out hover:bg-app-hover"
    >
      <span>
        Showing {shown} of <span className="tabular-nums">{total}</span> ·{" "}
        {label}
      </span>
      <ArrowRight className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
    </Link>
  );
}

export function ForYouView() {
  const forYou = useForYou();

  // How many THINGS need you, not how many rows are on screen. The unread
  // section is a cross-cut, so a thread assigned to you that nobody has read
  // appears there and under "waiting on you" as well. Adding the sections up
  // counted that thread twice and reported more work than there was.
  //
  // #306: and not how many rows the SERVER sent either — that was capped at 20,
  // so the busiest crews were told they were the least busy.
  const total = forYou.data ? headlineWork(forYou.data) : 0;
  const totals = forYou.data?.totals;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8 lg:max-w-5xl">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-app-ink">
            For you
          </h1>
          <p className="mt-1 text-[13px] text-app-muted">
            {total > 0
              ? `${total} ${total === 1 ? "thing needs" : "things need"} you · you're all caught up otherwise`
              : "You're all caught up."}
          </p>
        </div>
        {/* Desktop hosts search + bell in the top bar; keep them here only on
            mobile (which has no top bar) so they aren't duplicated on lg+. */}
        <div className="flex items-center gap-1 pt-0.5 lg:hidden">
          <button
            type="button"
            onClick={openCommand}
            aria-label="Search"
            aria-keyshortcuts="Meta+K Control+K"
            className="grid size-8 place-items-center rounded-[9px] border border-app-line bg-app-white text-app-muted transition-colors hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="size-[15px]" strokeWidth={1.9} aria-hidden />
          </button>
          <NotificationBell />
        </div>
      </header>

      {/* #310: only while the carriers have it. Above the queue because during
          the wait the queue is empty by definition — texting is the thing that
          fills it, and that is exactly what has not started yet. */}
      <div className="mb-6">
        <WhileYouWait />
      </div>

      {/* The dashboard's summary strip: where the work is, before you read a
          single card. Hidden while loading and when the queue is empty, where
          the caught-up card already says everything. */}
      {forYou.data && total > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryTile
            label="Unassigned"
            count={
              totals
                ? totals.triage_conversations + totals.triage_tasks
                : (forYou.data.triage?.conversations.length ?? 0) +
                  (forYou.data.triage?.tasks.length ?? 0)
            }
          />
          <SummaryTile
            label="Waiting on you"
            count={totals?.waiting_on_you ?? forYou.data.waiting_on_you.length}
          />
          <SummaryTile
            label="My tasks"
            count={totals?.my_tasks ?? forYou.data.my_tasks.length}
          />
          <SummaryTile
            label="Unread"
            count={totals?.unread ?? forYou.data.unread.length}
          />
        </div>
      )}

      {forYou.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-app-card border border-app-line bg-app-white px-6 py-12 text-center">
          <p className="text-sm text-app-muted">
            We couldn&apos;t load your queue. Check your connection and try
            again.
          </p>
          <Button variant="outline" size="sm" onClick={() => forYou.refetch()}>
            Try again
          </Button>
        </div>
      ) : forYou.isPending ? (
        <div className="space-y-7">
          <SectionSkeleton />
          <SectionSkeleton />
        </div>
      ) : (
        <ForYouSections data={forYou.data} />
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
  const review = useSpamReview();
  const items = review.data?.data ?? [];
  if (items.length === 0) return null;

  return (
    <Section label="Marked spam, still texting" count={items.length}>
      {items.map((item) => (
        <SpamReviewRow key={item.conversation_id} item={item} />
      ))}
    </Section>
  );
}

function SpamReviewRow({ item }: { item: SpamReviewItem }) {
  const update = useUpdateConversation(item.conversation_id);
  const name = contactDisplayName(item.contact);

  // Say which signal raised it. "4 messages since" alone reads as a counter;
  // "you texted them before marking this" reads as the mistake it probably is.
  const why = item.we_texted_them
    ? "You texted them before this was marked"
    : item.sustained
      ? `Still texting ${formatRelativeTime(item.last_inbound_at)}, over several days`
      : `${item.inbound_since} messages since it was marked`;

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
              onSuccess: () => toast.success("Back in the inbox."),
              onError: (e) =>
                toast.error(
                  e instanceof ApiError ? e.message : "Couldn't undo the mark.",
                ),
            },
          )
        }
      >
        Not spam
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
              onSuccess: () => toast.success("Left as spam."),
              onError: (e) =>
                toast.error(
                  e instanceof ApiError ? e.message : "Couldn't save that.",
                ),
            },
          )
        }
      >
        Still spam
      </Button>
    </div>
  );
}

function ForYouSections({ data }: { data: ForYou }) {
  const { waiting_on_you, my_tasks, unread, triage } = data;
  const t = data.totals;
  // #306: the header count is what the section HOLDS; the rows are a page of
  // it. Falling back to the row count keeps a client running ahead of the
  // Worker on today's behaviour rather than a new wrong number.
  const waitingTotal = t?.waiting_on_you ?? waiting_on_you.length;
  const tasksTotal = t?.my_tasks ?? my_tasks.length;
  const unreadTotal = t?.unread ?? unread.length;
  const triageConvTotal = t?.triage_conversations ?? triage?.conversations.length ?? 0;
  const triageTaskTotal = t?.triage_tasks ?? triage?.tasks.length ?? 0;
  const triageCount = triageConvTotal + triageTaskTotal;

  const everythingEmpty =
    waiting_on_you.length === 0 &&
    my_tasks.length === 0 &&
    unread.length === 0 &&
    triageCount === 0;

  if (everythingEmpty) {
    // The calm, kind empty state (PORTAL-UX §3.1 / §6). Recent calls are
    // ambient history, not to-dos — they render BELOW the caught-up card
    // without disturbing it (#133).
    return (
      <div className="space-y-7">
        {/* #342: before the caught-up card, because "you're all caught up" is
            not true if somebody has been texting a thread nobody can see. */}
        <SpamReviewSection />
        <div className="flex flex-col items-center gap-4 rounded-app-card border border-app-line bg-app-white px-6 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-app-tint">
            <Check className="size-6 text-app-petrol-deep" strokeWidth={2} aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="text-[15px] font-semibold text-app-ink">
              You&apos;re all caught up.
            </p>
            <p className="text-sm text-app-muted">
              New leads will show up here.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/inbox">Open the inbox</Link>
          </Button>
        </div>
        <RecentCallsSection />
      </div>
    );
  }

  return (
    // A dashboard on a wide screen: sections sit as panels in two columns
    // instead of one long scroll. `items-start` keeps a short panel short
    // rather than stretching it to its neighbour's height, and the columns
    // collapse back to a single stack on a phone, where stacked IS right.
    <div className="space-y-7 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
      {/* #342: the one strip whose absence is the whole problem it solves —
          nothing else anywhere reports a spam thread that is still receiving
          messages. It spans both columns so it is read before the queue. */}
      <div className="lg:col-span-2">
        <SpamReviewSection />
      </div>

      {/* #416/D53: shown to EVERY member, not owners and admins only. The
          company already pages the whole crew when a lead lands unclaimed, so
          gating the queue behind a role sent people a notification about a
          screen they could not open. Position, ordering and treatment are
          unchanged — only who sees it.
          *Applying: the Safety Principle — the fix must not move an owner's
          dashboard around while it widens the audience.* */}
      {triageCount > 0 && (
        <Section label="Unassigned" count={triageCount}>
          {triage?.conversations.map((item) => (
            <TriageConvRow key={item.conversation_id} item={item} />
          ))}
          {/* Triage carries two kinds of thing under one heading, so it gets
              two footers — one "view all" cannot land a reader on the rows
              they are missing when only the other half is truncated. */}
          <Overflow
            shown={triage?.conversations.length ?? 0}
            total={triageConvTotal}
            href="/inbox"
            label="unassigned conversations in the inbox"
          />
          {triage?.tasks.map((task) => (
            <TriageTaskRow key={task.task_id} task={task} />
          ))}
          <Overflow
            shown={triage?.tasks.length ?? 0}
            total={triageTaskTotal}
            href="/tasks"
            label="all tasks"
          />
        </Section>
      )}

      {waiting_on_you.length > 0 && (
        <Section label="Waiting on you" count={waitingTotal}>
          {waiting_on_you.map((item) => (
            <WaitingRow key={item.conversation_id} item={item} />
          ))}
          {/* /inbox?assignee=me is a SUPERSET of this section — the Mine
              segment carries no status filter — so the link is offered as a
              place to continue, not as "the other 43". */}
          <Overflow
            shown={waiting_on_you.length}
            total={waitingTotal}
            href="/inbox?assignee=me"
            label="see the rest in your inbox"
          />
        </Section>
      )}

      {my_tasks.length > 0 && (
        <Section label="My tasks" count={tasksTotal}>
          {my_tasks.map((task) => (
            <TaskRow key={task.task_id} task={task} />
          ))}
          {/* Bare /tasks, which is List · Open · Mine — the exact match for
              this section. `?tab=mine` drops the status filter and would land
              the reader in a list that includes everything they finished. */}
          <Overflow
            shown={my_tasks.length}
            total={tasksTotal}
            href="/tasks"
            label="see all your open tasks"
          />
        </Section>
      )}

      {unread.length > 0 && (
        <Section label="Unread" count={unreadTotal}>
          {unread.map((item) => (
            <UnreadRow key={item.conversation_id} item={item} />
          ))}
          <Overflow
            shown={unread.length}
            total={unreadTotal}
            href="/inbox?assignee=me&unread=true"
            label="see the rest in your inbox"
          />
        </Section>
      )}

      <div className="lg:col-span-2">
        <RecentCallsSection />
      </div>
    </div>
  );
}
