"use client";

import {
  Calendar,
  Contact,
  Download,
  File as FileIcon,
  FileMusic,
  FileText,
  FileVideoCamera,
  type LucideIcon,
} from "lucide-react";

import { mmsMediaKind, type MmsMediaKind } from "@loonext/shared";
import { useT, type MessageKey } from "@/i18n/provider";
import { useAttachmentUrl } from "@/lib/api/attachments";
import type { AttachmentSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { formatBytes } from "./gallery-grouping";

/**
 * Icon + human label per coarse media kind (#189 file chips).
 *
 * #228: the label is a catalogue KEY rather than a sentence, because this table
 * is module-level and a hook cannot be called here. The component resolves it,
 * which is also what keeps the two languages in one place.
 */
const KIND_VIEW: Record<MmsMediaKind, { icon: LucideIcon; label: MessageKey }> = {
  image: { icon: FileIcon, label: "thread.mediaImage" }, // images render elsewhere
  audio: { icon: FileMusic, label: "thread.mediaAudio" },
  video: { icon: FileVideoCamera, label: "thread.mediaVideo" },
  contact: { icon: Contact, label: "thread.mediaContactCard" },
  calendar: { icon: Calendar, label: "thread.mediaCalendarInvite" },
  document: { icon: FileText, label: "thread.mediaPdf" },
  text: { icon: FileText, label: "thread.mediaTextFile" },
  file: { icon: FileIcon, label: "thread.mediaFile" },
};

/**
 * Non-image MMS attachment in a thread bubble (#189): a calm file chip —
 * kind icon, kind label (MMS media carries no filename), size — that becomes
 * a signed-URL link (opens in a new tab / saves) once the mint resolves.
 * Mirrors the note-attachment FileAttachmentRow, trimmed to the
 * `AttachmentSummary` columns a message row actually has.
 */
export function AttachmentFileChip({
  attachment,
}: {
  attachment: AttachmentSummary;
}) {
  // #240: a file row is a download — it hands over the FILE. Nothing here ever
  // has a preview (they are PDFs and documents), but asking for the original
  // explicitly is what keeps a download from ever saving a thumbnail.
  const t = useT();
  const url = useAttachmentUrl(attachment.id, true, "original");
  const kind = mmsMediaKind(attachment.content_type);
  const { icon: Icon, label: labelKey } = KIND_VIEW[kind];
  const label = t(labelKey);
  const size = formatBytes(attachment.size_bytes);

  if (url.isError) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2 text-muted-foreground">
        <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="text-sm">{label}</span>
        <button
          type="button"
          onClick={() => url.refetch()}
          className="text-xs underline-offset-2 hover:underline"
        >
          {t("thread.didntLoadRetry")}
        </button>
      </div>
    );
  }

  const href = url.data?.url;
  const inner = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground">{label}</span>
        {size && (
          <span className="block text-[11px] tabular-nums text-muted-foreground">
            {size}
          </span>
        )}
      </span>
      <Download
        className={cn(
          "size-4 shrink-0 text-muted-foreground",
          !href && "opacity-40",
        )}
        strokeWidth={1.75}
        aria-hidden
      />
    </>
  );

  const className =
    "flex max-w-64 items-center gap-2.5 rounded-lg border border-border bg-app-paper px-3 py-2 transition-colors duration-150 ease-out";

  if (!href) {
    return (
      <div className={cn(className, "opacity-70")} aria-busy>
        {inner}
      </div>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("thread.openAttachmentAria", {
        kind: label.toLowerCase(),
      })}
      className={cn(className, "hover:bg-app-hover")}
    >
      {inner}
    </a>
  );
}
