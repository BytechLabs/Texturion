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
import { useAttachmentUrl } from "@/lib/api/attachments";
import type { AttachmentSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { formatBytes } from "./gallery-grouping";

/** Icon + human label per coarse media kind (#189 file chips). */
const KIND_VIEW: Record<MmsMediaKind, { icon: LucideIcon; label: string }> = {
  image: { icon: FileIcon, label: "Image" }, // images render elsewhere
  audio: { icon: FileMusic, label: "Audio" },
  video: { icon: FileVideoCamera, label: "Video" },
  contact: { icon: Contact, label: "Contact card" },
  calendar: { icon: Calendar, label: "Calendar invite" },
  document: { icon: FileText, label: "PDF" },
  text: { icon: FileText, label: "Text file" },
  file: { icon: FileIcon, label: "File" },
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
  const url = useAttachmentUrl(attachment.id);
  const kind = mmsMediaKind(attachment.content_type);
  const { icon: Icon, label } = KIND_VIEW[kind];
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
          Didn&apos;t load. Retry
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
    "flex max-w-64 items-center gap-2.5 rounded-lg border border-border bg-app-white px-3 py-2 transition-colors duration-150 ease-out";

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
      aria-label={`Open ${label.toLowerCase()}`}
      className={cn(className, "hover:bg-secondary/60")}
    >
      {inner}
    </a>
  );
}
