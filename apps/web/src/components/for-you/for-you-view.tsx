"use client";

import { AlertTriangle, ArrowRight, Inbox } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { StatusPill } from "@/components/inbox/status-pill";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { undoableToast } from "@/components/ui/optimistic-undo";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/error";
import { useCompleteForYouTask, useForYou } from "@/lib/api/for-you";
import type {
  ForYou,
  ForYouTask,
  ForYouTriageTask,
  ForYouUnread,
  ForYouWaiting,
} from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { contactDisplayName } from "@/lib/format/phone";
import { formatRelativeTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";

/** A due date rendered short + a quiet "Overdue" marker when past. */
function DueMarker({ dueAt, overdue }: { dueAt: string | null; overdue: boolean }) {
  if (!dueAt) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums",
        overdue ? "font-medium text-warning" : "text-foreground-tertiary",
      )}
    >
      {overdue && (
        <AlertTriangle className="size-3" strokeWidth={2} aria-hidden />
      )}
      {overdue ? "Overdue" : `Due ${formatRelativeTime(dueAt)}`}
    </span>
  );
}

/** Section wrapper: a quiet heading + count, then the card list. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline gap-2 px-1 text-sm font-medium text-foreground">
        {title}
        {count > 0 && (
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </h2>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

/** Shared row chrome: left content + a right-side deep-link chevron. */
function CardLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors duration-150 ease-out hover:bg-secondary/50",
        className,
      )}
    >
      {children}
      <ArrowRight
        className="size-4 shrink-0 text-foreground-tertiary"
        strokeWidth={1.75}
        aria-hidden
      />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Waiting on you — conversations assigned to me, urgency-sorted server-side.
// ---------------------------------------------------------------------------

function WaitingRow({ item }: { item: ForYouWaiting }) {
  const name = contactDisplayName(item.contact);
  return (
    <CardLink
      href={`/inbox/${item.conversation_id}`}
      className="border-b border-border-subtle last:border-b-0"
    >
      {/* Unread points in petrol; the overdue-linked task raises an amber flag. */}
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          item.unread ? "bg-primary" : "bg-transparent",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {name}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <StatusPill status={item.status} />
          {item.has_overdue_task && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
              <AlertTriangle className="size-3" strokeWidth={2} aria-hidden />
              Overdue task
            </span>
          )}
        </span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-foreground-tertiary">
        {formatRelativeTime(item.last_message_at)}
      </span>
    </CardLink>
  );
}

// ---------------------------------------------------------------------------
// Your tasks — my open tasks, overdue pinned; inline complete (optimistic+undo).
// ---------------------------------------------------------------------------

