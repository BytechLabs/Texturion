"use client";

import {
  FileText,
  Paperclip,
  Plus,
  Send as SendIcon,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  appendIdentificationSuffix,
  applyMergeFields,
  hasMergeFields,
  type MmsMediaType,
} from "@loonext/shared";

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
import { ReplySuggestionChips } from "./reply-suggestion-chips";
import { useUploadNoteFiles } from "@/lib/api/attachments";
import { useCompany } from "@/lib/api/companies";
import {
  clearDraftMentions,
  loadDraft,
  loadDraftMentions,
  saveDraft,
  saveDraftMentions,
} from "@/lib/messaging/composer-drafts";
import {
  cacheSuggestions,
  readCachedSuggestions,
} from "@/lib/messaging/draft-suggestions-cache";
import { draftOutcome } from "@/lib/ai/outcome";
import {
  reportAiOutcome,
  useConversation,
  useCreateNote,
} from "@/lib/api/conversations";
import {
  suggestionFailureMessage,
  useReplySuggestions,
} from "@/lib/api/reply-suggestions";
import { AiOrb } from "@/components/ui/ai-orb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  duplicateReplyPrompt,
  duplicateReplyWarning,
} from "@loonext/shared";

import { ApiError } from "@/lib/api/error";
import {
  attachmentSignature,
  idempotencyKeyFor,
  type FailedAttempt,
} from "@/lib/api/idempotency";
import {
  useMessages,
  useSendMessage,
  type OutboundMedia,
} from "@/lib/api/messages";
import { useMe } from "@/lib/api/me";
import { useMembers } from "@/lib/api/team";
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
import { useCompanyId } from "@/lib/company/provider";

import { formatBytes } from "./gallery-grouping";
import { segmentMeter, segmentTooltip } from "./segment-meter";
import { MentionPicker } from "./mention-picker";
import {
  insertMention,
  isMentionTrigger,
  resolveMentions,
  type PickedMention,
} from "./mentions";
import { TemplatePicker } from "./template-picker";

export interface DraftAttachment {
  id: string;
  file: File;
  /** The type this item will be SENT as (#189: declared or extension-resolved). */
  contentType: MmsMediaType;
  /** Local object URL for image previews; null for non-image files. */
  previewUrl: string | null;
}

/** Matches the server's cap so the composer refuses before the note bounces. */
const MAX_MENTIONS_PER_NOTE = 10;

/**
 * Turn a mention rejection into something a person can act on.
 *
 * The API answers a bad mention with a zod-shaped string that opens with the
 * field name. That is right for the wire and wrong on screen: the author reads
 * "mention_user_ids" and cannot tell which teammate to remove.
 */
