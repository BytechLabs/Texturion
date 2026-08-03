"use client";

import { format } from "date-fns";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Loader2,
  MapPin,
  MoreHorizontal,
  Paperclip,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { StagedFileChips } from "@/components/attachments/staged-file-chips";
import { TaskAttachments } from "@/components/attachments/task-attachments";
import {
  DropOverlay,
  useFileDrop,
} from "@/components/attachments/use-file-drop";
import { useStagedFiles } from "@/components/attachments/use-staged-files";
import { MemberAvatar, useMemberNames } from "@/components/inbox/member-avatar";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useActiveCompany } from "@/lib/company/provider";
import { useUploadNoteFiles } from "@/lib/api/attachments";
import { ApiError } from "@/lib/api/error";
import { useMe } from "@/lib/api/me";
import {
  type TaskAddressInput,
  useCreateTaskNote,
  useDeleteTask,
  useTask,
  useUpdateTask,
} from "@/lib/api/tasks";
import { useMembers } from "@/lib/api/team";
import type {
  AddressProvenance,
  TaskActivityItem,
  TaskDetail,
} from "@/lib/api/types";
import { isFilePaste } from "@/lib/attachments/clipboard";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_OWNER,
} from "@/lib/attachments/validate";
import { AiOrb } from "@/components/ui/ai-orb";
import { cn } from "@/lib/utils";

import { TaskDoneCheckbox } from "./task-atoms";
import { taskDeleteContent, taskDeleteSummary } from "./task-delete";
import { useSetTaskReminders, useTaskDone } from "./use-task-mutations";
import { taskEventSentence } from "./task-activity";

/** Sentinel <Select> value for "unassigned" (Radix forbids an empty string). */
const UNASSIGNED = "__unassigned__";