function TaskRow({ task }: { task: ForYouTask }) {
  const router = useRouter();
  const complete = useCompleteForYouTask();

  const onComplete = () => {
    // Optimistic + 5s undo: the task drops out of the queue at click; Undo
    // re-marks the source message not-done (the queue re-derives on settle).
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
    );
  };

  return (
    <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-b-0">
      <Checkbox
        checked={false}
        onCheckedChange={onComplete}
        disabled={complete.isPending}
        aria-label={`Complete task: ${task.title}`}
        className="shrink-0"
      />
      {/* The title is the one bold thing; tap it to open the source thread. */}
      <button
        type="button"
        onClick={() => router.push(`/inbox/${task.conversation_id}`)}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-sm font-medium text-foreground">
          {task.title}
        </span>
        {task.due_at && (
          <span className="mt-0.5 block">
            <DueMarker dueAt={task.due_at} overdue={task.overdue} />
          </span>
        )}
      </button>
      <Link
        href={`/inbox/${task.conversation_id}`}
        aria-label="Open conversation"
        className="shrink-0 text-foreground-tertiary transition-colors hover:text-foreground"
      >
        <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unread — my conversations with unread inbound.
// ---------------------------------------------------------------------------

function UnreadRow({ item }: { item: ForYouUnread }) {
  const name = contactDisplayName(item.contact);
  return (
    <CardLink
      href={`/inbox/${item.conversation_id}`}
      className="border-b border-border-subtle last:border-b-0"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {name}
        </span>
        <span className="mt-0.5 block">
          <StatusPill status={item.status} />
        </span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-foreground-tertiary">
        {formatRelativeTime(item.last_message_at)}
      </span>
    </CardLink>
  );
}

// ---------------------------------------------------------------------------
// Needs an owner (owner/admin only) — the triage hand-out strip.
// ---------------------------------------------------------------------------

function TriageTaskRow({ task }: { task: ForYouTriageTask }) {
  return (
    <CardLink
      href={`/inbox/${task.conversation_id}`}
      className="border-b border-border-subtle last:border-b-0"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {task.title}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="text-xs text-foreground-tertiary">Unassigned task</span>
          <DueMarker dueAt={task.due_at} overdue={task.overdue} />
        </span>
      </span>
    </CardLink>
  );
}

/** A gentle 3-line skeleton for one section while the queue first loads. */
function SectionSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="ml-1 h-4 w-28" />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-b-0"
          >
            <Skeleton className="size-2 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-3 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The /for-you focus queue (D23). Header with the notifications bell, then the
 * four sections in urgency order. Server sorts within each section; the page
 * renders them and offers the inline task-complete. Calm, mobile-first: the
 * same sections stacked on a phone, generous air, the conversation/task text
 * the only bold thing.
 */
export function ForYouView() {
  const { displayName, role } = useActiveCompany();
  const forYou = useForYou();

  const firstName = displayName.trim().split(/\s+/)[0] || "there";
  const isLead = role === "owner" || role === "admin";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            For you
          </h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {`Hi ${firstName} — here's what needs you.`}
          </p>
        </div>
        {/* The rail carries the bell on desktop/tablet (persistent, on every
            page). On mobile the rail is hidden, so /for-you — the mobile default
            landing — surfaces the bell in its header. */}
        <div className="pt-1 md:hidden">
          <NotificationBell />
        </div>
      </header>

      {forYou.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load your queue. Check your connection and try
            again.
          </p>
          <Button variant="outline" size="sm" onClick={() => forYou.refetch()}>
            Try again
          </Button>
        </div>
      ) : forYou.isPending ? (
        <div className="space-y-8">
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
    // The calm, kind, whole-queue empty state (D23 empty-state-kind).
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card px-6 py-16 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Inbox
            className="size-6 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden
          />
        </span>
        <div className="space-y-1">
          <p className="text-[15px] font-medium text-foreground">
            You&apos;re all caught up.
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing is waiting on you right now. New messages and tasks land
            here.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/inbox">Open the inbox</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {waiting_on_you.length > 0 && (
        <Section title="Waiting on you" count={waiting_on_you.length}>
          {waiting_on_you.map((item) => (
            <WaitingRow key={item.conversation_id} item={item} />
          ))}
        </Section>
      )}

      {my_tasks.length > 0 && (
        <Section title="Your tasks" count={my_tasks.length}>
          {my_tasks.map((task) => (
            <TaskRow key={task.task_id} task={task} />
          ))}
        </Section>
      )}

      {unread.length > 0 && (
        <Section title="Unread" count={unread.length}>
          {unread.map((item) => (
            <UnreadRow key={item.conversation_id} item={item} />
          ))}
        </Section>
      )}

      {isLead && triageCount > 0 && (
        <Section title="Needs an owner" count={triageCount}>
          {triage?.conversations.map((item) => (
            <CardLink
              key={item.conversation_id}
              href={`/inbox/${item.conversation_id}`}
              className="border-b border-border-subtle last:border-b-0"
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  item.unread ? "bg-primary" : "bg-transparent",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {contactDisplayName(item.contact)}
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <StatusPill status={item.status} />
                  <span className="text-xs text-foreground-tertiary">
                    Unassigned
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-foreground-tertiary">
                {formatRelativeTime(item.last_message_at)}
              </span>
            </CardLink>
          ))}
          {triage?.tasks.map((task) => (
            <TriageTaskRow key={task.task_id} task={task} />
          ))}
        </Section>
      )}
    </div>
  );
}
