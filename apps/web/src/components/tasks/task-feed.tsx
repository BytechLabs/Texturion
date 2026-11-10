"use client";

import { Loader2, MoreHorizontal, Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { AttachmentItem } from "@/components/attachments/attachment-item";
import { DropOverlay, useFileDrop } from "@/components/attachments/use-file-drop";
import { StagedFileChips } from "@/components/attachments/staged-file-chips";
import { useStagedFiles } from "@/components/attachments/use-staged-files";
import { MemberAvatar } from "@/components/inbox/member-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/provider";
import {
  useAddTaskComment,
  useDeleteTaskComment,
  useEditTaskComment,
  useTaskActivity,
  useUploadCommentFiles,
} from "@/lib/api/task-activity";
import type { TaskFeedItem } from "@/lib/api/types";
import { isFilePaste } from "@/lib/attachments/clipboard";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_OWNER,
} from "@/lib/attachments/validate";
import { Timestamp } from "@/components/ui/timestamp";

import { taskHistorySentence } from "./task-history";
import { taskNumberLabel } from "@loonext/shared";
import Link from "next/link";
import { ReferencePicker } from "./reference-picker";
import { ReferenceText } from "./reference-text";
import { useReferenceTrigger } from "./use-reference-trigger";

type CommentItem = Extract<TaskFeedItem, { kind: "comment" }>;

const COMMENT_MAX_LENGTH = 4000;

/**
 * A task's activity: what changed on it, what the crew said, and the thread note
 * a message task came from, in one list oldest first (#689 E). The comment box
 * is a separate piece pinned under the panel.
 */