/**
 * The task detail panel (TASKS-V2 D-A/D-B/D-C/D-D) — the shared body of the
 * right-side drawer AND the deep-linkable /tasks/[id] route. It shows the
 * source message (with a link into its thread), editable title / description /
 * assignee / due wired to the existing hooks with optimistic update + rollback,
 * the D28 DERIVED attachments union (a read view — files enter through the
 * discussion's notes, never a task upload), a delete action (creator or
 * owner/admin), and one merged activity+discussion timeline (task events +
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
function confirmedLine(by: "customer" | "crew" | null | undefined): string {
  return by === "customer"
    ? "They confirmed they'll be there."
    : "Marked confirmed by your crew.";
}

export function TaskDetailPanel({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose?: () => void;
}) {
  const query = useTask(taskId);

  if (query.isPending) return <TaskDetailSkeleton />;

  if (query.isError) {
    const notFound =
      query.error instanceof ApiError && query.error.code === "not_found";
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-sm text-app-muted">
          {notFound
            ? "This task doesn't exist or was removed."
            : "We couldn't load this task."}
        </p>
        {!notFound && (
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Try again
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
  const me = useMe();
  const members = useMembers();
  const { role } = useActiveCompany();
  const conversationId = task.conversation_id;

  // #107: the task is global (always shown), but its source conversation is on
  // a number this viewer can't access — the server withheld the message, files,
  // and discussion. Show the task's own fields, replace the conversation content
  // with a plain notice, and hide the note composer (posting would be rejected).
  const noAccess = task.viewer_level === "none";

  const update = useUpdateTask(conversationId);
  const del = useDeleteTask(conversationId);
  const done = useTaskDone();

  // Local field state, seeded from the task and kept in sync when the server
  // row changes (a realtime refetch, or another surface's edit).
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description), [task.description]);

  const assignee = task.assigned_user_id ?? UNASSIGNED;
  const memberOptions = members.data?.data ?? [];

  const saveTitle = () => {
    const trimmed = title.trim();
    if (trimmed === "" || trimmed === task.title) {
      setTitle(task.title); // empty is invalid; snap back
      return;
    }
    update.mutate(
      { taskId: task.id, title: trimmed },
      { onError: () => toast.error("Couldn't rename this task.") },
    );
  };

  const saveDescription = () => {
    if (description === task.description) return;
    update.mutate(
      { taskId: task.id, description },
      { onError: () => toast.error("Couldn't save the description.") },
    );
  };

  const setReminders = useSetTaskReminders();

  const saveAssignee = (value: string) => {
    update.mutate(
      { taskId: task.id, assigned_user_id: value === UNASSIGNED ? null : value },
      { onError: () => toast.error("Couldn't reassign this task.") },
    );
  };

  const saveDue = (value: string) => {
    // A datetime-local reports "" whenever ANY segment is blank, and fires on
    // every segment change. Clearing the hour to retype it therefore looked
    // exactly like "remove the due date", and the write went out immediately:
    // the deadline was gone, the timeline recorded that someone cleared it, and
    // the assignee's reminder was discarded, with no undo. Removing a due date
    // is a deliberate act with its own control below.
    if (value === "") return;
    update.mutate(
      {
        taskId: task.id,
        // <input type="datetime-local"> yields a local wall-clock string; store
        // an ISO instant.
        due_at: new Date(value).toISOString(),
      },
      { onError: () => toast.error("Couldn't change the due date.") },
    );
  };

  const clearDue = () => {
    update.mutate(
      { taskId: task.id, due_at: null },
      { onError: () => toast.error("Couldn't clear the due date.") },
    );
  };

  // Delete is the creator, or an owner/admin (T4 M*).
  const canDelete =
    role === "owner" ||
    role === "admin" ||
    me.data?.user_id === task.created_by_user_id;

  // #89: deleting is destructive and has no restore UI, so a task carrying a
  // discussion (notes) or files confirms first; a plain task (only the auto
  // task_created event) deletes without friction.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteContent = taskDeleteContent(task);

  const runDelete = () => {
    del.mutate(task.id, {
      onSuccess: () => {
        toast.success("Task deleted.");
        onClose?.();
      },
      onError: () => {
        setConfirmDelete(false);
        toast.error("Couldn't delete this task.");
      },
    });
  };

  const requestDelete = () => {
    if (deleteContent.hasContent) setConfirmDelete(true);
    else runDelete();
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
      { onError: () => toast.error("Couldn't update this task.") },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: done state + title + actions menu. pr-12 reserves the drawer's
          own close (X, top-right) so the actions menu no longer sits under it
          (#81 — an accidental delete when reaching for close). */}
      <div className="flex items-start gap-3 border-b border-app-line pb-4 pl-5 pr-12 pt-5">
        {/* Completion is derived from the source message, so marking a task
            done needs access to the conversation it came from. Without it the
            API refuses every attempt, and offering the control produced a
            circle that flipped, snapped back, and said "Couldn't move that
            task. Try again." forever. */}
        {noAccess ? (
          <span
            aria-hidden
            className="mt-1 size-5 shrink-0 rounded-full border border-dashed border-app-line"
            title="Marking this done needs access to the conversation it came from"
          />
        ) : (
          <TaskDoneCheckbox task={task} className="mt-1" />
        )}
        <div className="min-w-0 flex-1">
          <input
            aria-label="Task title"
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
              "focus-visible:bg-app-inset focus-visible:ring-2 focus-visible:ring-ring/50",
              task.done && "text-app-muted line-through opacity-70",
            )}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Task actions"
              className="tap-target mt-0.5 shrink-0 rounded-full p-1 text-app-muted-2 transition-colors hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                Done
              </DropdownMenuToggleItem>
            )}
            {/* #89: a real, destructive Delete (creator or owner/admin only).
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
                  Delete task
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Scrollable body. */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {/* #107: no access to the source number — explain the withheld content. */}
        {noAccess && (
          <section
            aria-label="Access notice"
            className="rounded-app-card border border-app-line bg-app-inset p-3"
          >
            <p className="text-[13px] text-app-muted">
              This task is linked to a number you don&apos;t have access to. You
              can see the task, but not its messages, files, or discussion — ask
              an owner or admin for access.
            </p>
          </section>
        )}

        {/* Source message + thread link. */}
        {task.source_message && (
          <section aria-label="Source message" className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
              From this message
            </p>
            <div className="rounded-app-card border border-app-line bg-app-inset p-3">
              <p className="whitespace-pre-wrap break-words text-[13px] text-app-ink">
                {task.source_message.body.trim() === ""
                  ? "A photo"
                  : task.source_message.body}
              </p>
              <Link
                href={`/inbox/${conversationId}?message=${task.message_id}`}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-app-olive hover:text-app-olive-deep"
              >
                View in conversation
                <ArrowUpRight className="size-3" strokeWidth={1.75} aria-hidden />
              </Link>
            </div>
          </section>
        )}

        {/* Editable metadata. */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-assignee">Assignee</Label>
            <Select value={assignee} onValueChange={saveAssignee}>
              <SelectTrigger id="task-assignee" className="w-full">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {memberOptions.map((member) => (
                  <SelectItem key={member.id} value={member.user_id}>
                    {member.display_name}
                    {me.data?.user_id === member.user_id ? " (you)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="task-due">Due</Label>
              {task.due_at && (
                <button
                  type="button"
                  onClick={clearDue}
                  className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Clear
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
              key={task.id}
              onChange={(e) => saveDue(e.target.value)}
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
                Remind this customer
              </p>
              <p className="text-[12px] text-app-muted">
                {task.confirmed_at
                  ? confirmedLine(task.confirmed_by)
                  : task.reminders_off
                    ? "Off for this job. Nothing goes out about it."
                    : "Uses your workspace reminders."}
              </p>
            </div>
            <Switch
              checked={!(task.reminders_off ?? false)}
              aria-label="Remind this customer about this job"
              onCheckedChange={(on) =>
                setReminders.mutate({
                  taskId: task.id,
                  conversationId: task.conversation_id,
                  off: !on,
                })
              }
            />
          </section>
        )}

        {/* Description. */}
        <section className="flex flex-col gap-1.5">
          <Label htmlFor="task-description">Description</Label>
          <Textarea
            id="task-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            rows={3}
            maxLength={5000}
            placeholder="Add details for your crew…"
          />
        </section>

        {/* #214 job address — editable; enriched values carry a provenance badge. */}
        <TaskAddressSection
          task={task}
          onSave={(address) =>
            update.mutate(
              { taskId: task.id, address },
              { onError: () => toast.error("Couldn't save the address.") },
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
                Attachments
              </p>
              <TaskAttachments items={task.attachments} />
            </section>

            {/* Merged activity + discussion timeline (D-C + D-D). */}
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
                Activity
              </p>
              <TaskActivityTimeline items={task.activity} />
            </section>
          </>
        )}
      </div>

      {/* Note composer — posts a note linked to conversation + task (D-D). A
          no-access viewer can't note the hidden conversation, so it's hidden. */}
      {!noAccess && (
        <TaskNoteComposer taskId={task.id} conversationId={conversationId} />
      )}

      {/* #89: destructive-delete confirm — opened only for a task that carries
          notes or files (an empty task deletes straight from the menu). */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this task?</DialogTitle>
            <DialogDescription>
              This task has{" "}
              {taskDeleteSummary(deleteContent.notes, deleteContent.attachments)}
              . Deleting it removes the task and its activity for everyone. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={del.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={runDelete}
              disabled={del.isPending}
            >
              {del.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                "Delete task"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The merged task_* events + linked notes list, oldest-first. */
function TaskActivityTimeline({ items }: { items: TaskActivityItem[] }) {
  const memberNames = useMemberNames();

  if (items.length === 0) {
    return (
      <p className="text-[13px] text-app-muted">
        No activity yet. Post a note below to start a discussion.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) =>
        item.kind === "event" ? (
          <li
            key={`e:${item.id}`}
            className="text-[12px] leading-relaxed text-app-muted-2"
          >
            {taskEventSentence(
              item,
              item.actor?.display_name ??
                (item.actor_user_id
                  ? memberNames.get(item.actor_user_id) ?? "A teammate"
                  : "Loonext"),
              (userId) => (userId ? memberNames.get(userId) ?? null : null),
            ) ?? "Task updated"}
            <span className="ml-1 tabular-nums text-app-muted-2/80">
              · {format(new Date(item.created_at), "MMM d, h:mm a")}
            </span>
          </li>
        ) : (
          <li key={`n:${item.id}`} className="flex gap-2.5">
            <MemberAvatar
              name={item.author?.display_name ?? "A teammate"}
              className="mt-0.5 size-6"
            />
            <div className="min-w-0 flex-1 rounded-app-card border border-app-amber-line bg-app-amber-bg px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-semibold text-app-amber-ink">
                  {item.author?.display_name ?? "A teammate"}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-app-amber-ink/70">
                  {format(new Date(item.created_at), "MMM d, h:mm a")}
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-app-amber-ink">
                {item.body}
              </p>
            </div>
          </li>
        ),
      )}
    </ul>
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
  const [body, setBody] = useState("");
  const create = useCreateTaskNote(conversationId);
  const uploadFiles = useUploadNoteFiles();
  const stage = useStagedFiles();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drop = useFileDrop((files) => stage.admit(files));

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
      toast.error("Couldn't post your note.");
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
        ? "The note posted, but its files didn't upload. Re-attach them from the note's Files section in the thread."
        : `The note posted, but ${failed.length} of ${draftFiles.length} files didn't upload. Re-attach them from the note's Files section in the thread.`,
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
          aria-label="Attach files to this note"
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
        <Textarea
          ref={ref}
          value={body}
          onChange={(e) => setBody(e.target.value)}
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
          placeholder="Add a note to the discussion…"
          className="min-h-[44px] flex-1 resize-none"
          aria-label="Task discussion note"
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
            "Post"
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

const ADDR_FIELDS: { key: keyof AddrFields; label: string; full?: boolean }[] = [
  { key: "street", label: "Street", full: true },
  { key: "unit", label: "Unit / suite" },
  { key: "city", label: "City" },
  { key: "state", label: "State / province" },
  { key: "postal_code", label: "Postal code" },
  { key: "country", label: "Country", full: true },
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

function addrProvenanceLabel(p: AddressProvenance | null): string | null {
  switch (p) {
    case "message":
      return "From the message";
    case "contact":
      return "From the contact";
    case "company":
      return "Inferred from area code";
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

  const provLabel = addrProvenanceLabel(provenance);

  return (
    <section className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between rounded-md text-sm font-medium text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <MapPin className="size-4 text-app-muted-2" strokeWidth={1.75} />
          Address
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
              aria-label={f.label}
              placeholder={f.label}
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
