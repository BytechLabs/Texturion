"use client";

import { Calendar, Contact, Download, ExternalLink, File as FileIcon, FileMusic, FileText, FileVideoCamera, Play } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';

import { mmsMediaKind } from '@loonext/shared';
import type { MmsMediaKind } from '@loonext/shared';
import { useT } from '@/i18n/provider';
import type { MessageKey } from '@/i18n/provider';
import { openWithFreshUrl, useAttachmentUrl } from "@/lib/api/attachments";
import type { AttachmentSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { attachmentDownloadUrl, attachmentFileName } from "@/lib/attachments/download";

import { formatBytes } from "./gallery-grouping";
import { AttachmentViewer } from "./attachment-viewer";

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
  if (mmsMediaKind(attachment.content_type) === "video") {
    return <AttachmentVideoChip attachment={attachment} />;
  }
  return <AttachmentFileLink attachment={attachment} />;
}

function AttachmentFileLink({ attachment }: { attachment: AttachmentSummary }) {
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
          onClick={() => void url.refetch()}
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
    <div className={cn(className, "gap-0 py-1 pr-1")}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => openWithFreshUrl(event, url)}
        aria-label={t("thread.openAttachmentAria", {
          kind: label.toLowerCase(),
        })}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1 pr-2 hover:bg-app-hover"
      >
        {inner}
        <ExternalLink className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </a>
      <Button asChild variant="ghost" size="icon">
        <a
          href={attachmentDownloadUrl(href, attachmentFileName(attachment.content_type))}
          aria-label={t("thread.downloadAttachment")}
        >
          <Download aria-hidden />
        </a>
      </Button>
    </div>
  );
}

function AttachmentVideoChip({ attachment }: { attachment: AttachmentSummary }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = t("thread.mediaVideo");
  const size = formatBytes(attachment.size_bytes);
  return (
    <>
      <button
        type="button"
        className="tap-target flex max-w-64 items-center gap-2.5 rounded-lg border border-border bg-app-paper px-3 py-2 text-left hover:bg-app-hover focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => setOpen(true)}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Play className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
        <span>
          <span className="block text-sm text-foreground">{label}</span>
          {size && <span className="block text-[11px] tabular-nums text-muted-foreground">{size}</span>}
        </span>
      </button>
      {open && (
        <AttachmentViewer
          id={attachment.id}
          kind="video"
          label={label}
          fileName={attachmentFileName(attachment.content_type)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
