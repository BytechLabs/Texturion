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
import { ApiError } from "@/lib/api/error";
import { useCompleteForYouTask, useForYou } from "@/lib/api/for-you";
import type {
  ForYou,
  ForYouTask,
  ForYouTriageConversation,
  ForYouTriageTask,
  ForYouUnread,
  ForYouWaiting,
} from "@/lib/api/types";
import { useTaskDrawer } from "@/components/tasks/use-task-drawer";
import { useActiveCompany } from "@/lib/company/provider";
import { contactDisplayName } from "@/lib/format/phone";
import { formatRelativeTime } from "@/lib/format/time";
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

/** A labeled section: small uppercase label + count, then the calm card list. */
function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="flex items-baseline gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
        {label}
        {count > 0 && <span className="tabular-nums">{count}</span>}
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
      className="flex items-center gap-3 border-b border-app-line-soft px-4 py-3 transition-colors duration-150 ease-out last:border-b-0 hover:bg-app-line-soft"
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
      ? `Due ${formatRelativeTime(task.due_at)}`
      : "Open task";

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-app-line-soft px-4 py-3 last:border-b-0",
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
          <Why text={`Unassigned · ${formatRelativeTime(item.last_message_at)}`} />
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
 * /for-you — the triage home (PORTAL-UX §3.1), the DEFAULT landing. A single
 * scrollable stage of typed cards in labeled sections rendered from api_for_you:
 * Triage (owner/lead), Waiting on you, My tasks, Unread. Each card shows WHY it
 * is here (the concrete signal). The header carries a quiet sub-line, the bell,
 * and the search glyph (opens ⌘K). Calm empty state when the queue clears.
 */
export function ForYouView() {
  const { role } = useActiveCompany();
  const forYou = useForYou();
  const isLead = role === "owner" || role === "admin";

  const total = forYou.data
    ? forYou.data.waiting_on_you.length +
      forYou.data.my_tasks.length +
      forYou.data.unread.length +
      (forYou.data.triage
        ? forYou.data.triage.conversations.length +
          forYou.data.triage.tasks.length
        : 0)
    : 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8">
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
            className="grid size-8 place-items-center rounded-[9px] border border-app-line bg-app-white text-app-muted transition-colors hover:bg-app-line-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="size-[15px]" strokeWidth={1.9} aria-hidden />
          </button>
          <NotificationBell />
        </div>
      </header>

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
        <ForYouSections data={forYou.data} isLead={isLead} />
      )}
    </div>
  );
}

function ForYouSections({ data, isLead }: { data: ForYou; isLead: boolean }) {
  const { waiting_on_you, my_tasks, unread, triage } = data;
  const triageCount =
    (triage?.conversations.length ?? 0) + (triage?.tasks.length ?? 0);

  const everythingEmpty =
    waiting_on_you.length === 0 &&
    my_tasks.length === 0 &&
    unread.length === 0 &&
    triageCount === 0;

  if (everythingEmpty) {
    // The calm, kind empty state (PORTAL-UX §3.1 / §6).
    return (
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
    );
  }

  return (
    <div className="space-y-7">
      {isLead && triageCount > 0 && (
        <Section label="Triage" count={triageCount}>
          {triage?.conversations.map((item) => (
            <TriageConvRow key={item.conversation_id} item={item} />
          ))}
          {triage?.tasks.map((task) => (
            <TriageTaskRow key={task.task_id} task={task} />
          ))}
        </Section>
      )}

      {waiting_on_you.length > 0 && (
        <Section label="Waiting on you" count={waiting_on_you.length}>
          {waiting_on_you.map((item) => (
            <WaitingRow key={item.conversation_id} item={item} />
          ))}
        </Section>
      )}

      {my_tasks.length > 0 && (
        <Section label="My tasks" count={my_tasks.length}>
          {my_tasks.map((task) => (
            <TaskRow key={task.task_id} task={task} />
          ))}
        </Section>
      )}

      {unread.length > 0 && (
        <Section label="Unread" count={unread.length}>
          {unread.map((item) => (
            <UnreadRow key={item.conversation_id} item={item} />
          ))}
        </Section>
      )}
    </div>
  );
}