export function mentionAwareMessage(message: string): string {
  if (!message.startsWith("mention_user_ids")) return message;
  return message.includes("access to this conversation")
    ? "One of the teammates you named can't see this conversation. Remove them and save again."
    : `A note can name up to ${MAX_MENTIONS_PER_NOTE} teammates. Assign the thread if the whole crew needs it.`;
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
export function SegmentMeterLabel({
  text,
  hasMedia = false,
  contactName,
  businessName,
  identificationSuffix,
}: {
  text: string;
  hasMedia?: boolean;
  /** #415: the SAME values {@link MergeFieldPreview} renders with. */
  contactName?: string | null;
  businessName?: string | null;
  /**
   * #393: the server-resolved suffix a first text will be signed with, when it
   * applies to THIS recipient — null otherwise. Same argument as the merge
   * values above: the suffix is part of what sends, so it is part of what the
   * meter counts. It is passed in rather than composed here so the count cannot
   * drift from the body the server bills.
   */
  identificationSuffix?: string | null;
}) {
  // #415: measure what SENDS, not what was typed. The preview one line below
  // has always substituted; the meter counted the raw draft, so a message
  // built around {business_name} — 15 characters, against "Wilson & Sons
  // Plumbing and Heating" at 34 — was reported a part short every single time
  // it was sent, for the life of the template.
  //
  // The encoding boundary is where it stops being a rounding error. An accent
  // or a curly apostrophe arriving through a name flips the WHOLE message from
  // GSM-7 to UCS-2, and per-part capacity falls from 160 to 70 — so a 150-
  // character draft the meter called one part can send as three. "Ménard
  // Plomberie" and "O'Brien Heating" are the names this product's Canada-first
  // positioning actively courts.
  //
  // Taking the merge values as props rather than metering the raw string is
  // the point: a caller cannot render this label without deciding what it
  // substitutes.
  const meter = segmentMeter(
    // Merge fields first, then the signature — the exact order the send path
    // uses (apps/api/src/routes/compose.ts), so this counts that same string.
    appendIdentificationSuffix(
      applyMergeFields(text, { contactName, businessName }),
      identificationSuffix,
    ),
    hasMedia,
  );
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

/**
 * The live send-time substitution, shown only while the draft actually holds a
 * {token}. Both phone apps have shown this since the merge fields shipped;
 * without it the web composer was the one place you typed {first_name} and
 * could not tell what the customer would read, including when an unresolvable
 * token gets dropped and the sentence closes up around it.
 */
export function MergeFieldPreview({
  text,
  contactName,
  businessName,
  identificationSuffix,
}: {
  text: string;
  contactName?: string | null;
  businessName?: string | null;
  /** #393: the signature this send will carry, when it applies. */
  identificationSuffix?: string | null;
}) {
  // #393: a plain draft about to be SIGNED needs the preview too — otherwise
  // the one case where the sent text differs from the typed text without any
  // {token} to hint at it is the case with no preview at all.
  const signed = identificationSuffix ? identificationSuffix.length > 0 : false;
  if (!hasMergeFields(text) && !signed) return null;
  if (text.trim().length === 0) return null;
  return (
    <p className="truncate text-xs text-muted-foreground">
      Sends as:{" "}
      {appendIdentificationSuffix(
        applyMergeFields(text, { contactName, businessName }),
        identificationSuffix,
      )}
    </p>
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
  onTyping,
}: {
  conversationId: string;
  noteOnly?: boolean;
  /**
   * #302: called on each keystroke so teammates on this thread can see that
   * somebody is replying. Throttled by the caller — the keystroke rate is not
   * the broadcast rate. Optional so every other mount site is unchanged.
   */
  onTyping?: () => void;
}) {
  const send = useSendMessage(conversationId);
  const createNote = useCreateNote(conversationId);
  // Who the author PICKED. Ids never come from parsing the draft: two
  // teammates can share a display name, and the text cannot say which was
  // meant. Deleting the name from the draft still withdraws the mention.
  const [mentionOpen, setMentionOpen] = useState(false);
  const [picked, setPicked] = useState<PickedMention[]>(() =>
    loadDraftMentions(conversationId),
  );
  const uploadNoteFiles = useUploadNoteFiles();
  /**
   * The last send that FAILED, with the Idempotency-Key it used. Pressing send
   * again on the same text reuses that key, so a response that was merely lost
   * (rather than a send that never happened) can never reach the customer twice.
   */
  const lastFailedSendRef = useRef<FailedAttempt | null>(null);
  const [mode, setMode] = useState<"sms" | "note">(noteOnly ? "note" : "sms");
  const isNote = noteOnly || mode === "note";
  // Restored from the last visit to THIS conversation. Both phone apps have
  // always kept a per-conversation draft; on web a half-typed reply died the
  // moment you opened another thread to check something.
  const [text, setText] = useState(() => loadDraft(conversationId));
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  // #189 inline rejection copy from the LAST admission attempt (type/size/
  // count) — rendered above the pill, replaced or cleared on the next intake.
  const [mediaErrors, setMediaErrors] = useState<string[]>([]);
  const noteStage = useStagedFiles();
  const [pickerOpen, setPickerOpen] = useState(false);
  // AI-drafted replies for THIS thread. Kept per conversation until it moves:
  // asking costs a real AI call, so closing the strip and opening it again, or
  // leaving and coming back, must not spend again. A message in either
  // direction retires them (see draft-suggestions-cache).
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Reported with the drafts: Lou was never told what this business does, so
  // every draft is thinner than it could be. Held for the life of the composer
  // rather than re-fetched, since it only changes when someone writes the line.
  const [businessUnknown, setBusinessUnknown] = useState(false);
  const suggestReplies = useReplySuggestions(conversationId);
  // Read-only, for the merge-field preview: both are already in cache from the
  // thread header and the shell, so this costs no extra request.
  const conversation = useConversation(conversationId);
  const company = useCompany();
  // #408: read from the SAME cached thread query the timeline uses, so this
  // costs no extra request. What is needed is only the newest outbound and who
  // sent it.
  const messages = useMessages(conversationId);
  const members = useMembers();
  const me = useMe();
  /**
   * #408: when this draft began — the moment the composer first held text.
   *
   * Held in state rather than persisted, deliberately. A draft restored after
   * a reload has no start moment we can honestly claim, and the predicate
   * treats null as "do not warn": a confirmation we cannot justify is worse
   * than none, because the first false one teaches people to dismiss the true
   * ones.
   */
  const [draftStartedAt, setDraftStartedAt] = useState<string | null>(null);
  useEffect(() => {
    setDraftStartedAt((current) => {
      if (text.trim() === "") return null;
      return current ?? new Date().toISOString();
    });
  }, [text]);
  // Reset when the thread changes: a draft in another conversation says
  // nothing about this one.
  useEffect(() => {
    setDraftStartedAt(null);
  }, [conversationId]);
  const textareaRef = useAutoGrow(text);
  const fileRef = useRef<HTMLInputElement>(null);
  const noteFileRef = useRef<HTMLInputElement>(null);

  // Persist the draft as it is typed, one write per idle moment rather than
  // one per keystroke. Sending clears `text`, which removes the entry; a failed
  // send restores it, which writes it back.
  useEffect(() => {
    const timer = setTimeout(() => saveDraft(conversationId, text), 400);
    return () => clearTimeout(timer);
  }, [conversationId, text]);

  // The picks ride with the draft. Restoring text alone brought back a note
  // that still SAID "@Sam" and notified nobody, which is worse than losing the
  // draft: the words on screen were evidence of something that would not
  // happen.
  useEffect(() => {
    const timer = setTimeout(() => saveDraftMentions(conversationId, picked), 400);
    return () => clearTimeout(timer);
  }, [conversationId, picked]);

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

  /**
   * Ask for drafts. Sends whatever is typed so far, so the server can finish
   * the sentence rather than talk past it. An empty result is stated plainly:
   * silence after a tap reads as broken.
   */
  const lastActivityAt = conversation.data?.last_message_at ?? null;
  const askForSuggestions = useCallback(() => {
    if (suggestReplies.isPending) return;
    // Already drafted for this conversation, and nothing has happened since:
    // show what Lou wrote rather than paying for the same answer twice.
    const cached = readCachedSuggestions(conversationId, lastActivityAt);
    if (cached) {
      setSuggestions(cached);
      // #431: shown but not yet used. A send from here counts as discarded.
      suggestionsWereShown.current = true;
      return;
    }
    setSuggestions([]);
    suggestReplies.mutate(text, {
      onSuccess: (result) => {
        setBusinessUnknown(result.business_unknown === true);
        if (result.suggestions.length > 0) {
          setSuggestions(result.suggestions);
          cacheSuggestions(conversationId, lastActivityAt, result.suggestions);
          suggestionsWereShown.current = true;
          return;
        }
        toast(suggestionFailureMessage(result.reason));
      },
      onError: () => toast.error("Couldn't draft a reply. Try again."),
    });
  }, [conversationId, lastActivityAt, suggestReplies, text]);

  /**
   * #431: which of Lou's drafts (if any) was taken into the composer, kept in a ref
   * so comparing it at send time costs no render. Null once reported, so one draft
   * yields exactly one outcome.
   */
  // #431: needed to report what a human did with Lou's draft.
  const companyId = useCompanyId();
  const pickedSuggestion = useRef<string | null>(null);
  /** #431: suggestions were shown and none was taken — a send now means discarded. */
  const suggestionsWereShown = useRef(false);

  /** Take a draft into the composer to read, edit, and send. Never auto-sent. */
  const useSuggestion = (suggestion: string) => {
    setText(suggestion);
    setSuggestions([]);
    pickedSuggestion.current = suggestion;
    suggestionsWereShown.current = false;
    textareaRef.current?.focus();
  };

  /**
   * #431: report the outcome of a draft, once, at the moment of sending.
   *
   * Three outcomes kept distinct rather than collapsed into a rate: "used" is sent
   * unchanged, "edited" is sent after changes, "discarded" is a draft that was shown
   * and not used. An edit can mean the draft was 80% right and saved time or 20%
   * right and cost time, and a discard can mean the draft was wrong OR that the
   * crew member wanted to say something more personal — which is the product
   * working as intended. Only separate counters keep that readable.
   */
  const reportSuggestionOutcome = (sentText: string) => {
    const outcome = draftOutcome({
      shown: pickedSuggestion.current !== null || suggestionsWereShown.current,
      picked: pickedSuggestion.current,
      sent: sentText,
    });
    // Cleared either way, so one draft can only ever yield one outcome.
    pickedSuggestion.current = null;
    suggestionsWereShown.current = false;
    if (outcome) reportAiOutcome(companyId, "suggest_reply", outcome);
  };
  const insertTemplate = (body: string) => {
    setText((current) =>
      current === ""
        ? body
        : `${current}${current.endsWith(" ") ? "" : " "}${body}`,
    );
    textareaRef.current?.focus();
  };

  /**
   * #408: has a teammate answered this customer since the draft was begun?
   *
   * Derived from the cached thread rather than a new subscription. The
   * realtime channel already delivers a teammate's reply while you are looking
   * at the thread — what was missing is that it arrived AFTER the send rather
   * than before it, so this is a check at the send boundary, not a subsystem.
   */
  const newestOutbound = useMemo(() => {
    for (const page of messages.data?.pages ?? []) {
      for (const message of page.data) {
        // Newest-first (SPEC §7). A note is internal and reaches no customer,
        // so it is not a collision — the whole harm here is the CUSTOMER
        // receiving two answers.
        if (message.direction === "outbound") return message;
      }
    }
    return null;
  }, [messages.data]);

  const collision = duplicateReplyWarning({
    draftStartedAt,
    lastOutboundAt: newestOutbound?.created_at ?? null,
    lastOutboundByUserId: newestOutbound?.sent_by_user_id ?? null,
    meUserId: me.data?.user_id ?? "",
  });

  const [confirmCollision, setConfirmCollision] = useState(false);

  const doSend = useCallback(async () => {
    if (!canSend) return;
    const draftText = text;
    const draftAttachments = attachments;

    if (isNote) {
      // Clear immediately (fast by feel, G1); restore text + staged files on
      // failure. D28 staged-note-upload chain: the note is created first, then
      // each staged file POSTs with the returned note id.
      const draftFiles = noteStage.files;
      const draftPicked = picked;
      setText("");
      noteStage.clear();
      setPicked([]);
      clearDraftMentions(conversationId);

      let note: Awaited<ReturnType<typeof createNote.mutateAsync>>;
      try {
        // mutateAsync resolves from the MutationCache even if the composer
        // unmounts before the response, so the upload chain below still runs
        // and staged files aren't silently dropped (D28 / finding #6).
        note = await createNote.mutateAsync({
          body: draftText,
          mentionUserIds: resolveMentions(draftText, draftPicked),
        });
      } catch (error) {
        setText(draftText);
        noteStage.restore(draftFiles);
        setPicked(draftPicked);
        toast.error(
          error instanceof ApiError
            ? mentionAwareMessage(error.message)
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
    // Reuse the Idempotency-Key when this is a RETRY of the same text and
    // attachments. A failed send restores the draft, so the natural next action
    // is to press send again — and with a fresh key each time, a send whose
    // response was merely LOST (flaky signal, tab closed mid-request) reached
    // the customer twice and billed twice. Same rule as the Android composer:
    // same content -> same key, any edit -> new key.
    const signature = `${draftText} ${attachmentSignature(draftAttachments)}`;
    const idempotencyKey = idempotencyKeyFor(
      lastFailedSendRef.current,
      signature,
    );

    send.mutate(
      { body: draftText, media, idempotencyKey },
      {
        onSuccess: () => {
          lastFailedSendRef.current = null;
          // #431: on success only. A draft that failed to send tells us nothing
          // about whether the crew found it useful, and counting it either way
          // would put network trouble into a quality measurement.
          reportSuggestionOutcome(draftText);
          for (const a of draftAttachments) {
            if (a.previewUrl !== null) URL.revokeObjectURL(a.previewUrl);
          }
          textareaRef.current?.focus();
        },
        onError: (error) => {
          lastFailedSendRef.current = { signature, key: idempotencyKey };
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
      void requestSend();
      return;
    }
    // "/" in an empty draft opens the saved-replies picker inline (§3.1) —
    // texts only; notes have no templates.
    if (event.key === "/" && text === "" && !isNote) {
      event.preventDefault();
      setPickerOpen(true);
    }
  };

  const onMentionPick = (member: { user_id: string; display_name: string }) => {
    const name = member.display_name.trim() || "Teammate";
    const field = textareaRef.current;
    const caret = field?.selectionStart ?? text.length;
    const next = insertMention(text, caret, name);
    setText(next.text);
    setPicked((prior) => {
      // The server caps a note at ten names. Saying so here beats letting the
      // note bounce with a validation string naming an internal field.
      if (prior.length >= MAX_MENTIONS_PER_NOTE) {
        toast.error(
          `A note can name up to ${MAX_MENTIONS_PER_NOTE} teammates. Assign the thread if the whole crew needs it.`,
        );
        return prior;
      }
      return [...prior, { userId: member.user_id, name }];
    });
    // Put the caret back where the author was typing, not at the end.
    window.requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(next.caret, next.caret);
    });
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

  /**
   * #408: the send boundary. A teammate answering this customer while the
   * draft was being written is the one thing worth a pause here.
   *
   * A WARNING, NOT A BLOCK. A duplicate reply is genuinely better than no
   * reply, and anything that discourages a tech from answering works against
   * the five-minute window that decides the job. Notes skip it entirely —
   * they reach no customer, so there is no collision to have.
   * *Applying: Ethical Friction — a confirmation at the moment the mistake
   * becomes irreversible, and nowhere else.*
   */
  const requestSend = useCallback(() => {
    if (!isNote && collision.warn) {
      setConfirmCollision(true);
      return;
    }
    void doSend();
  }, [isNote, collision.warn, doSend]);

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
                    : "bg-app-tint text-app-olive-deep"
                  : "text-app-muted hover:text-app-ink",
              )}
            >
              {m === "sms" ? "Text" : "Note"}
            </button>
          ))}
        </div>
      )}
      {!isNote && (suggestions.length > 0 || suggestReplies.isPending) && (
        <ReplySuggestionChips
          suggestions={suggestions}
          loading={suggestReplies.isPending}
          businessUnknown={businessUnknown}
          onUse={useSuggestion}
          onDismiss={() => {
            setSuggestions([]);
            // An explicit dismissal is the clearest possible discard signal, and
            // clearing the flag keeps a later send from reporting it twice.
            suggestionsWereShown.current = false;
            reportAiOutcome(companyId, "suggest_reply", "discarded");
          }}
        />
      )}
      {!isNote && <MediaErrors errors={mediaErrors} />}
      {!isNote && (
        <div className="mx-auto max-w-[42rem] px-1 pb-1">
          <MergeFieldPreview
            text={text}
            contactName={conversation.data?.contact?.name}
            businessName={company.data?.name}
          />
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
          "focus-within:border-app-olive focus-within:ring-[3px] focus-within:ring-app-tint",
          isNote
            ? "border-app-amber-line bg-app-amber-bg"
            : "border-app-line bg-app-paper",
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      text.trim() === "" ? "Draft with Lou" : "Finish with Lou"
                    }
                    onClick={askForSuggestions}
                    disabled={suggestReplies.isPending}
                    className="rounded-full text-muted-foreground"
                  >
                    <AiOrb
                      state={suggestReplies.isPending ? "thinking" : "idle"}
                      size={18}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {text.trim() === "" ? "Draft with Lou" : "Finish with Lou"}
                </TooltipContent>
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
                  <DropdownMenuItem
                    onSelect={askForSuggestions}
                    disabled={suggestReplies.isPending}
                  >
                    <AiOrb
                      state={suggestReplies.isPending ? "thinking" : "idle"}
                      size={16}
                    />
                    {text.trim() === "" ? "Draft with Lou" : "Finish with Lou"}
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
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            // #302: "Sam is replying…" is the single line that stops a second
            // person mid-sentence, and it costs the person typing nothing to
            // produce. Only for a real reply — a note goes to the crew, and
            // nobody is racing to answer the customer with it.
            if (!isNote && next.length > 0) onTyping?.();
            // The picker opens from the typed text, not from a keydown: an
            // Android soft keyboard reports every key as "Unidentified", so a
            // keydown trigger never fired there at all. The "@" is left in the
            // draft either way, so dismissing the picker costs nothing.
            if (isNote && isMentionTrigger(next, event.target.selectionStart ?? next.length)) {
              setMentionOpen(true);
            }
            // Drafts were written for what was typed a moment ago; once that
            // changes they are stale, so they go rather than sit there
            // offering to overwrite newer words.
            if (suggestions.length > 0) setSuggestions([]);
          }}
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
          {!isNote && (
            <SegmentMeterLabel
              text={text}
              hasMedia={attachments.length > 0}
              contactName={conversation.data?.contact?.name}
              businessName={company.data?.name}
            />
          )}
          {/* The single petrol control in this region (mockup .btn-primary.send)
              — a petrol pill with the send glyph and a soft petrol shadow. Active
              only when the field is non-empty. Notes reuse the amber accent. */}
          <button
            type="button"
            onClick={() => void requestSend()}
            disabled={!canSend}
            aria-label={isNote ? "Save note" : "Send message"}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-app-ctrl px-3 text-[13px] font-semibold text-white transition-[background,transform] duration-150 ease-out active:translate-y-px disabled:opacity-45",
              isNote
                ? "bg-app-amber hover:brightness-105"
                : "bg-primary hover:bg-app-olive-deep",
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

      {/* Naming a teammate on a note, opened by typing "@". Notes only: a
          mention is internal, and a text goes to the customer. */}
      {isNote && (
        <MentionPicker
          conversationId={conversationId}
          open={mentionOpen}
          onOpenChange={setMentionOpen}
          onPick={onMentionPick}
        >
          <span
            aria-hidden
            className="pointer-events-none mx-auto block h-0 max-w-[42rem]"
          />
        </MentionPicker>
      )}
      {/* #408: two techs answering the same customer thirty seconds apart is
          the exact confusion a shared inbox exists to eliminate, and the
          product creates the race on purpose — an unassigned inbound notifies
          everyone, which is right for "never miss a lead". So the fix is a
          pause at the moment the mistake becomes irreversible, not a lock.
          *Applying: Ethical Friction.* */}
      <Dialog open={confirmCollision} onOpenChange={setConfirmCollision}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Somebody already answered</DialogTitle>
            <DialogDescription>
              {duplicateReplyPrompt(
                collision.byUserId
                  ? members.data?.data.find(
                      (m) => m.user_id === collision.byUserId,
                    )?.display_name ?? "A teammate"
                  : null,
                newestOutbound
                  ? Math.max(
                      0,
                      Math.round(
                        (Date.now() - Date.parse(newestOutbound.created_at)) / 1000,
                      ),
                    )
                  : 0,
              )}{" "}
              Send yours as well?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmCollision(false)}>
              Let me look
            </Button>
            <Button
              onClick={() => {
                setConfirmCollision(false);
                void doSend();
              }}
            >
              Send anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
