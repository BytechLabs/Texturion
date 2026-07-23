"use client";

import {
  FileText,
  Paperclip,
  Plus,
  Send as SendIcon,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MmsMediaType } from "@loonext/shared";

import { StagedFileChips } from "@/components/attachments/staged-file-chips";
import { DropOverlay, useFileDrop } from "@/components/attachments/use-file-drop";
import { useStagedFiles } from "@/components/attachments/use-staged-files";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUploadNoteFiles } from "@/lib/api/attachments";
import { useCreateNote } from "@/lib/api/conversations";
import { ApiError } from "@/lib/api/error";
import { useSendMessage, type OutboundMedia } from "@/lib/api/messages";
import { isFilePaste } from "@/lib/attachments/clipboard";
import {
  MMS_ACCEPT,
  MMS_MAX_MEDIA_ITEMS,
  partitionMmsFiles,
} from "@/lib/attachments/mms";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_OWNER,
} from "@/lib/attachments/validate";
import { cn } from "@/lib/utils";

import { formatBytes } from "./gallery-grouping";
import { segmentMeter, segmentTooltip } from "./segment-meter";
import { TemplatePicker } from "./template-picker";

export interface DraftAttachment {
  id: string;
  file: File;
  /** The type this item will be SENT as (#189: declared or extension-resolved). */
  contentType: MmsMediaType;
  /** Local object URL for image previews; null for non-image files. */
  previewUrl: string | null;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Removable draft chips (§3.1, #189): images keep their thumbnail preview;
 * every other deliverable file (audio, video, contact card, PDF, text) shows
 * as a quiet name-and-size chip. Nothing touches the network until send.
 */
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: DraftAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mx-auto flex max-w-[42rem] flex-wrap items-center gap-2 px-1 pb-2">
      {attachments.map((attachment) => {
        const name = attachment.file.name || "File";
        if (attachment.previewUrl !== null) {
          return (
            <span key={attachment.id} className="relative">
              {/* Local object URL preview — never uploaded until send. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.previewUrl}
                alt={name}
                className="size-14 rounded-md border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(attachment.id)}
                aria-label={`Remove ${name}`}
                className="tap-target absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-foreground hover:bg-secondary"
              >
                <X className="size-3" strokeWidth={1.75} />
              </button>
            </span>
          );
        }
        const size = formatBytes(attachment.file.size);
        return (
          <span
            key={attachment.id}
            className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-secondary/50 py-0.5 pl-2.5 pr-1 text-xs text-foreground"
          >
            <Paperclip className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="max-w-40 truncate">{name}</span>
            {size && (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {size}
              </span>
            )}
            <button
              type="button"
              onClick={() => onRemove(attachment.id)}
              aria-label={`Remove ${name}`}
              className="tap-target flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-out hover:bg-secondary hover:text-foreground"
            >
              <X className="size-3" strokeWidth={1.75} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** The result of admitting picked/dropped/pasted files into a text draft. */
export interface AdmitFilesResult {
  attachments: DraftAttachment[];
  /** Plain-language reasons for the files that did NOT make it — rendered
   * INLINE by the caller (#189), so a bad pick is explained where it happened. */
  errors: string[];
}

/**
 * Validate + admit files into the draft (#189): the shared MMS matrix
 * (type + size + count, extension fallback for empty OS types) runs locally
 * so a valid pick never round-trips to fail. Image admissions get an object
 * URL for their preview chip; other kinds render as name chips.
 */
export function admitFiles(
  current: DraftAttachment[],
  incoming: FileList | File[],
): AdmitFilesResult {
  const { accepted, rejected } = partitionMmsFiles(
    Array.from(incoming),
    current.length,
  );
  const next = [...current];
  for (const { file, contentType } of accepted) {
    next.push({
      id: crypto.randomUUID(),
      file,
      contentType,
      previewUrl: contentType.startsWith("image/")
        ? URL.createObjectURL(file)
        : null,
    });
  }
  return { attachments: next, errors: rejected.map((r) => r.reason) };
}

/** Inline (not toast) rejection lines under the draft chips (#189). */
export function MediaErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="mx-auto max-w-[42rem] space-y-0.5 px-1 pb-2" role="alert">
      {errors.map((error, index) => (
        <p key={index} className="text-xs text-destructive">
          {error}
        </p>
      ))}
    </div>
  );
}

/**
 * §3.2 passive segment hint: a quiet `stone-400` line that appears only once a
 * message splits into 2+ parts (when it costs an extra segment), reads "Sent in
 * N parts", turns amber only at ≥4 parts. It is TEXT, not a control — there is
 * no stepper, no +/−. Tabular numerals.
 */
export function SegmentMeterLabel({ text }: { text: string }) {
  const meter = segmentMeter(text);
  if (!meter.visible) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "cursor-default text-xs tabular-nums",
            // amber-700 clears the G11 4.5:1 text bar on white (--warning
            // amber-600 does not); stone-500 otherwise.
            meter.warn
              ? "text-amber-700 dark:text-warning"
              : "text-muted-foreground",
          )}
        >
          {meter.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {segmentTooltip(meter.segments)}
      </TooltipContent>
    </Tooltip>
  );
}

/** Auto-grow: 1 → 6 rows (§3.1), then internal scroll. */
export function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 24;
    const max = lineHeight * 6;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value]);
  return ref;
}

/**
 * The APP-LAYOUT-V2 §3 composer: a Google-Messages pill. Left → right, a single
 * fully-rounded pill (1px stone-200): a far-left `+` overflow (attach / template
 * — inline toolbar on desktop, action sheet on mobile), an auto-grow field
 * (1→6 rows), and ONE petrol send affordance derived from "field non-empty"
 * (attachment-only also enables send). There are NO up/down stepper buttons —
 * rows auto-grow from content and the segment count is a PASSIVE "Sent in N
 * parts" hint (§3.2), never a control. Cmd/Ctrl+Enter sends; Enter = newline
 * (SMS is deliberate, not chat-instant). The queued insert is the optimistic UI.
 *
 * A Text/Note toggle writes internal notes (amber, POST /:id/notes). When a
 * banner replaces the text composer (`noteOnly`), notes stay available.
 *
 * D28 — files enter through messages and notes: note mode has its own attach
 * affordance (staged chips above the pill; on save the note is created first,
 * then each staged file uploads with the note id), and BOTH modes accept
 * dropped files (a quiet dashed overlay) and pasted images, validated against
 * the active mode's limits (text: #189 MMS set, 3 files ≤1 MB; note: D19 —
 * 10 files ≤25 MB).
 *
 * The pill is constrained to the same 42rem reading track as the message column
 * (§3.1) so the send affordance sits under the messages it belongs to.
 */
export function Composer({
  conversationId,
  noteOnly = false,
}: {
  conversationId: string;
  noteOnly?: boolean;
}) {
  const send = useSendMessage(conversationId);
  const createNote = useCreateNote(conversationId);
  const uploadNoteFiles = useUploadNoteFiles();
  const [mode, setMode] = useState<"sms" | "note">(noteOnly ? "note" : "sms");
  const isNote = noteOnly || mode === "note";
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  // #189 inline rejection copy from the LAST admission attempt (type/size/
  // count) — rendered above the pill, replaced or cleared on the next intake.
  const [mediaErrors, setMediaErrors] = useState<string[]>([]);
  const noteStage = useStagedFiles();
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useAutoGrow(text);
  const fileRef = useRef<HTMLInputElement>(null);
  const noteFileRef = useRef<HTMLInputElement>(null);

  // Object URLs are revoked when chips are removed or the composer unmounts.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(
    () => () => {
      for (const a of attachmentsRef.current) {
        if (a.previewUrl !== null) URL.revokeObjectURL(a.previewUrl);
      }
    },
    [],
  );

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const found = current.find((a) => a.id === id);
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return current.filter((a) => a.id !== id);
    });
  };

  const pending = send.isPending || createNote.isPending;
  // §3.1 derive-send-from-content: send enables purely on "field non-empty"
  // (or, for a text, an attachment). No manual send state.
  const canSend =
    !pending &&
    (isNote
      ? text.trim() !== "" || noteStage.files.length > 0
      : text.trim() !== "" || attachments.length > 0);

  const openFilePicker = () => fileRef.current?.click();
  const insertTemplate = (body: string) => {
    setText((current) =>
      current === ""
        ? body
        : `${current}${current.endsWith(" ") ? "" : " "}${body}`,
    );
    textareaRef.current?.focus();
  };

  const doSend = useCallback(async () => {
    if (!canSend) return;
    const draftText = text;
    const draftAttachments = attachments;

    if (isNote) {
      // Clear immediately (fast by feel, G1); restore text + staged files on
      // failure. D28 staged-note-upload chain: the note is created first, then
      // each staged file POSTs with the returned note id.
      const draftFiles = noteStage.files;
      setText("");
      noteStage.clear();

      let note: Awaited<ReturnType<typeof createNote.mutateAsync>>;
      try {
        // mutateAsync resolves from the MutationCache even if the composer
        // unmounts before the response, so the upload chain below still runs
        // and staged files aren't silently dropped (D28 / finding #6).
        note = await createNote.mutateAsync(draftText);
      } catch (error) {
        setText(draftText);
        noteStage.restore(draftFiles);
        toast.error(
          error instanceof ApiError
            ? error.message
            : "That note didn't save. Try again.",
        );
        return;
      }

      // Pure-UI bit — safe to skip after unmount (ref is null then).
      textareaRef.current?.focus();

      if (draftFiles.length === 0) return;
      const { failed } = await uploadNoteFiles.mutateAsync({
        noteId: note.id,
        files: draftFiles.map((staged) => staged.file),
      });
      if (failed.length === 0) return;
      // Partial failure: the note saved — the bubble's Files section is the
      // retry surface (re-attach there), so keep it plain. The global sonner
      // toaster fires this even if the composer already unmounted.
      toast.error(
        failed.length === draftFiles.length
          ? "The note saved, but its files didn't upload. Re-attach them from the note's Files section."
          : `The note saved, but ${failed.length} of ${draftFiles.length} files didn't upload. Re-attach them from the note's Files section.`,
      );
      return;
    }
    // Clear immediately (fast by feel, G1); restore on failure.
    setText("");
    setAttachments([]);
    setMediaErrors([]);
    let media: OutboundMedia[] | undefined;
    try {
      if (draftAttachments.length > 0) {
        media = await Promise.all(
          draftAttachments.map(async (a) => ({
            content_type: a.contentType,
            base64: await fileToBase64(a.file),
          })),
        );
      }
    } catch {
      setText(draftText);
      setAttachments(draftAttachments);
      toast.error("Couldn't read that file. Try attaching it again.");
      return;
    }
    send.mutate(
      { body: draftText, media },
      {
        onSuccess: () => {
          for (const a of draftAttachments) {
            if (a.previewUrl !== null) URL.revokeObjectURL(a.previewUrl);
          }
          textareaRef.current?.focus();
        },
        onError: (error) => {
          setText(draftText);
          setAttachments(draftAttachments);
          toast.error(
            error instanceof ApiError
              ? error.message
              : "That didn't send. Check your connection and try again.",
          );
        },
      },
    );
  }, [
    canSend,
    text,
    attachments,
    send,
    textareaRef,
    isNote,
    createNote,
    noteStage,
    uploadNoteFiles,
  ]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void doSend();
      return;
    }
    // "/" in an empty draft opens the saved-replies picker inline (§3.1) —
    // texts only; notes have no templates.
    if (event.key === "/" && text === "" && !isNote) {
      event.preventDefault();
      setPickerOpen(true);
    }
  };

  // #189 text-mode intake: run the shared MMS matrix locally and surface the
  // rejections INLINE (never a round-trip for a pick this gate can decide).
  const admitDraftFiles = (files: FileList | File[]) => {
    const { attachments: next, errors } = admitFiles(attachments, files);
    setAttachments(next);
    setMediaErrors(errors);
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      admitDraftFiles(event.target.files);
    }
    event.target.value = "";
  };

  const onNoteFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      noteStage.admit(event.target.files);
    }
    event.target.value = "";
  };

  // D28 file intake for drops + pastes — validated per the ACTIVE mode's
  // rules (text: MMS 3×1 MB deliverable files; note: D19 10×25 MB allow-list).
  // Notes stage their files to storage; text mode stages MMS media (#97:
  // ungated).
  const admitIncoming = (files: FileList) => {
    if (isNote) {
      noteStage.admit(files);
      return;
    }
    admitDraftFiles(files);
  };

  const drop = useFileDrop(admitIncoming);

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Only intercept a genuine file paste. An Office/rich-text copy carries
    // text/html alongside a synthesized image — leave its text paste alone
    // (finding #10); plain text pastes never reach preventDefault either.
    if (!isFilePaste(event.clipboardData)) return;
    event.preventDefault();
    admitIncoming(event.clipboardData.files);
  };

  const attachDisabled = attachments.length >= MMS_MAX_MEDIA_ITEMS;
  const noteAttachDisabled = noteStage.files.length >= MAX_ATTACHMENTS_PER_OWNER;

  return (
    <div
      className="relative px-3 pb-3 pt-2 md:px-4 md:pb-4"
      {...drop.handlers}
    >
      <DropOverlay active={drop.active} />
      {!noteOnly && (
        <div
          className="mx-auto mb-2 flex max-w-[42rem] gap-1"
          role="group"
          aria-label="Composer mode"
        >
          {(["sms", "note"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                // tap-target + roomier mobile padding: G11 ≥44px hit area.
                "tap-target rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150 ease-out md:px-2.5 md:py-0.5 md:text-[11px]",
                mode === m
                  ? m === "note"
                    ? "bg-app-amber-bg text-app-amber-ink"
                    : "bg-app-tint text-app-petrol-deep"
                  : "text-app-muted hover:text-app-ink",
              )}
            >
              {m === "sms" ? "Text" : "Note"}
            </button>
          ))}
        </div>
      )}
      {!isNote && <MediaErrors errors={mediaErrors} />}
      {!isNote && (
        <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
      )}
      {isNote && (
        <StagedFileChips
          files={noteStage.files}
          onRemove={noteStage.remove}
          className="mx-auto max-w-[42rem] px-1 pb-2"
        />
      )}
      {/* The elevated composer CARD (mockup .composer): a white card with the
          panel shadow + hairline, constrained to the 42rem reading track. */}
      <div
        className={cn(
          "mx-auto flex max-w-[42rem] items-end gap-1 rounded-app-card border px-2 py-1.5 transition-[border-color,box-shadow]",
          "focus-within:border-app-petrol focus-within:ring-[3px] focus-within:ring-app-tint",
          isNote
            ? "border-app-amber-line bg-app-amber-bg"
            : "border-app-line bg-app-white",
        )}
      >
        {/* Far-left `+` overflow (§3.1) — texts get Attach + Template
            (desktop: inline toolbar; mobile: the `+` action menu); notes get
            their own attach affordance below (D28 — notes have no templates). */}
        {!isNote && (
          <>
            {/* Desktop inline toolbar. */}
            <div className="hidden items-center self-end pb-0.5 md:flex">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Attach files"
                    onClick={openFilePicker}
                    disabled={attachDisabled}
                    className="rounded-full text-muted-foreground"
                  >
                    <Paperclip className="size-5" strokeWidth={1.75} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Attach up to {MMS_MAX_MEDIA_ITEMS} files, 1 MB each
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Insert a saved reply"
                    onClick={() => setPickerOpen(true)}
                    className="rounded-full text-muted-foreground"
                  >
                    <FileText className="size-5" strokeWidth={1.75} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Saved replies, or type “/”</TooltipContent>
              </Tooltip>
            </div>

            {/* Mobile `+` action menu — Attach · Template. */}
            <div className="self-end pb-0.5 md:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Add to message"
                    className="rounded-full text-muted-foreground"
                  >
                    <Plus className="size-5" strokeWidth={1.75} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  side="top"
                  className="w-44"
                  // #120: both items open ANOTHER surface (the file dialog /
                  // the saved-replies popover). Radix's default close behavior
                  // returns focus to the + trigger, which on mobile yanked
                  // focus out of the just-opened picker: the keyboard flashed
                  // up, focus snapped back, and the popover dismissed itself
                  // as "focus outside" — "nothing happens".
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  <DropdownMenuItem
                    onSelect={openFilePicker}
                    disabled={attachDisabled}
                  >
                    <Paperclip className="size-4" strokeWidth={1.75} aria-hidden />
                    Attach a file
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
                    <FileText className="size-4" strokeWidth={1.75} aria-hidden />
                    Saved reply
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept={MMS_ACCEPT}
              multiple
              hidden
              onChange={onFileChange}
            />
          </>
        )}

        {/* Note-mode attach (D28): files ride the note — staged here, uploaded
            with the note id on save. One quiet paperclip, all breakpoints. */}
        {isNote && (
          <>
            <div className="flex items-center self-end pb-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Attach files to this note"
                    onClick={() => noteFileRef.current?.click()}
                    disabled={noteAttachDisabled}
                    className="rounded-full text-muted-foreground"
                  >
                    <Paperclip className="size-5" strokeWidth={1.75} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Attach up to {MAX_ATTACHMENTS_PER_OWNER} files, 25 MB each
                </TooltipContent>
              </Tooltip>
            </div>
            <input
              ref={noteFileRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              hidden
              onChange={onNoteFileChange}
            />
          </>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          placeholder={isNote ? "Write an internal note…" : "Text message"}
          aria-label={isNote ? "Internal note" : "Message"}
          className={cn(
            // 16px on mobile (iOS zoom lock, §3.1); generous vertical padding.
            "min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[16px] leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-0 md:text-[15px]",
          )}
        />

        <div className="flex items-center gap-2 self-end pb-1 pr-0.5">
          {!isNote && <SegmentMeterLabel text={text} />}
          {/* The single petrol control in this region (mockup .btn-primary.send)
              — a petrol pill with the send glyph and a soft petrol shadow. Active
              only when the field is non-empty. Notes reuse the amber accent. */}
          <button
            type="button"
            onClick={() => void doSend()}
            disabled={!canSend}
            aria-label={isNote ? "Save note" : "Send message"}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-app-ctrl px-3 text-[13px] font-semibold text-white transition-[background,transform] duration-150 ease-out active:translate-y-px disabled:opacity-45",
              isNote
                ? "bg-app-amber hover:brightness-105"
                : "bg-primary hover:bg-app-petrol-deep",
            )}
          >
            <span className="hidden sm:inline">
              {isNote ? "Save" : "Send"}
            </span>
            <SendIcon className="size-[15px]" />
          </button>
        </div>
      </div>

      {/* §3.1: the template picker is anchored to the pill and opens from `/`,
          the desktop toolbar button, or the mobile `+` menu. */}
      {!isNote && (
        <TemplatePicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onInsert={insertTemplate}
        >
          <span
            aria-hidden
            className="pointer-events-none mx-auto block h-0 max-w-[42rem]"
          />
        </TemplatePicker>
      )}
    </div>
  );
}