export function TaskFeed({
  taskId,
  userId,
  canModerate,
}: {
  taskId: string;
  userId: string | undefined;
  /** An owner or admin may delete anyone's comment. */
  canModerate: boolean;
}) {
  const t = useT();
  const activity = useTaskActivity(taskId);

  if (activity.isPending) {
    return <Loader2 className="size-4 animate-spin text-app-muted" aria-hidden />;
  }
  if (activity.isError) {
    return (
      <p className="text-[13px] text-app-muted">{t("tasks.activityLoadFailed")}</p>
    );
  }
  if (activity.items.length === 0) {
    return <p className="text-[13px] text-app-muted">{t("tasks.activityEmpty")}</p>;
  }

  return (
    <div className="space-y-3">
      {activity.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void activity.fetchNextPage()}
          disabled={activity.isFetchingNextPage}
          className="text-app-muted"
        >
          {t("tasks.activityEarlier")}
        </Button>
      )}
      <ul className="space-y-3">
        {activity.items.map((item) => (
          <li key={`${item.kind}:${item.id}`}>
            {item.kind === "event" ? (
              <HistoryLine item={item} />
            ) : item.kind === "comment" ? (
              <Comment
                taskId={taskId}
                item={item}
                canEdit={item.author?.user_id === userId}
                canDelete={canModerate || item.author?.user_id === userId}
              />
            ) : item.kind === "reference" ? (
              <ReferenceLine item={item} />
            ) : (
              <Note item={item} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HistoryLine({ item }: { item: Extract<TaskFeedItem, { kind: "event" }> }) {
  const t = useT();
  // A change nobody made (a job, the customer's reply) is the product's own.
  const by = item.actor?.display_name ?? (item.actor ? t("tasks.aTeammate") : "Loonext");
  return (
    <p className="text-[12px] leading-relaxed text-app-muted-2">
      {taskHistorySentence(item, by, t)}
      <span className="ml-1 tabular-nums text-app-muted-2/80">
        · <Timestamp at={item.created_at} style="long" />
      </span>
    </p>
  );
}

/**
 * #690: where this task is referenced from, or what its own text points at.
 * A back-reference whose conversation is on a number this member may not see
 * never arrives, so there is nothing here to hide.
 */
function ReferenceLine({
  item,
}: {
  item: Extract<TaskFeedItem, { kind: "reference" }>;
}) {
  const t = useT();
  const by = item.author?.display_name ?? (item.author ? t("tasks.aTeammate") : "Loonext");
  const customer = item.contact?.name ?? t("tasks.aCustomer");
  const task = item.task
    ? `${taskNumberLabel(item.task.number)} ${item.task.title ?? ""}`.trim()
    : "";
  let sentence: string;
  let href: string | null = null;
  if (item.direction === "in") {
    if (item.source_kind === "note") {
      sentence = t("tasks.refInNote", { by, customer });
      href = item.conversation_id ? `/inbox/${item.conversation_id}` : null;
    } else if (item.task) {
      sentence = t("tasks.refInTask", { by, task });
      href = `/tasks?task=${item.task.id}`;
    } else {
      sentence = t("tasks.refInComment", { by });
    }
  } else if (item.target_kind === "contact") {
    sentence = t("tasks.refOutContact", { customer });
    href = item.contact ? `/contacts/${item.contact.id}` : null;
  } else if (item.target_kind === "conversation") {
    sentence = t("tasks.refOutConversation", { customer });
    href = item.conversation_id ? `/inbox/${item.conversation_id}` : null;
  } else {
    sentence = t("tasks.refOutTask", { task });
    href = item.task ? `/tasks?task=${item.task.id}` : null;
  }
  const body = (
    <>
      {sentence}
      <span className="ml-1 tabular-nums text-app-muted-2/80">· <Timestamp at={item.created_at} style="long" /></span>
    </>
  );
  return (
    <p className="text-[12px] leading-relaxed text-app-muted-2">
      {href ? (
        <Link href={href} className="hover:text-app-ink hover:underline">
          {body}
        </Link>
      ) : (
        body
      )}
    </p>
  );
}

function Note({ item }: { item: Extract<TaskFeedItem, { kind: "note" }> }) {
  const t = useT();
  const name = item.author?.display_name ?? t("tasks.aTeammate");
  return (
    <div className="flex gap-2.5">
      <MemberAvatar name={name} className="mt-0.5 size-6" />
      <div className="min-w-0 flex-1 rounded-app-card border border-app-amber-line bg-app-amber-bg px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-semibold text-app-amber-ink">{name}</span>
          <Timestamp
            at={item.created_at}
            style="long"
            className="shrink-0 text-[11px] text-app-amber-ink/70"
          />
        </div>
        <p className="mt-0.5 text-[13px] text-app-amber-ink">
          <ReferenceText text={item.body} />
        </p>
      </div>
    </div>
  );
}

function Comment({
  taskId,
  item,
  canEdit,
  canDelete,
}: {
  taskId: string;
  item: CommentItem;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const t = useT();
  const edit = useEditTaskComment(taskId);
  const remove = useDeleteTaskComment(taskId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.body);
  const name = item.author?.display_name ?? t("tasks.aTeammate");

  const save = () => {
    const body = draft.trim();
    if (body === "" || edit.isPending) return;
    if (body === item.body) {
      setEditing(false);
      return;
    }
    edit.mutate(
      { commentId: item.id, body },
      {
        onSuccess: () => setEditing(false),
        onError: () => toast.error(t("tasks.commentSaveFailed")),
      },
    );
  };

  return (
    <div className="flex gap-2.5">
      <MemberAvatar name={name} className="mt-0.5 size-6" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-semibold text-app-ink">{name}</span>
          <span className="text-[11px] tabular-nums text-app-muted-2">
            <Timestamp at={item.created_at} style="long" />
            {item.edited_at !== null && ` · ${t("tasks.commentEdited")}`}
          </span>
          {(canEdit || canDelete) && !editing && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("tasks.commentActionsAria")}
                  className="ml-auto size-6 text-app-muted"
                >
                  <MoreHorizontal className="size-4" strokeWidth={1.75} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setDraft(item.body);
                      setEditing(true);
                    }}
                  >
                    {t("tasks.commentEdit")}
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem
                    onSelect={() =>
                      remove.mutate(
                        { commentId: item.id },
                        {
                          onError: () => toast.error(t("tasks.commentDeleteFailed")),
                        },
                      )
                    }
                  >
                    {t("tasks.commentDelete")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {editing ? (
          <div className="mt-1 space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              maxLength={COMMENT_MAX_LENGTH}
              aria-label={t("tasks.commentAria")}
              className="resize-none"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={edit.isPending || draft.trim() === ""}
              >
                {t("tasks.commentSave")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 text-[13px] text-app-ink">
            <ReferenceText text={item.body} />
          </p>
        )}
        {item.attachments.length > 0 && (
          <div className="mt-2 space-y-2">
            {item.attachments.map((file) => (
              <AttachmentItem key={file.id} attachment={file} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The comment box pinned under the panel. Files stage as chips (picker, drop or
 * paste); the comment posts first, then each file uploads to it, and a partial
 * failure keeps the comment.
 */
export function TaskCommentComposer({ taskId }: { taskId: string }) {
  const t = useT();
  const [body, setBody] = useState("");
  const add = useAddTaskComment(taskId);
  const uploadFiles = useUploadCommentFiles(taskId);
  const stage = useStagedFiles();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drop = useFileDrop((files) => stage.admit(files));
  const refs = useReferenceTrigger(() => body, setBody);

  const submit = async () => {
    if (add.isPending) return;
    const trimmed = body.trim();
    if (trimmed === "") return;

    const draftBody = body;
    const draftFiles = stage.files;
    setBody("");
    stage.clear();

    let comment: TaskFeedItem;
    try {
      comment = await add.mutateAsync({ body: trimmed });
    } catch {
      setBody(draftBody);
      stage.restore(draftFiles);
      toast.error(t("tasks.commentPostFailed"));
      return;
    }
    ref.current?.focus();

    if (draftFiles.length === 0) return;
    const { failed } = await uploadFiles.mutateAsync({
      commentId: comment.id,
      files: draftFiles.map((staged) => staged.file),
    });
    if (failed.length === 0) return;
    toast.error(
      failed.length === draftFiles.length
        ? t("tasks.commentFilesAllFailed")
        : t("tasks.commentFilesSomeFailed", {
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
      <StagedFileChips files={stage.files} onRemove={stage.remove} className="pb-2" />
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
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.repeat) {
              e.preventDefault();
              void submit();
            }
          }}
          onPaste={(e) => {
            if (!isFilePaste(e.clipboardData)) return;
            e.preventDefault();
            stage.admit(e.clipboardData.files);
          }}
          rows={2}
          maxLength={COMMENT_MAX_LENGTH}
          placeholder={t("tasks.commentPlaceholder")}
          className="min-h-[44px] flex-1 resize-none"
          aria-label={t("tasks.commentAria")}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={add.isPending || body.trim() === ""}
        >
          {add.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            t("tasks.commentPost")
          )}
        </Button>
      </div>
    </div>
  );
}
