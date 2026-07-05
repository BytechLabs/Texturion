"use client";

import { format } from "date-fns";
import {
  ArrowUpRight,
  Loader2,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  useCreateTaskNote,
  useDeleteTask,
  useTask,
  useUpdateTask,
} from "@/lib/api/tasks";
import { useMembers } from "@/lib/api/team";
import type { TaskActivityItem, TaskDetail } from "@/lib/api/types";
import { isFilePaste } from "@/lib/attachments/clipboard";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_OWNER,
} from "@/lib/attachments/validate";
import { cn } from "@/lib/utils";

import { TaskDoneCheckbox } from "./task-atoms";
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

  const update = useUpdateTask(conversationId);
  const del = useDeleteTask(conversationId);

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

  const saveAssignee = (value: string) => {
    update.mutate(
      { taskId: task.id, assigned_user_id: value === UNASSIGNED ? null : value },
      { onError: () => toast.error("Couldn't reassign this task.") },
    );
  };

  const saveDue = (value: string) => {
    update.mutate(
      {
        taskId: task.id,
        // <input type="datetime-local"> yields a local wall-clock string; store
        // an ISO instant. An empty field clears the due date.
        due_at: value === "" ? null : new Date(value).toISOString(),
      },
      { onError: () => toast.error("Couldn't change the due date.") },
    );
  };

  // Delete is the creator, or an owner/admin (T4 M*).
  const canDelete =
    role === "owner" ||
    role === "admin" ||
    me.data?.user_id === task.created_by_user_id;

  const runDelete = () => {
    del.mutate(task.id, {
      onSuccess: () => {
        toast.success("Task deleted.");
        onClose?.();
      },
      onError: () => toast.error("Couldn't delete this task."),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: done state + overflow (delete). */}
      <div className="flex items-start gap-3 border-b border-app-line px-5 pb-4 pt-5">
        <TaskDoneCheckbox task={task} className="mt-1" />
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
              "focus-visible:bg-app-stone-1 focus-visible:ring-2 focus-visible:ring-ring/50",
              task.done && "text-app-muted line-through opacity-70",
            )}
          />
        </div>
        {canDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Task actions"
                className="tap-target -mr-1 mt-0.5 shrink-0 rounded-full p-1 text-app-muted-2 transition-colors hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <MoreHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                variant="destructive"
                onSelect={runDelete}
                disabled={del.isPending}
              >
                <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                Delete task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Scrollable body. */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {/* Source message + thread link. */}
        {task.source_message && (
          <section aria-label="Source message" className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
              From this message
            </p>
            <div className="rounded-app-card border border-app-line bg-app-stone-1 p-3">
              <p className="whitespace-pre-wrap break-words text-[13px] text-app-ink">
                {task.source_message.body.trim() === ""
                  ? "A photo"
                  : task.source_message.body}
              </p>
              <Link
                href={`/inbox/${conversationId}?message=${task.message_id}`}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-app-petrol hover:text-app-petrol-deep"
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
            <Label htmlFor="task-due">Due</Label>
            <Input
              id="task-due"
              type="datetime-local"
              defaultValue={toLocalInput(task.due_at)}
              key={task.due_at ?? "none"}
              onChange={(e) => saveDue(e.target.value)}
            />
          </div>
        </section>

        {/* Description. */}
        <section className="flex flex-col gap-1.5">
          <Label htmlFor="task-description">Notes</Label>
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

        {/* Attachments — the D28 DERIVED union (source-message MMS + files on
            task-linked notes + legacy rows), a read view: files are attached
            through the discussion composer below, never uploaded to the task. */}
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
      </div>

      {/* Note composer — posts a note linked to conversation + task (D-D). */}
      <TaskNoteComposer taskId={task.id} conversationId={conversationId} />
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
    const trimmed = body.trim();
    if (trimmed === "") return;

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
        ? "The note posted, but its files didn't upload — re-attach them from the note's Files section in the thread."
        : `The note posted, but ${failed.length} of ${draftFiles.length} files didn't upload — re-attach them from the note's Files section in the thread.`,
    );
  };

  return (
    <div
      className="relative shrink-0 border-t border-app-line bg-app-white p-4"
      {...drop.handlers}
    >
      <DropOverlay active={drop.active} />
      <StagedFileChips
        files={stage.files}
        onRemove={stage.remove}
        className="pb-2"
      />
      {/* A note needs a line of text to save (files ride the note). Say so
          quietly when files are staged but the body is still empty (#8). */}
      {stage.files.length > 0 && body.trim() === "" && (
        <p className="pb-2 text-xs text-app-muted">
          Add a line of text to save these files
        </p>
      )}
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
          disabled={create.isPending || body.trim() === ""}
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
