"use client";

import {
  ChevronDown,
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
  formatNanpNumber,
  hasMergeFields,
  hasServerOnlyTokens,
  SERVER_ONLY_TOKENS_NOTE,
  type MmsMediaType,
} from "@loonext/shared";

import {
  QuietHoursConfirm,
  SendLaterDialog,
  SendLaterMenuItems,
} from "@/components/thread/send-later-menu";
import { AskForPayment } from "@/components/thread/ask-for-payment";
import { OnMyWay } from "@/components/thread/on-my-way";
import { PaymentStrip } from "@/components/thread/payment-strip";
import { QuoteStrip } from "@/components/thread/quote-strip";
import { useScheduleMessage } from "@/lib/api/scheduled-messages";
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
import { sayWith, useT, type Translate } from "@/i18n/provider";
import { useUploadNoteFiles } from "@/lib/api/attachments";
import { useCompany } from "@/lib/api/companies";
import {
  clearDraftMentions,
  clearFailedSend,
  loadDraft,
  loadDraftMentions,
  loadFailedSend,
  flushDraftOnExit,
  saveDraft,
  saveDraftMentions,
  saveFailedSend,
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
import {
  useWrapUpTranscript,
  wrapUpFailureMessage,
  wrapUpOutcome,
  WRAP_UP_MAX_BYTES,
  WRAP_UP_MAX_SECONDS,
} from "@/lib/api/wrap-up-transcript";
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
  type WorkPhase,
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
  type SayMmsRejection,
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
import { useWrapUpRecorder } from "./use-wrap-up-recorder";
import { WrapUpButton, WrapUpStrip } from "./wrap-up-dictation";
import { WorkPhasePicker } from "@/components/thread/work-phase-picker";
import { PhotoMarkupDialog } from "@/components/attachments/photo-markup-dialog";

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
export function mentionAwareMessage(message: string, t: Translate): string {
  if (!message.startsWith("mention_user_ids")) return message;
  return message.includes("access to this conversation")
    ? t("thread.mentionNoAccess")
    : t("thread.mentionCap", { count: MAX_MENTIONS_PER_NOTE });
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
  const t = useT();
  if (attachments.length === 0) return null;
  return (
    <div className="mx-auto flex max-w-[42rem] flex-wrap items-center gap-2 px-1 pb-2">
      {attachments.map((attachment) => {
        const name = attachment.file.name || t("thread.fileFallbackName");
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
                aria-label={t("thread.removeAria", { name })}
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
              aria-label={t("thread.removeAria", { name })}
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
  say: SayMmsRejection,
): AdmitFilesResult {
  const { accepted, rejected } = partitionMmsFiles(
    Array.from(incoming),
    current.length,
    say,
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
 * #299 — "this didn't send", said durably rather than in a toast.
 *
 * WHAT IT FIXES. A failed send restores the draft to the box and raises a toast.
 * The toast is gone in seconds; the draft is not, and since #299 it survives a
 * reload as well. So what the user comes back to is text in a composer that
 * reads exactly like a reply they started and never finished. Nothing on screen
 * distinguishes that from a message they pressed send on and believe went out —
 * which is the ambiguity the issue names, and the more expensive way to be
 * wrong, because "I already told them" is a decision people make out loud.
 *
 * WHY IT NAMES THE SAFETY. The second sentence is the actionable half: the
 * reason not to hesitate over pressing send again is that the retry carries the
 * SAME Idempotency-Key, so a first attempt that actually reached the server is
 * collapsed rather than delivered twice. That is true because the key is stored
 * next to the draft, and it would be a false promise without it.
 *
 * TONE. A statement, not an alarm: the same choice the connection banner makes
 * for the same reason. Nothing has been destroyed, the words are still here, and
 * an amber strip over a failed send teaches people to discount the strip that
 * will one day be about something they cannot undo. `role="status"` and
 * `aria-live="polite"` because a screen-reader user mid-sentence should not be
 * interrupted by a condition whose remedy is one button they already know about.
 *
 * *Applying: G10 (system states must be precise) and the Safety principle.*
 */
export function UnsentNotice({ show }: { show: boolean }) {
  const t = useT();
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[42rem] px-1 pb-2"
    >
      <p className="text-xs text-app-amber-ink">{t("thread.unsentNotice")}</p>
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
  const t = useT();
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
    t,
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
        {segmentTooltip(meter.segments, t)}
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
  contactAddress,
  senderName,
  ourNumber,
  identificationSuffix,
}: {
  text: string;
  contactName?: string | null;
  businessName?: string | null;
  /** #274: the contact's service address, for {address}. */
  contactAddress?: string | null;
  /** #274: the signed-in member, for {my_name}. */
  senderName?: string | null;
  /** #274: this conversation's number in E.164, for {our_number}. */
  ourNumber?: string | null;
  /** #393: the signature this send will carry, when it applies. */
  identificationSuffix?: string | null;
}) {
  const t = useT();
  // #228: the shared note names a catalogue key, so the composer says it in
  // the reader's language.
  const say = sayWith(t);
  // #393: a plain draft about to be SIGNED needs the preview too — otherwise
  // the one case where the sent text differs from the typed text without any
  // {token} to hint at it is the case with no preview at all.
  const signed = identificationSuffix ? identificationSuffix.length > 0 : false;
  if (!hasMergeFields(text) && !signed) return null;
  if (text.trim().length === 0) return null;
  return (
    <div className="text-xs text-muted-foreground">
      <p className="truncate">
        {t("thread.sendsAs")}{" "}
        {appendIdentificationSuffix(
          applyMergeFields(text, {
            contactName,
            businessName,
            contactAddress,
            senderName,
            ourNumber: ourNumber ? formatNanpNumber(ourNumber) : null,
          }),
          identificationSuffix,
        )}
      </p>
      {/* #274: the two tokens this side cannot answer honestly. A cached
          "next visit" would be confidently wrong the moment a teammate
          reschedules it, and a preview that is usually right is worse than
          one that says which part it cannot show. */}
      {hasServerOnlyTokens(text) && <p>{say(SERVER_ONLY_TOKENS_NOTE)}</p>}
    </div>
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
  contactLocale,
}: {
  conversationId: string;
  noteOnly?: boolean;
  /** #228 — the customer's language, for the one body this view composes. */
  contactLocale?: string | null;
  /**
   * #302: called on each keystroke so teammates on this thread can see that
   * somebody is replying. Throttled by the caller — the keystroke rate is not
   * the broadcast rate. Optional so every other mount site is unchanged.
   */
  onTyping?: () => void;
}) {
  const t = useT();
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
   *
   * #299: seeded from storage, because the draft it belongs to is. A ref dies
   * with the page while the draft survives it, so a reload used to keep the half
   * that invites a retry and drop the half that makes it safe — in exactly the
   * situation (a blip, then a refresh) the key exists for.
   */
  const lastFailedSendRef = useRef<FailedAttempt | null | undefined>(undefined);
  if (lastFailedSendRef.current === undefined) {
    // Lazy, not `useRef(loadFailedSend(…))`: an argument to useRef is evaluated
    // on EVERY render and thrown away after the first, and this composer
    // re-renders on every keystroke. `undefined` is the not-yet-read state so
    // that a genuine "no failed send" (null) is only read from storage once.
    lastFailedSendRef.current = loadFailedSend(conversationId);
  }
  /**
   * #299: the signature of the send that failed, so the box can SAY so.
   *
   * The ref above carries the key; this carries the fact, because a fact the
   * user needs has to survive a render and a reload. A toast cannot: it is gone
   * in seconds, and the reload that follows a blip is the moment the
   * explanation is most needed and least present. What was left behind was text
   * sitting in the composer that reads exactly like a draft somebody never
   * finished — the ambiguity #299 names.
   *
   * The SIGNATURE rather than a boolean, so the notice can only appear while
   * what is in the box is still the thing that failed. Edit the words and it
   * goes: that is a different message now, it has never been sent, and saying
   * "this didn't send" about it would be a lie in the other direction.
   */
  const [failedSignature, setFailedSignature] = useState<string | null>(
    () => loadFailedSend(conversationId)?.signature ?? null,
  );
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
  /**
   * #294: whether these photos are the before or the after.
   *
   * Null by default and stays null unless somebody says otherwise. Defaulting to
   * "before" would mislabel most notes, and a job record that is confidently wrong
   * is worse than one that says nothing.
   */
  const [workPhase, setWorkPhase] = useState<WorkPhase | null>(null);
  /** #294: which staged photo is open in the markup editor, if any. */
  const [markingUp, setMarkingUp] = useState<string | null>(null);
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
    // #507: likewise a dictation. Carrying the snapshot across would report an
    // outcome for THIS thread's note about words spoken into another one.
    wrapUpInsert.current = null;
    setWrapUpError(null);
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

  // #299/#269: the debounce above cancels a pending write on cleanup, so a
  // reload or thread switch inside the window discarded what was typed. The
  // flush lives with the persistence module; the reasoning is there.
  const draftRef = useRef({ conversationId, text, picked });
  draftRef.current = { conversationId, text, picked };
  useEffect(
    () =>
      flushDraftOnExit(() => ({
        conversationId: draftRef.current.conversationId,
        text: draftRef.current.text,
        mentions: draftRef.current.picked,
      })),
    [],
  );

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
      onError: () => toast.error(t("thread.draftReplyFailed")),
    });
  }, [conversationId, lastActivityAt, suggestReplies, text, t]);

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
  /**
   * #475: which saved reply is in the box, and what it said when it arrived.
   *
   * The text is compared at SEND time rather than tracked on every keystroke:
   * "did this end up different from the template" is the question #274 asks,
   * and a keystroke listener would answer a noisier one (somebody who types a
   * word and deletes it did not edit anything).
   *
   * Cleared when the box is emptied, because a template inserted, deleted, and
   * replaced by typing did not produce the message that goes out.
   */
  const templateUse = useRef<{ id: string; body: string } | null>(null);

  const insertTemplate = (body: string, templateId: string) => {
    setText((current) => {
      const next =
        current === ""
          ? body
          : `${current}${current.endsWith(" ") ? "" : " "}${body}`;
      // Record what the box holds AFTER the insert, so an append onto existing
      // words is not later mistaken for an edit of the template.
      templateUse.current = { id: templateId, body: next };
      return next;
    });
    textareaRef.current?.focus();
  };

  /**
   * #507 Phase 1 — the wrap-up a crew member speaks after hanging up.
   *
   * They press the mic, say "quoted him $2,400 for the tank, parts Thursday,
   * he's confirming with his wife", and those words land HERE, in the note box,
   * for them to check and post. It is their own voice about a call that has
   * ended — never the call, never the customer (D117).
   *
   * The transcript is a suggestion like every other AI output in this product:
   * it goes into the existing note composer and out through the existing note
   * route, so mentions, permissions, search and push all keep working and there
   * is no second way to write a note.
   *
   * NOT GATED ON THE COMPANY TOGGLE HERE, deliberately. Reading
   * /company/ai-settings would put a request on every thread open (queries go
   * stale in 30s) to pre-hide a control that is on by default. The server
   * answers `disabled` and the strip says so in a sentence — the same shape
   * reply drafting already uses.
   */
  const wrapUp = useWrapUpTranscript(conversationId);
  const [wrapUpError, setWrapUpError] = useState<string | null>(null);
  /**
   * What the box held either side of the dictation, so #431 can tell "posted as
   * written" from "corrected first" from "thrown away". Two snapshots rather
   * than the transcript text, because a wrap-up is appended to whatever was
   * already typed — see wrapUpOutcome.
   */
  const wrapUpInsert = useRef<{ before: string; after: string } | null>(null);

  const recorder = useWrapUpRecorder({
    maxSeconds: WRAP_UP_MAX_SECONDS,
    maxBytes: WRAP_UP_MAX_BYTES,
    onAudio: (audio, seconds) => {
      setWrapUpError(null);
      wrapUp.mutate(
        { audio, seconds },
        {
          onSuccess: (result) => {
            // Every failure below leaves them exactly where they were: this
            // composer, with a keyboard and whatever they had already typed.
            if (result.text === null) {
              setWrapUpError(wrapUpFailureMessage(result.reason));
              textareaRef.current?.focus();
              return;
            }
            const transcript = result.text;
            // Somebody can flip to Text while the words are coming back, and
            // the draft box is shared between the two modes — so land them back
            // where the dictation belongs rather than dropping a private
            // wrap-up into a message addressed to the customer.
            setMode("note");
            setText((current) => {
              // Appended on a new line rather than joined with a space: a
              // wrap-up is two or three sentences, and running them onto the
              // end of a half-typed line produces something nobody meant.
              const next =
                current.trim() === ""
                  ? transcript
                  : `${current.replace(/[ \t]+$/, "")}\n${transcript}`;
              // Written from inside the updater so the snapshot is of what the
              // box ACTUALLY held: transcription takes seconds, and people keep
              // typing while it runs.
              wrapUpInsert.current = { before: current, after: next };
              return next;
            });
            textareaRef.current?.focus();
          },
          onError: (error) => {
            setWrapUpError(
              error instanceof ApiError
                ? error.message
                : t("thread.wrapUpSendFailed"),
            );
            textareaRef.current?.focus();
          },
        },
      );
    },
  });

  const { recording: isRecording, cancel: cancelRecording } = recorder;
  // The mic belongs to note mode. Flipping to a customer reply while it is open
  // would leave a recording running with nothing on screen saying so, and an
  // invisible open microphone is the exact impression this feature can never
  // give. Cancelling costs nothing: no upload, no spend.
  useEffect(() => {
    if (!isNote && isRecording) cancelRecording();
  }, [isNote, isRecording, cancelRecording]);

  const startDictation = () => {
    setWrapUpError(null);
    void recorder.start();
  };

  const cancelDictation = () => {
    recorder.cancel();
    recorder.clearError();
    setWrapUpError(null);
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
  // #233 send later. Two dialogs, both owned HERE rather than inside the
  // dropdown: a Radix Dialog mounted in DropdownMenuContent unmounts the
  // instant the menu closes, which would make "Pick a time…" a control that
  // silently does nothing (the trap snooze-menu.tsx documents).
  const [pickTimeOpen, setPickTimeOpen] = useState(false);
  const [quietConfirmFor, setQuietConfirmFor] = useState<string | null>(null);
  const schedule = useScheduleMessage();

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
      const draftPhase = workPhase;
      setText("");
      noteStage.clear();
      setPicked([]);
      setWorkPhase(null);
      clearDraftMentions(conversationId);

      let note: Awaited<ReturnType<typeof createNote.mutateAsync>>;
      try {
        // mutateAsync resolves from the MutationCache even if the composer
        // unmounts before the response, so the upload chain below still runs
        // and staged files aren't silently dropped (D28 / finding #6).
        note = await createNote.mutateAsync({
          body: draftText,
          mentionUserIds: resolveMentions(draftText, draftPicked),
          workPhase: draftPhase,
        });
      } catch (error) {
        setText(draftText);
        noteStage.restore(draftFiles);
        setPicked(draftPicked);
        setWorkPhase(draftPhase);
        toast.error(
          error instanceof ApiError
            ? mentionAwareMessage(error.message, t)
            : t("thread.noteSaveFailed"),
        );
        return;
      }

      // #431: only on success, and only once — same rule as the reply drafts
      // above. A note that failed to save says nothing about whether the words
      // Lou wrote down were any good, and counting it either way would put
      // network trouble into a quality measurement.
      const dictated = wrapUpOutcome(wrapUpInsert.current, draftText);
      wrapUpInsert.current = null;
      if (dictated) reportAiOutcome(companyId, "call_wrapup", dictated);

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
          ? t("thread.noteFilesAllFailed")
          : t("thread.noteFilesSomeFailed", {
              failed: failed.length,
              total: draftFiles.length,
            }),
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
      toast.error(t("thread.fileReadFailed"));
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
      lastFailedSendRef.current ?? null,
      signature,
    );

    // #475/#274: what the send is, and whether the crew changed it. Compared
    // once, here, rather than watched on every keystroke — the question is
    // "did this go out different from the template", and somebody who typed a
    // word and deleted it did not edit anything.
    const used = templateUse.current;
    const templateId = used !== null ? used.id : undefined;
    const templateEdited = used !== null && used.body.trim() !== draftText.trim();

    send.mutate(
      { body: draftText, media, idempotencyKey, templateId, templateEdited },
      {
        onSuccess: () => {
          lastFailedSendRef.current = null;
          // The message is gone from the box and on its way, so the marker has
          // nothing left to protect. Left behind, it would be read by the next
          // failed send on this thread before that send wrote its own.
          clearFailedSend(conversationId);
          setFailedSignature(null);
          // The box is empty again, so whatever was inserted is spent. A
          // template left attached would tag the NEXT message too.
          templateUse.current = null;
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
          // #299: with the draft, not just in memory. The reload that follows a
          // blip must not turn a safe retry into a second charge.
          saveFailedSend(conversationId, { signature, key: idempotencyKey });
          setFailedSignature(signature);
          setText(draftText);
          setAttachments(draftAttachments);
          toast.error(
            error instanceof ApiError
              ? error.message
              : t("thread.sendFailedConnection"),
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
    t,
    // #507: the wrap-up outcome is reported against this company.
    companyId,
    // #294: NOT optional. Choosing a phase is often the LAST thing somebody does
    // before sending, and nothing else in this list changes when they do — so a
    // callback that did not depend on it would send the label they had before,
    // which is usually none.
    workPhase,
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
    const name = member.display_name.trim() || t("thread.teammate");
    const field = textareaRef.current;
    const caret = field?.selectionStart ?? text.length;
    const next = insertMention(text, caret, name);
    setText(next.text);
    setPicked((prior) => {
      // The server caps a note at ten names. Saying so here beats letting the
      // note bounce with a validation string naming an internal field.
      if (prior.length >= MAX_MENTIONS_PER_NOTE) {
        toast.error(
          t("thread.mentionCap", { count: MAX_MENTIONS_PER_NOTE }),
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
    const { attachments: next, errors } = admitFiles(attachments, files, t);
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

  /**
   * #233 — queue this text for later instead of sending it now.
   *
   * The composer is cleared on success exactly as a send would clear it: the
   * words have left the box and are somewhere the person can see them, and a
   * draft left behind would be sent twice by anybody who assumed otherwise.
   *
   * A 409 is not a failure here. #225 ask 2 is that a human is WARNED and never
   * blocked, so the quiet-hours code opens the confirm and the second attempt
   * carries the flag — the same handshake compose already uses, recognised by
   * CODE rather than by reading the sentence.
   */
  const scheduleFor = useCallback(
    async (sendAtIso: string, quietHoursConfirmed = false) => {
      const body = text.trim();
      if (body === "") return;
      try {
        await schedule.mutateAsync({
          conversationId,
          body,
          sendAt: sendAtIso,
          quietHoursConfirmed,
        });
        setText("");
        setQuietConfirmFor(null);
        toast.success(
          t("thread.scheduledFor", {
            when: new Date(sendAtIso).toLocaleString(undefined, {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            }),
          }),
        );
      } catch (cause) {
        if (
          cause instanceof ApiError &&
          cause.code === "quiet_hours_confirmation_required"
        ) {
          setQuietConfirmFor(sendAtIso);
          return;
        }
        toast.error(
          cause instanceof ApiError
            ? cause.message
            : t("thread.scheduleFailed"),
        );
      }
    },
    [conversationId, schedule, text, t],
  );

  return (
    <div
      className="relative px-3 pb-3 pt-2 md:px-4 md:pb-4"
      {...drop.handlers}
    >
      <DropOverlay active={drop.active} />
      {/* #520: absent unless this thread has a job due today, so it is never a
          control somebody has to work out the meaning of. Above the input
          rather than inside the toolbar: sending an ETA is a whole act, not a
          sixth way to change the draft. Not on a note — a note goes to the
          crew, and "on my way" is for the customer. */}
      {!noteOnly && (
        <OnMyWay conversationId={conversationId} contactLocale={contactLocale} />
      )}
      {/* #224: what this thread is owed, and what it was paid. Above the input
          for the same reason the scheduled strip is — it is state, not history,
          and it changes without anybody here doing anything. Never on a note. */}
      {!noteOnly && <PaymentStrip conversationId={conversationId} />}
      {/* #287: what this thread has been quoted, and the way to quote it.
          Beside the payment strip because they are the same kind of thing —
          state that changes without anybody here doing anything. Never on a
          note: a note goes to the crew, and a quote goes to the customer. */}
      {!noteOnly && <QuoteStrip conversationId={conversationId} />}
      {/* #224: absent entirely unless the workspace can actually take a card,
          so a crew never meets a control they cannot action. */}
      {!noteOnly && <AskForPayment conversationId={conversationId} />}
      {!noteOnly && (
        <div
          className="mx-auto mb-2 flex max-w-[42rem] gap-1"
          role="group"
          aria-label={t("thread.composerModeAria")}
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
              {m === "sms" ? t("thread.modeText") : t("thread.modeNote")}
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
      {!isNote && (
        <UnsentNotice
          // Only while the box still holds the message that failed. Recomputed
          // rather than stored, so an edit retires the notice on the keystroke
          // that makes it untrue.
          show={
            failedSignature !== null &&
            failedSignature === `${text} ${attachmentSignature(attachments)}`
          }
        />
      )}
      {!isNote && <MediaErrors errors={mediaErrors} />}
      {!isNote && (
        <div className="mx-auto max-w-[42rem] px-1 pb-1">
          <MergeFieldPreview
            text={text}
            contactName={conversation.data?.contact?.name}
            businessName={company.data?.name}
            // #274: everything this side can answer honestly. The visit day and
            // time are the server's to resolve — see MergeFieldPreview.
            contactAddress={conversation.data?.contact?.address}
            senderName={me.data?.display_name}
            // The number THIS conversation sends from, matched against the
            // workspace's list — the customer replies to that one, not to
            // whichever number happens to be first.
            ourNumber={
              company.data?.numbers?.find(
                (n) => n.id === conversation.data?.phone_number_id,
              )?.number_e164 ?? null
            }
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
          onMarkUp={setMarkingUp}
          className="mx-auto max-w-[42rem] px-1 pb-2"
        />
      )}
      {/* #294: the marks are burned into the staged bytes and the file is
          replaced, so what uploads is an ordinary note attachment. D28 keeps two
          doors, and this does not add a third. */}
      <PhotoMarkupDialog
        file={noteStage.files.find((staged) => staged.id === markingUp)?.file ?? null}
        onCancel={() => setMarkingUp(null)}
        onDone={(marked) => {
          if (markingUp !== null) noteStage.replace(markingUp, marked);
          setMarkingUp(null);
        }}
      />
      {/* #294: only once there are photos to describe. A before/after choice on a
          text-only note is noise on the most common thing anybody does here. */}
      {isNote && noteStage.files.length > 0 && (
        <WorkPhasePicker value={workPhase} onChange={setWorkPhase} />
      )}
      {/* #507: the same slot Lou's reply drafts use in text mode, so the
          composer swaps what is in one region rather than growing another.
          Renders nothing at rest. */}
      {isNote && (
        <WrapUpStrip
          recording={recorder.recording}
          transcribing={wrapUp.isPending}
          seconds={recorder.seconds}
          maxSeconds={WRAP_UP_MAX_SECONDS}
          // The recorder's own failures (no MediaRecorder, a blocked mic, a
          // dead device) and the server's (off, over cap, nothing usable) read
          // the same way to the person: one sentence, one place.
          error={recorder.error ?? wrapUpError}
          onCancel={cancelDictation}
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
                    aria-label={t("thread.attachFilesAria")}
                    onClick={openFilePicker}
                    disabled={attachDisabled}
                    className="rounded-full text-muted-foreground"
                  >
                    <Paperclip className="size-5" strokeWidth={1.75} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("thread.attachTooltip", { count: MMS_MAX_MEDIA_ITEMS })}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("thread.savedReplyAria")}
                    onClick={() => setPickerOpen(true)}
                    className="rounded-full text-muted-foreground"
                  >
                    <FileText className="size-5" strokeWidth={1.75} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("thread.savedReplyTooltip")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      text.trim() === ""
                        ? t("thread.draftWithLou")
                        : t("thread.finishWithLou")
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
                  {text.trim() === ""
                    ? t("thread.draftWithLou")
                    : t("thread.finishWithLou")}
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
                    aria-label={t("thread.addToMessageAria")}
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
                    {t("thread.attachAFile")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
                    <FileText className="size-4" strokeWidth={1.75} aria-hidden />
                    {t("thread.savedReply")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={askForSuggestions}
                    disabled={suggestReplies.isPending}
                  >
                    <AiOrb
                      state={suggestReplies.isPending ? "thinking" : "idle"}
                      size={16}
                    />
                    {text.trim() === ""
                      ? t("thread.draftWithLou")
                      : t("thread.finishWithLou")}
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
                    aria-label={t("thread.attachNoteFilesAria")}
                    onClick={() => noteFileRef.current?.click()}
                    disabled={noteAttachDisabled}
                    className="rounded-full text-muted-foreground"
                  >
                    <Paperclip className="size-5" strokeWidth={1.75} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("thread.attachNoteTooltip", {
                    count: MAX_ATTACHMENTS_PER_OWNER,
                  })}
                </TooltipContent>
              </Tooltip>
              {/* #507: dictating the wrap-up sits beside attaching a photo of
                  it — the same cluster, the same weight, both "add what just
                  happened to this note". */}
              <WrapUpButton
                recording={recorder.recording}
                transcribing={wrapUp.isPending}
                onStart={startDictation}
                onStop={recorder.stop}
              />
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
          placeholder={
            isNote ? t("thread.notePlaceholder") : t("thread.textPlaceholder")
          }
          aria-label={isNote ? t("thread.noteAria") : t("thread.messageAria")}
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
          {/* #233: a SPLIT pill, not a second button. Send keeps the whole
              control when there is nothing to schedule (a note never goes to a
              customer, so "later" is meaningless there); when there is, the
              chevron takes a sliver of the SAME petrol pill. Two primaries side
              by side would slow the common action down to speed up the rare
              one. *Applying: Zen of Clarity.* */}
          <div
            className={cn(
              "inline-flex h-9 items-stretch overflow-hidden rounded-app-ctrl text-[13px] font-semibold text-white transition-[background,transform] duration-150 ease-out",
              isNote ? "bg-app-amber" : "bg-primary",
              !canSend && "opacity-45",
            )}
          >
            <button
              type="button"
              onClick={() => void requestSend()}
              disabled={!canSend}
              aria-label={
                isNote ? t("thread.saveNoteAria") : t("thread.sendMessageAria")
              }
              aria-keyshortcuts="Control+Enter Meta+Enter"
              className={cn(
                "inline-flex items-center gap-1.5 px-3 active:translate-y-px",
                isNote ? "hover:brightness-105" : "hover:bg-app-olive-deep",
              )}
            >
              <span className="hidden sm:inline">
                {isNote ? t("common.save") : t("thread.send")}
              </span>
              <SendIcon className="size-[15px]" />
            </button>
            {!isNote && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={!canSend}
                    aria-label={t("thread.sendLaterAria")}
                    className="inline-flex items-center border-l border-white/25 px-1.5 hover:bg-app-olive-deep active:translate-y-px"
                  >
                    <ChevronDown className="size-[15px]" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <SendLaterMenuItems
                    clock={conversation.data?.destination_clock ?? null}
                    onSchedule={(sendAt) => void scheduleFor(sendAt)}
                    onPickCustom={() => setPickTimeOpen(true)}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
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
            <DialogTitle>{t("thread.alreadyAnsweredTitle")}</DialogTitle>
            <DialogDescription>
              {duplicateReplyPrompt(
                collision.byUserId
                  ? members.data?.data.find(
                      (m) => m.user_id === collision.byUserId,
                    )?.display_name ?? t("thread.aTeammate")
                  : null,
                newestOutbound
                  ? Math.max(
                      0,
                      Math.round(
                        (Date.now() - Date.parse(newestOutbound.created_at)) / 1000,
                      ),
                    )
                  : 0,
                t,
              )}{" "}
              {t("thread.sendYoursAsWell")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmCollision(false)}>
              {t("thread.letMeLook")}
            </Button>
            <Button
              onClick={() => {
                setConfirmCollision(false);
                void doSend();
              }}
            >
              {t("thread.sendAnyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* #233: both owned here, outside the dropdown. See the state block. */}
      <SendLaterDialog
        open={pickTimeOpen}
        clock={conversation.data?.destination_clock ?? null}
        onOpenChange={setPickTimeOpen}
        onConfirm={(sendAt) => void scheduleFor(sendAt)}
      />
      <QuietHoursConfirm
        open={quietConfirmFor !== null}
        localHour={conversation.data?.destination_clock?.local_hour ?? null}
        onOpenChange={(next) => {
          if (!next) setQuietConfirmFor(null);
        }}
        onConfirm={() => {
          if (quietConfirmFor) void scheduleFor(quietConfirmFor, true);
        }}
      />
    </div>
  );
}
