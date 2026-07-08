"use client";

import {
  FileText,
  ImagePlus,
  Paperclip,
  Plus,
  Send as SendIcon,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
import { useModules } from "@/lib/api/billing";
import { useCreateNote } from "@/lib/api/conversations";
import { ApiError } from "@/lib/api/error";
import { useSendMessage, type OutboundMedia } from "@/lib/api/messages";
import { isFilePaste } from "@/lib/attachments/clipboard";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_OWNER,
} from "@/lib/attachments/validate";
import { cn } from "@/lib/utils";

import {
  droppedPhotoNotice,
  MMS_DROP_ACTION_LABEL,
  MMS_GATE_ACTION_LABEL,
  MMS_GATE_MESSAGE,
  MMS_SETTINGS_PATH,
  mmsAttachGated,
  photosDropped,
} from "./mms-gate";
import { segmentMeter, segmentTooltip } from "./segment-meter";
import { TemplatePicker } from "./template-picker";

/** SPEC §7 outbound media limits — validated here AND by the API. */
const MAX_ATTACHMENTS = 3;
const MAX_BYTES = 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);

export interface DraftAttachment {
  id: string;
  file: File;
  previewUrl: string;
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

/** Removable chip previews for attached images (§3.1). */
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: DraftAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mx-auto flex max-w-[42rem] gap-2 px-1 pb-2">
      {attachments.map((attachment) => (
        <span key={attachment.id} className="relative">
          {/* Local object URL preview — never uploaded until send. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachment.previewUrl}
            alt={attachment.file.name}
            className="size-14 rounded-md border border-border object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            aria-label={`Remove ${attachment.file.name}`}
            className="tap-target absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-foreground hover:bg-secondary"
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Validate + admit files into the draft; G10 error copy. */
export function admitFiles(
  current: DraftAttachment[],
  incoming: FileList | File[],
): DraftAttachment[] {
  const next = [...current];
  for (const file of Array.from(incoming)) {
    if (next.length >= MAX_ATTACHMENTS) {
      toast.error("You can attach up to 3 photos per text.");
      break;
    }
    if (!ACCEPTED_TYPES.has(file.type)) {
      toast.error("Photos only: JPEG, PNG, or GIF.");
      continue;
    }
    if (file.size > MAX_BYTES) {
      toast.error("That image is over 1 MB. Try a smaller photo.");
      continue;
    }
    next.push({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    });
  }
  return next;
}

/**
 * §3.2 passive segment hint: a quiet `stone-400` line that appears only past
 * 120 chars, reads "Sent in N parts", turns amber only at ≥4 parts. It is TEXT,
 * not a control — there is no stepper, no +/−. Tabular numerals.
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
 * #62 — the Picture-messages add-on gate, shared by BOTH composers (in-thread
 * and /inbox/new) so the attach affordance behaves identically everywhere:
 * module off → the photo button stays visible but explains itself (one toast
 * pointing at Settings › Billing, mirroring the missed-calls page's voice
 * gate) and staging is blocked — no dead-end 409 after the draft is written.
 * While the module list loads, the affordance stays live (the API is the
 * backstop), so companies WITH the add-on never see it flicker.
 */
export function useMmsGate() {
  const modules = useModules();
  const router = useRouter();
  const gated = mmsAttachGated(modules.data?.modules);
  const explain = useCallback(() => {
    toast(MMS_GATE_MESSAGE, {
      action: {
        label: MMS_GATE_ACTION_LABEL,
        onClick: () => router.push(MMS_SETTINGS_PATH),
      },
    });
  }, [router]);
  return { gated, explain };
}

/**
 * #23 — honest cap-and-drop feedback, shared by both send paths: the API
 * strips over-cap photos and answers 2xx, so when a send that carried media
 * comes back without attachments, say so out loud with a route to the fix.
 * Long duration: this is the only recovery signal for a quiet data loss.
 */
export function useDroppedPhotoNotice() {
  const router = useRouter();
  return useCallback(
    (count: number) => {
      toast.error(droppedPhotoNotice(count), {
        action: {
          label: MMS_DROP_ACTION_LABEL,
          onClick: () => router.push(MMS_SETTINGS_PATH),
        },
        duration: 10_000,
      });
    },
    [router],
  );
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
 * the active mode's limits (text: 3 photos ≤1 MB; note: D19 — 10 files ≤25 MB).
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
  const noteStage = useStagedFiles();
  const [pickerOpen, setPickerOpen] = useState(false);
  const mms = useMmsGate();
  const notifyDroppedPhotos = useDroppedPhotoNotice();
  // #23 — photos the LAST send cap-and-dropped (0 = no notice). Feeds the
  // inline line above the pill; cleared by the next send or its dismiss X.
  const [droppedCount, setDroppedCount] = useState(0);
  const textareaRef = useAutoGrow(text);
  const fileRef = useRef<HTMLInputElement>(null);
  const noteFileRef = useRef<HTMLInputElement>(null);

  // Object URLs are revoked when chips are removed or the composer unmounts.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(
    () => () => {
      for (const a of attachmentsRef.current) URL.revokeObjectURL(a.previewUrl);
    },
    [],
  );

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const found = current.find((a) => a.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
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
    setDroppedCount(0);
    let media: OutboundMedia[] | undefined;
    try {
      if (draftAttachments.length > 0) {
        media = await Promise.all(
          draftAttachments.map(async (a) => ({
            content_type: a.file.type as OutboundMedia["content_type"],
            base64: await fileToBase64(a.file),
          })),
        );
      }
    } catch {
      setText(draftText);
      setAttachments(draftAttachments);
      toast.error("Couldn't read that photo. Try attaching it again.");
      return;
    }
    send.mutate(
      { body: draftText, media },
      {
        onSuccess: (message) => {
          for (const a of draftAttachments) URL.revokeObjectURL(a.previewUrl);
          // #23: a 2xx that carried media OUT but none BACK means the API
          // cap-and-dropped the photos — the text went, the pictures didn't.
          // Say so (toast + inline line) instead of faking a full success.
          if (photosDropped(draftAttachments.length, message)) {
            setDroppedCount(draftAttachments.length);
            notifyDroppedPhotos(draftAttachments.length);
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
    notifyDroppedPhotos,
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

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setAttachments((cur) => admitFiles(cur, event.target.files!));
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
  // rules (text: MMS 3×1 MB images; note: D19 10×25 MB allow-list). Text-mode
  // intake is #62-gated: without the Picture messages add-on nothing stages —
  // the pointer toast explains instead of a post-send 409 dead end. Notes are
  // untouched (their files ride storage, not MMS).
  const admitIncoming = (files: FileList) => {
    if (isNote) {
      noteStage.admit(files);
      return;
    }
    if (mms.gated) {
      mms.explain();
      return;
    }
    setAttachments((cur) => admitFiles(cur, files));
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

  const attachDisabled = attachments.length >= MAX_ATTACHMENTS;
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
      {!isNote && droppedCount > 0 && (
        // #23 inline honest-state line: sits where the sent bubble just
        // appeared without its thumbnail, and outlives the toast. One amber
        // sentence + the route to the fix; dismissable, cleared by next send.
        <div
          role="status"
          className="mx-auto mb-2 flex max-w-[42rem] items-start justify-between gap-2 rounded-md border border-app-amber-line bg-app-amber-bg px-3 py-2 text-xs text-app-amber-ink"
        >
          <p>
            {droppedPhotoNotice(droppedCount)}{" "}
            <Link
              href={MMS_SETTINGS_PATH}
              className="font-medium underline underline-offset-2"
            >
              Plan add-ons
            </Link>
          </p>
          <button
            type="button"
            onClick={() => setDroppedCount(0)}
            aria-label="Dismiss"
            className="rounded-full p-0.5 hover:bg-app-amber-line/40"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}
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
                    aria-label="Attach a photo"
                    onClick={mms.gated ? mms.explain : openFilePicker}
                    disabled={attachDisabled}
                    className="rounded-full text-muted-foreground"
                  >
                    <ImagePlus className="size-5" strokeWidth={1.75} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {mms.gated
                    ? "Picture messages is an add-on. Turn it on in Settings › Billing"
                    : "Attach up to 3 photos"}
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
                <DropdownMenuContent align="start" side="top" className="w-44">
                  <DropdownMenuItem
                    onSelect={mms.gated ? mms.explain : openFilePicker}
                    disabled={attachDisabled}
                  >
                    <ImagePlus className="size-4" strokeWidth={1.75} aria-hidden />
                    Attach a photo
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
              accept="image/jpeg,image/png,image/gif"
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
