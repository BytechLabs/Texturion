"use client";

import {
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  Loader2,
  MapPin,
  MoreHorizontal,
  PhoneIncoming,
  Paperclip,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { StagedFileChips } from "@/components/attachments/staged-file-chips";
import { TaskAttachments } from "@/components/attachments/task-attachments";
import {
  DropOverlay,
  useFileDrop,
} from "@/components/attachments/use-file-drop";
import { useStagedFiles } from "@/components/attachments/use-staged-files";
import { VoicemailPlayer } from "@/components/calls/voicemail-player";
import { MemberAvatar, useMemberNames } from "@/components/inbox/member-avatar";
import { Button } from "@/components/ui/button";
import { RecordHeader } from "@/components/ui/record-header";
import { CountryDatalist } from "@/components/ui/country-datalist";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuToggleItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useT, type MessageKey, type Translate } from "@/i18n/provider";
import { useActiveCompany } from "@/lib/company/provider";
import { formatCallDuration } from "@/lib/format/call";
import { formatPhone } from "@/lib/format/phone";
import { Timestamp } from "@/components/ui/timestamp";
import { taskThreadHref, taskThreadId } from "./task-format";
import { useUploadNoteFiles } from "@/lib/api/attachments";
import { ApiError } from "@/lib/api/error";
import { useMe } from "@/lib/api/me";
import {
  type TaskAddressInput,
  useAddTaskLabel,
  useCreateTaskNote,
  useDeleteTask,
  useRemoveTaskLabel,
  useTask,
  useUpdateTask,
} from "@/lib/api/tasks";
import { useMembers } from "@/lib/api/team";
import type {
  AddressProvenance,
  TaskActivityItem,
  TaskDetail,
  TaskPriority,
} from "@/lib/api/types";
import { isFilePaste } from "@/lib/attachments/clipboard";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_OWNER,
} from "@/lib/attachments/validate";
import { AiOrb } from "@/components/ui/ai-orb";
import { cn } from "@/lib/utils";

import { AssigneeField } from "./assignee-field";
import { TaskDoneCheckbox, TaskNumber } from "./task-atoms";
import { ReferenceChips } from "./reference-text";
import { ReferencePicker } from "./reference-picker";
import { TaskLinksSection } from "./task-links-section";
import { useReferenceTrigger } from "./use-reference-trigger";
import { taskAssigneeIds } from "./task-assignees";
import { useCanDeleteRecords } from "@/lib/hooks/use-records-delete";
import { taskDeleteContent, taskDeleteSummary } from "./task-delete";
import {
  draftFromRepeat,
  draftToRequest,
  needsScopeChoice,
  normalizePriority,
  type RepeatDraft,
  type TaskScope,
} from "./task-planning";
import {
  EditableLabelChips,
  LabelPicker,
  PrioritySelect,
  RepeatField,
  ScopeDialog,
} from "./task-planning-ui";
import {
  useSetTaskReminders,
  useTaskDone,
  useTaskFollow,
} from "./use-task-mutations";
import { TaskCommentComposer, TaskFeed } from "./task-feed";
import { ShareJobPhotos } from "@/components/tasks/share-job-photos";

/** Sentinel <Select> value for "unassigned" (Radix forbids an empty string). */

/**
 * The task detail panel (TASKS-V2 D-A/D-B/D-C/D-D) — the shared body of the
 * right-side drawer AND the deep-linkable /tasks/[id] route. It shows the
 * source message (with a link into its thread), editable title / description /
 * assignee / due wired to the existing hooks with optimistic update + rollback,
 * the D28 DERIVED attachments union (a read view — files enter through the
 * discussion's notes, never a task upload), a delete action (records.delete
 * holders), and one merged activity+discussion timeline (task events +
 * linked notes) with a note composer at the bottom that stages files
 * (pick / drop / paste) and uploads them with the created note.
 *
 * Built into the new app shell aesthetic: elevated white surface, Golos, calm
 * stone chrome with one petrol control (the done checkbox state mark). `onClose`
 * is called after a successful delete so the host (drawer) can dismiss.
 */
/**
 * #237 — who confirmed, said plainly.
 *
 * The two are NOT the same fact. A customer confirming is a promise from the
 * person who has to be there; a crew member marking it is a note to ourselves.
 * A dispatcher deciding whether to send a van reads them differently, so the
 * line does too.
 */
function confirmedLine(
  by: "customer" | "crew" | null | undefined,
  t: Translate,
): string {
  return by === "customer"
    ? t("tasks.confirmedByCustomer")
    : t("tasks.confirmedByCrew");
}

export function TaskDetailPanel({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose?: () => void;
}) {
  const t = useT();
  const query = useTask(taskId);

  if (query.isPending) return <TaskDetailSkeleton />;

  if (query.isError) {
    const notFound =
      query.error instanceof ApiError && query.error.code === "not_found";
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-sm text-app-muted">
          {notFound
            ? t("tasks.detailNotFound")
            : t("tasks.detailLoadFailed")}
        </p>
        {!notFound && (
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        )}
      </div>
    );
  }

  return <TaskDetailLoaded task={query.data} onClose={onClose} />;
}

function TaskDetailLoaded({
  task,
  onClose,
}: {
  task: TaskDetail;
  onClose?: () => void;
}) {
  const t = useT();
  const me = useMe();
  const members = useMembers();
  const { role } = useActiveCompany();
  const conversationId = taskThreadId(task);

  // #107: the task is global (always shown), but its source conversation is on
  // a number this viewer can't access — the server withheld the message, files,
  // and discussion. Show the task's own fields, replace the conversation content
  // with a plain notice, and hide the note composer (posting would be rejected).
  const noAccess = task.viewer_level === "none";

  const update = useUpdateTask(conversationId);
  const del = useDeleteTask(conversationId);
  const done = useTaskDone();
  const follow = useTaskFollow(task.id);
  const addLabel = useAddTaskLabel(conversationId);
  const removeLabel = useRemoveTaskLabel(conversationId);

  // #693: an edit to a repeating task asks which occurrences it reaches before
  // anything is sent. cancel puts the field back as it was.
  const [scopeAsk, setScopeAsk] = useState<{
    run: (scope: TaskScope) => void;
    cancel: () => void;
  } | null>(null);
  const [dueKey, setDueKey] = useState(0);
  const repeats = needsScopeChoice(task.repeat);
  const scoped = (
    run: (scope: TaskScope | undefined) => void,
    cancel: () => void = () => {},
  ) => {
    if (repeats) setScopeAsk({ run, cancel });
    else run(undefined);
  };

  // Local field state, seeded from the task and kept in sync when the server
  // row changes (a realtime refetch, or another surface's edit).
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description), [task.description]);
  const descriptionRefs = useReferenceTrigger(() => description, setDescription);

  /**
   * #294: user id → display name, so a group of photos can say who took them.
   *
   * Built from the roster this panel already loaded for the assignee picker rather
   * than fetched again — a second lookup for the same names is a second thing that
   * can be a step behind them.
   */
  const memberNames = useMemo(
    () =>
      new Map(
        (members.data?.data ?? [])
          .filter((member) => member.user_id !== null)
          .map((member) => [member.user_id as string, member.display_name]),
      ),
    // The query result, not the `?? []` above it: that expression is a new array
    // every render, which would rebuild this map on every render and make the memo
    // an expense rather than a saving.
    [members.data],
  );

  const saveTitle = () => {
    const trimmed = title.trim();
    if (trimmed === "" || trimmed === task.title) {
      setTitle(task.title); // empty is invalid; snap back
      return;
    }
    scoped(
      (scope) =>
        update.mutate(
          { taskId: task.id, title: trimmed, ...(scope ? { scope } : {}) },
          { onError: () => toast.error(t("tasks.renameFailed")) },
        ),
      () => setTitle(task.title),
    );
  };

  const saveDescription = () => {
    if (description === task.description) return;
    scoped(
      (scope) =>
        update.mutate(
          { taskId: task.id, description, ...(scope ? { scope } : {}) },
          { onError: () => toast.error(t("tasks.descriptionSaveFailed")) },
        ),
      () => setDescription(task.description),
    );
  };

  const setReminders = useSetTaskReminders();

  const saveAssignees = (ids: string[]) => {
    scoped((scope) =>
      update.mutate(
        {
          taskId: task.id,
          assignee_ids: ids,
          ...(scope ? { scope } : {}),
        },
        { onError: () => toast.error(t("tasks.reassignFailed")) },
      ),
    );
  };

  const savePriority = (priority: TaskPriority) => {
    if (priority === normalizePriority(task.priority)) return;
    scoped((scope) =>
      update.mutate(
        { taskId: task.id, priority, ...(scope ? { scope } : {}) },
        { onError: () => toast.error(t("tasks.updateFailed")) },
      ),
    );
  };

  const attachLabel = (input: { tag_id: string } | { name: string }) =>
    scoped((scope) =>
      addLabel.mutate(
        { taskId: task.id, ...input, ...(scope ? { scope } : {}) },
        { onError: () => toast.error(t("tasks.labelAddFailed")) },
      ),
    );

  const detachLabel = (tagId: string) =>
    scoped((scope) =>
      removeLabel.mutate(
        { taskId: task.id, tagId, ...(scope ? { scope } : {}) },
        { onError: () => toast.error(t("tasks.labelRemoveFailed")) },
      ),
    );

  // The rule always applies to this task and the ones after it, so no scope.
  const saveRepeat = (draft: RepeatDraft | null) =>
    update.mutate(
      {
        taskId: task.id,
        repeat: draft ? draftToRequest(draft, task.due_at) : null,
      },
      { onError: () => toast.error(t("tasks.repeatSaveFailed")) },
    );

  const saveDue = (value: string) => {
    // A datetime-local reports "" whenever ANY segment is blank, and fires on
    // every segment change. Clearing the hour to retype it therefore looked
    // exactly like "remove the due date", and the write went out immediately:
    // the deadline was gone, the timeline recorded that someone cleared it, and
    // the assignee's reminder was discarded, with no undo. Removing a due date
    // is a deliberate act with its own control below.
    if (value === "") return;
    scoped(
      (scope) =>
        update.mutate(
          {
            taskId: task.id,
            // <input type="datetime-local"> yields a local wall-clock string; store
            // an ISO instant.
            due_at: new Date(value).toISOString(),
            ...(scope ? { scope } : {}),
          },
          { onError: () => toast.error(t("tasks.dueChangeFailed")) },
        ),
      () => setDueKey((k) => k + 1),
    );
  };

  const clearDue = () => {
    scoped((scope) =>
      update.mutate(
        { taskId: task.id, due_at: null, ...(scope ? { scope } : {}) },
        { onError: () => toast.error(t("tasks.dueClearFailed")) },
      ),
    );
  };

  // Delete follows the server gate: only a member holding records.delete.
  const canDelete = useCanDeleteRecords();

  // #89: deleting is destructive and has no restore UI, so a task carrying a
  // discussion (notes) or files confirms first; a plain task (only the auto
  // task_created event) deletes without friction.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteContent = taskDeleteContent(task);

  const [deleteScope, setDeleteScope] = useState<TaskScope | undefined>();
  const [askDeleteScope, setAskDeleteScope] = useState(false);

  const runDelete = (scope?: TaskScope) => {
    del.mutate({ taskId: task.id, scope }, {
      onSuccess: () => {
        toast.success(t("tasks.deleted"));
        onClose?.();
      },
      onError: () => {
        setConfirmDelete(false);
        toast.error(t("tasks.deleteFailed"));
      },
    });
  };

  const confirmThenDelete = (scope?: TaskScope) => {
    setDeleteScope(scope);
    if (deleteContent.hasContent) setConfirmDelete(true);
    else runDelete(scope);
  };

  const requestDelete = () => {
    if (repeats) setAskDeleteScope(true);
    else confirmThenDelete();
  };

  // Same derived-done write as the check-circle (PATCH the source message).
  const toggleDone = () => {
    done.mutate(
      {
        taskId: task.id,
        messageId: task.message_id,
        conversationId,
        done: !task.done,
      },
      { onError: () => toast.error(t("tasks.updateFailed")) },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: done state + title + actions menu. pr-12 reserves the drawer's
          own close (X, top-right) so the actions menu no longer sits under it
          (#81 — an accidental delete when reaching for close). */}
      <RecordHeader
        className="border-b border-app-line pb-4 pl-5 pr-12 pt-5"
        leading={
          // Completion is derived from the source message, so marking a task
          // done needs access to the conversation it came from. Without it the
          // API refuses every attempt, and offering the control produced a
          // circle that flipped, snapped back, and said "Couldn't move that
          // task. Try again." forever.
          noAccess ? (
            <span
              aria-hidden
              className="mt-1 size-5 shrink-0 rounded-full border border-dashed border-app-line"
              title={t("tasks.doneNeedsAccessTitle")}
            />
          ) : (
            <TaskDoneCheckbox task={task} className="mt-1" />
          )
        }
        title={
          <>
            <TaskNumber task={task} className="ml-1 block" />
            <input
              aria-label={t("tasks.titleAria")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              maxLength={500}
              className={cn(
                "w-full rounded-app-ctrl bg-transparent px-1 py-0.5 text-lg font-semibold text-app-ink outline-none",
                "focus-visible:bg-app-inset focus-visible:ring-2 focus-visible:ring-ring",
                task.done && "text-app-muted line-through opacity-70",
              )}
            />
          </>
        }
        trailing={
          <>
            {/* #689 D: follow to hear when this changes. An icon toggle beside the
                menu rather than a menu item: one tap, and the bell shows the state.
                Not offered without access to the task, which the server 404s. */}
            {!noAccess && (
              <button
                type="button"
                aria-label={t(task.subscribed ? "tasks.unfollowAria" : "tasks.followAria")}
                aria-pressed={task.subscribed}
                title={t(task.subscribed ? "tasks.unfollowAria" : "tasks.followAria")}
                disabled={follow.isPending}
                onClick={() => follow.mutate(!task.subscribed)}
                className={cn(
                  "tap-target mt-0.5 shrink-0 rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  task.subscribed
                    ? "text-app-ink hover:text-app-muted"
                    : "text-app-muted-2 hover:text-app-ink",
                )}
              >
                {task.subscribed ? (
                  <Bell className="size-4" strokeWidth={1.75} fill="currentColor" aria-hidden />
                ) : (
                  <BellOff className="size-4" strokeWidth={1.75} aria-hidden />
                )}
              </button>
            )}
            {/* #713: no trigger when neither item is allowed. */}
            {(!noAccess || canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("tasks.actionsAria")}
                    className="tap-target mt-0.5 shrink-0 rounded-full p-1 text-app-muted-2 transition-colors hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MoreHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {/* Mirrors the check-circle — the same derived-done write, and the
                      same access requirement. */}
                  {!noAccess && (
                    <DropdownMenuToggleItem
                      checked={task.done}
                      onCheckedChange={toggleDone}
                      disabled={done.isPending}
                    >
                      <Check className="size-4" strokeWidth={1.75} aria-hidden />
                      {t("tasks.markDoneAction")}
                    </DropdownMenuToggleItem>
                  )}
                  {/* #89: a real, destructive Delete (records.delete only).
                      Confirms first when the task carries notes or files. */}
                  {canDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={requestDelete}
                        disabled={del.isPending}
                      >
                        <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                        {t("tasks.deleteTask")}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {/* Scrollable body. */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {/* #107: no access to the source number — explain the withheld content. */}
        {noAccess && (
          <section
            aria-label={t("tasks.accessNoticeAria")}
            className="rounded-app-card border border-app-line bg-app-inset p-3"
          >
            <p className="text-[13px] text-app-muted">
              {t("tasks.noAccessNotice")}
            </p>
          </section>
        )}

        {/* A standalone task (#689): no text or call behind it. */}
        {!task.source && task.message_id === null && !task.source_call_id && !noAccess && (
          <section aria-label={t("tasks.noSourceAria")} className="space-y-1.5">
            <p className="text-[13px] font-medium text-app-ink">
              {t("tasks.noSource")}
            </p>
            <p className="text-[13px] text-app-muted">{t("tasks.noSourceHint")}</p>
            {task.contact && (
              <Link
                href={`/contacts/${task.contact.id}`}
                className="block text-[13px] text-app-ink underline-offset-2 hover:underline"
              >
                {t("tasks.linkedContact")}: {task.contact.name?.trim() || t("shell.unknownCaller")}
              </Link>
            )}
            {task.conversation_id !== null && (
              <Link
                href={taskThreadHref(task)}
                className="block text-[13px] text-app-ink underline-offset-2 hover:underline"
              >
                {t("tasks.linkedConversation")}
              </Link>
            )}
          </section>
        )}

        {/* Source message + thread link. */}
        {task.source_message && (
          <section aria-label={t("tasks.sourceMessageAria")} className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
              {t("tasks.fromThisMessage")}
            </p>
            <div className="rounded-app-card border border-app-line bg-app-inset p-3">
              <p className="whitespace-pre-wrap break-words text-[13px] text-app-ink">
                {task.source_message.body.trim() === ""
                  ? t("tasks.sourcePhotoOnly")
                  : task.source_message.body}
              </p>
              <Link
                href={taskThreadHref(task)}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-app-olive hover:text-app-olive-deep"
              >
                {t("tasks.viewInConversation")}
                <ArrowUpRight className="size-3" strokeWidth={1.75} aria-hidden />
              </Link>
            </div>
          </section>
        )}

        {/* D64: the call this task was promoted from, where a message would be. */}
        {task.source_call && (
          <section aria-label={t("tasks.sourceCallAria")} className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
              {t("tasks.fromThisCall")}
            </p>
            <div className="rounded-app-card border border-app-line bg-app-inset p-3">
              <p className="flex items-center gap-2 text-[13px] font-medium text-app-ink">
                <PhoneIncoming
                  className="size-3.5 shrink-0 text-app-muted-2"
                  strokeWidth={1.75}
                  aria-hidden
                />
                {t("tasks.callFrom", {
                  name:
                    task.source_call.caller_name ??
                    (task.source_call.caller_e164
                      ? formatPhone(task.source_call.caller_e164)
                      : t("shell.unknownCaller")),
                })}
              </p>
              <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">
                <Timestamp at={task.source_call.started_at} style="long" />
                {task.source_call.forward_seconds > 0 &&
                  ` · ${t("tasks.callTalkTime", {
                    duration: formatCallDuration(task.source_call.forward_seconds),
                  })}`}
              </p>
              {task.source_call.has_voicemail && (
                <div className="mt-2">
                  <VoicemailPlayer
                    callSessionId={task.source_call.call_session_id}
                    seconds={null}
                    showTranscript
                  />
                </div>
              )}
              <Link
                href={taskThreadHref(task)}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-app-olive hover:text-app-olive-deep"
              >
                {t("tasks.viewInConversation")}
                <ArrowUpRight className="size-3" strokeWidth={1.75} aria-hidden />
              </Link>
            </div>
          </section>
        )}

        {/* Editable metadata. */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-assignee">{t("tasks.assignee")}</Label>
            <AssigneeField
              id="task-assignee"
              ariaLabel={t("tasks.assignee")}
              value={taskAssigneeIds(task)}
              onCommit={saveAssignees}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="task-due">{t("tasks.due")}</Label>
              {task.due_at && (
                <button
                  type="button"
                  onClick={clearDue}
                  className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {t("tasks.clearDue")}
                </button>
              )}
            </div>
            <Input
              id="task-due"
              type="datetime-local"
              defaultValue={toLocalInput(task.due_at)}
              // Keyed on the task, not on the value. Keying on due_at remounted
              // the field the moment an edit was accepted, which took focus and
              // the caret away mid-entry.
              key={`${task.id}:${dueKey}`}
              // A repeating task asks "this one or future" before saving, so it
              // waits for the field to be left rather than asking per keystroke.
              onChange={(e) => {
                if (!repeats) saveDue(e.target.value);
              }}
              onBlur={(e) => {
                if (
                  repeats &&
                  e.target.value !== "" &&
                  e.target.value !== toLocalInput(task.due_at)
                ) {
                  saveDue(e.target.value);
                }
              }}
            />
          </div>
        </section>

        {/* #237: directly under the due date, because it only means anything
            as a qualifier on it — a job with no date sends nothing whatever
            this says, and the switch would read as broken sitting anywhere
            else. Hidden entirely without a date, for the same reason.
            *Applying: Relationship Strength.* */}
        {task.due_at !== null && (
          <section className="flex flex-wrap items-center justify-between gap-2 rounded-app-ctrl border border-app-line px-3 py-2">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-app-ink">
                {t("tasks.remindCustomer")}
              </p>
              <p className="text-[12px] text-app-muted">
                {task.confirmed_at
                  ? confirmedLine(task.confirmed_by, t)
                  : task.reminders_off
                    ? t("tasks.remindersOffForJob")
                    : t("tasks.remindersFromWorkspace")}
              </p>
            </div>
            <Switch
              checked={!(task.reminders_off ?? false)}
              aria-label={t("tasks.remindCustomerAria")}
              onCheckedChange={(on) =>
                setReminders.mutate({
                  taskId: task.id,
                  conversationId,
                  off: !on,
                })
              }
            />
          </section>
        )}

        {/* #693: priority, labels and the repeat rule. */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-priority">{t("tasks.priority")}</Label>
            <PrioritySelect
              id="task-priority"
              value={task.priority}
              onChange={savePriority}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-repeat">{t("tasks.repeat")}</Label>
            <RepeatField
              id="task-repeat"
              draft={task.repeat ? draftFromRepeat(task.repeat) : null}
              due={task.due_at}
              linked={task.conversation_id !== null || task.contact_id != null}
              existing={task.repeat != null && !task.repeat.stopped}
              onChange={saveRepeat}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>{t("tasks.labels")}</Label>
            <EditableLabelChips
              labels={(task.labels ?? []).map((l) => ({ key: l.id, name: l.name }))}
              onRemove={detachLabel}
              disabled={removeLabel.isPending}
            />
            <div>
              <LabelPicker
                excludeIds={new Set((task.labels ?? []).map((l) => l.id))}
                onPick={(tag) => attachLabel({ tag_id: tag.id })}
                onCreate={(name) => attachLabel({ name })}
                disabled={addLabel.isPending}
              />
            </div>
          </div>
        </section>

        {/* Description. */}
        <section className="flex flex-col gap-1.5">
          <Label htmlFor="task-description">{t("tasks.description")}</Label>
          <div className="relative">
            <ReferencePicker
              open={descriptionRefs.open}
              onOpenChange={descriptionRefs.setOpen}
              onPick={descriptionRefs.onPick}
            >
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 block h-0" />
            </ReferencePicker>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                descriptionRefs.onTyped(
                  e.target.value,
                  e.target.selectionStart ?? e.target.value.length,
                );
              }}
              onBlur={saveDescription}
              rows={3}
              maxLength={5000}
              placeholder={t("tasks.descriptionPlaceholder")}
            />
          </div>
          {!noAccess && <ReferenceChips text={task.description} className="pt-1" />}
        </section>

        {/* #690: blocked by, blocks, parent and sub-tasks. */}
        {!noAccess && <TaskLinksSection taskId={task.id} />}

        {/* #214 job address — editable; enriched values carry a provenance badge. */}
        <TaskAddressSection
          task={task}
          onSave={(address) =>
            scoped((scope) =>
              update.mutate(
                { taskId: task.id, address, ...(scope ? { scope } : {}) },
                { onError: () => toast.error(t("tasks.addressSaveFailed")) },
              ),
            )
          }
        />

        {/* Attachments + activity + discussion are conversation-derived, so a
            no-access viewer never sees them (the server sent them empty). */}
        {!noAccess && (
          <>
            {/* Attachments — the D28 DERIVED union (source-message MMS + files
                on task-linked notes + legacy rows), a read view: files are
                attached through the discussion composer, never the task. */}
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
                {t("tasks.attachments")}
              </p>
              <TaskAttachments items={task.attachments} names={memberNames} />
              {/* #294: only when there are photos to send. The control belongs
                  under the set it shares, not in a menu at the top of a drawer. */}
              <ShareJobPhotos
                taskId={task.id}
                photoCount={
                  task.attachments.filter((item) => item.kind === "image").length
                }
              />
            </section>

            {/* Merged activity + discussion timeline (D-C + D-D). */}
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
                {t("tasks.activity")}
              </p>
              <TaskFeed
                taskId={task.id}
                userId={me.data?.user_id}
                canModerate={role === "owner" || role === "admin"}
              />
            </section>
          </>
        )}
      </div>

      {/* Note composer — posts a note linked to conversation + task (D-D). A
          no-access viewer can't note the hidden conversation, so it's hidden. */}
      {!noAccess &&
        (task.message_id !== null && task.conversation_id !== null ? (
          <TaskNoteComposer taskId={task.id} conversationId={conversationId} />
        ) : (
          <TaskCommentComposer taskId={task.id} />
        ))}

      <ScopeDialog
        open={scopeAsk !== null}
        mode="edit"
        onChoose={(scope) => {
          scopeAsk?.run(scope);
          setScopeAsk(null);
        }}
        onCancel={() => {
          scopeAsk?.cancel();
          setScopeAsk(null);
        }}
      />
      <ScopeDialog
        open={askDeleteScope}
        mode="delete"
        onChoose={(scope) => {
          setAskDeleteScope(false);
          confirmThenDelete(scope);
        }}
        onCancel={() => setAskDeleteScope(false)}
      />

      {/* #89: destructive-delete confirm — opened only for a task that carries
          notes or files (an empty task deletes straight from the menu). */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("tasks.deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("tasks.deleteConfirmBody", {
                summary: taskDeleteSummary(
                  deleteContent.notes,
                  deleteContent.attachments,
                  t,
                ),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={del.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => runDelete(deleteScope)}
              disabled={del.isPending}
            >
              {del.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                t("tasks.deleteTask")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The note composer pinned to the bottom of the panel. This IS how a file gets
 * "attached to a task" post-D28: the note it posts carries `task_id`, so its
 * files surface in the derived Attachments union above. Files stage as chips
 * (picker, drop, or paste), validated against the D19 rules; on post the note
 * is created first, then each staged file uploads with the note id — a partial
 * failure keeps the note and points at its Files section in the thread.
 */
function TaskNoteComposer({
  taskId,
  conversationId,
}: {
  taskId: string;
  conversationId: string;
}) {
  const t = useT();
  const [body, setBody] = useState("");
  const create = useCreateTaskNote(conversationId);
  const uploadFiles = useUploadNoteFiles();
  const stage = useStagedFiles();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drop = useFileDrop((files) => stage.admit(files));
  const refs = useReferenceTrigger(() => body, setBody);

  const submit = async () => {
    // Guard the in-flight create so a second Cmd/Ctrl+Enter can't double-post
    // the same note (the empty-body check alone doesn't cover the window
    // between clearing the body and the response landing).
    if (create.isPending) return;
    // Text OR at least one staged file — the server's documented client rule.
    const trimmed = body.trim();
    if (trimmed === "" && stage.files.length === 0) return;

    // Snapshot + clear synchronously (fast by feel); restore on failure.
    const draftBody = body;
    const draftFiles = stage.files;
    setBody("");
    stage.clear();

    let note: Awaited<ReturnType<typeof create.mutateAsync>>;
    try {
      // mutateAsync resolves from the MutationCache even if this composer
      // unmounts before the response — so the upload chain below still runs
      // and the staged files aren't silently dropped (D28).
      note = await create.mutateAsync({ taskId, body: trimmed });
    } catch {
      setBody(draftBody);
      stage.restore(draftFiles);
      toast.error(t("tasks.notePostFailed"));
      return;
    }

    // Pure-UI bits only run while still mounted (ref is null after unmount).
    ref.current?.focus();

    if (draftFiles.length === 0) return;
    const { failed } = await uploadFiles.mutateAsync({
      noteId: note.id,
      files: draftFiles.map((staged) => staged.file),
    });
    if (failed.length === 0) return;
    toast.error(
      failed.length === draftFiles.length
        ? t("tasks.noteFilesAllFailed")
        : t("tasks.noteFilesSomeFailed", {
            failed: failed.length,
            total: draftFiles.length,
          }),
    );
  };

  return (
    <div
      className="relative shrink-0 border-t border-app-line bg-app-paper p-4"
      {...drop.handlers}
    >
      <DropOverlay active={drop.active} />
      <StagedFileChips
        files={stage.files}
        onRemove={stage.remove}
        className="pb-2"
      />
      <div className="flex items-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("tasks.attachFilesAria")}
          onClick={() => fileRef.current?.click()}
          disabled={stage.files.length >= MAX_ATTACHMENTS_PER_OWNER}
          className="text-app-muted"
        >
          <Paperclip className="size-4" strokeWidth={1.75} />
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              stage.admit(e.target.files);
            }
            e.target.value = "";
          }}
        />
        <ReferencePicker open={refs.open} onOpenChange={refs.setOpen} onPick={refs.onPick}>
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 block h-0" />
        </ReferencePicker>
        <Textarea
          ref={ref}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            refs.onTyped(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter posts (a plain Enter allows multi-line notes).
            // Ignore held-key auto-repeat so a leaned-on chord posts once.
            if (
              e.key === "Enter" &&
              (e.metaKey || e.ctrlKey) &&
              !e.repeat
            ) {
              e.preventDefault();
              void submit();
            }
          }}
          onPaste={(e) => {
            // Only intercept a genuine file paste; an Office/rich-text copy
            // carries text/html alongside a synthesized image — leave its
            // text paste alone (#10).
            if (!isFilePaste(e.clipboardData)) return;
            e.preventDefault();
            stage.admit(e.clipboardData.files);
          }}
          rows={2}
          maxLength={4096}
          placeholder={t("tasks.notePlaceholder")}
          className="min-h-[44px] flex-1 resize-none"
          aria-label={t("tasks.noteAria")}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          // Text OR at least one staged file, which is the rule the server
          // documents and both phone apps already follow. Web demanded a line
          // of text as well, so dropping a photo of a part on a task and
          // pressing Post did nothing.
          disabled={
            create.isPending || (body.trim() === "" && stage.files.length === 0)
          }
        >
          {create.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            t("tasks.notePost")
          )}
        </Button>
      </div>
    </div>
  );
}

/** ISO instant → the local wall-clock string a datetime-local input wants. */
function toLocalInput(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso);
  // Shift by the tz offset so toISOString's slice reflects local wall time.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function TaskDetailSkeleton() {
  return (
    <div className="space-y-5 p-5" aria-hidden>
      <div className="flex items-start gap-3">
        <Skeleton className="size-5 rounded-full" />
        <Skeleton className="h-6 flex-1" />
      </div>
      <Skeleton className="h-20 w-full rounded-app-card" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// #214 — the task's structured job address, editable inline. Enriched values
// (address suggested by AI at create time) carry a provenance badge; any edit
// marks the address user-authored ("manual"). Saves the whole block on blur out
// of the group (never mid-tab), and the RPC no-ops an unchanged address.
// ---------------------------------------------------------------------------
interface AddrFields {
  street: string;
  unit: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

const ADDR_FIELDS: {
  key: keyof AddrFields;
  labelKey: MessageKey;
  full?: boolean;
}[] = [
  { key: "street", labelKey: "tasks.addrStreet", full: true },
  { key: "unit", labelKey: "tasks.addrUnit" },
  { key: "city", labelKey: "tasks.addrCity" },
  { key: "state", labelKey: "tasks.addrState" },
  { key: "postal_code", labelKey: "tasks.addrPostalCode" },
  { key: "country", labelKey: "tasks.addrCountry", full: true },
];

function addrFromTask(task: TaskDetail): AddrFields {
  return {
    street: task.addr_street ?? "",
    unit: task.addr_unit ?? "",
    city: task.addr_city ?? "",
    state: task.addr_state ?? "",
    postal_code: task.addr_postal_code ?? "",
    country: task.addr_country ?? "",
  };
}

function addrProvenanceLabel(
  p: AddressProvenance | null,
  t: Translate,
): string | null {
  switch (p) {
    case "message":
      return t("tasks.addrFromMessage");
    case "contact":
      return t("tasks.addrFromContact");
    case "company":
      return t("tasks.addrFromAreaCode");
    default:
      return null;
  }
}

function TaskAddressSection({
  task,
  onSave,
}: {
  task: TaskDetail;
  onSave: (address: TaskAddressInput | null) => void;
}) {
  const t = useT();
  const [fields, setFields] = useState<AddrFields>(() => addrFromTask(task));
  const [provenance, setProvenance] = useState<AddressProvenance | null>(
    task.addr_provenance,
  );
  const [open, setOpen] = useState(() =>
    Object.values(addrFromTask(task)).some((v) => v !== ""),
  );

  // Re-sync from the server row after a save settles (or an external change).
  const signature = [
    task.addr_street,
    task.addr_unit,
    task.addr_city,
    task.addr_state,
    task.addr_postal_code,
    task.addr_country,
    task.addr_provenance,
  ].join("|");
  useEffect(() => {
    setFields(addrFromTask(task));
    setProvenance(task.addr_provenance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  function edit(key: keyof AddrFields, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    setProvenance("manual");
  }

  function commit() {
    const current = addrFromTask(task);
    const unchanged = (Object.keys(fields) as (keyof AddrFields)[]).every(
      (k) => fields[k].trim() === (current[k] ?? "").trim(),
    );
    if (unchanged) return;
    const has = Object.values(fields).some((v) => v.trim() !== "");
    onSave(
      has
        ? {
            street: fields.street.trim() || null,
            unit: fields.unit.trim() || null,
            city: fields.city.trim() || null,
            state: fields.state.trim() || null,
            postal_code: fields.postal_code.trim() || null,
            country: fields.country.trim() || null,
            provenance: provenance ?? "manual",
          }
        : null,
    );
  }

  const provLabel = addrProvenanceLabel(provenance, t);

  return (
    <section className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between rounded-md text-sm font-medium text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <MapPin className="size-4 text-app-muted-2" strokeWidth={1.75} />
          {t("tasks.address")}
          {provLabel && (
            <span className="inline-flex items-center gap-1 rounded-full bg-app-inset px-2 py-0.5 text-[11px] font-normal text-app-muted">
              <AiOrb state="idle" size={12} />
              {provLabel}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-app-muted-2 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div
          className="grid grid-cols-2 gap-2"
          // Save only when focus leaves the whole address group (never mid-tab).
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              commit();
            }
          }}
        >
          {ADDR_FIELDS.map((f) => (
            <Input
              key={f.key}
              aria-label={t(f.labelKey)}
              placeholder={t(f.labelKey)}
              className={cn(f.full && "col-span-2")}
              list={f.key === "country" ? "task-detail-countries" : undefined}
              autoComplete={f.key === "country" ? "country-name" : undefined}
              value={fields[f.key]}
              onChange={(e) => edit(f.key, e.target.value)}
            />
          ))}
          <CountryDatalist id="task-detail-countries" />
        </div>
      )}
    </section>
  );
}
