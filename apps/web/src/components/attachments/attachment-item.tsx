"use client";

import { Download, FileText, ImageOff, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAttachmentUrl } from "@/lib/api/attachments";
import { formatAbsoluteDateTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";

import { formatBytes } from "@/components/thread/gallery-grouping";

import {
  attachmentLabel,
  isImageAttachment,
  type AttachmentLike,
} from "./derived-attachments";

// Re-exported for existing importers; the pure logic lives in
// derived-attachments.ts so it unit-tests without React.
export { attachmentLabel, isImageAttachment, type AttachmentLike };

/**
 * One attachment row (D19 / D28 / APP-FEATURES-V2 §2.5). Images render a
 * small blur-up preview that opens a signed-URL lightbox; every other type
 * (PDF, doc, csv, zip…) is a calm file chip whose name links to a freshly
 * signed download URL. The signed URL is minted on demand from
 * `GET /v1/attachments/:id/url` (one route, three sources — generic AND MMS
 * ids), so this row renders generic note/task rows and the D28 derived task
 * union alike; it only needs the `AttachmentLike` columns.
 *
 * `meta`, when supplied, is a short origin tag appended to the sub-line
 * (Message / Note / Legacy in the task drawer). `onRemove`, when supplied,
 * renders a quiet trailing delete control (the D30 free-space path) — callers
 * gate it to rows the API can actually delete (generic only, never MMS).
 */
export function AttachmentItem({
  attachment,
  meta,
  onRemove,
  removing = false,
}: {
  attachment: AttachmentLike;
  meta?: string;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const row = isImageAttachment(attachment) ? (
    <ImageAttachmentRow attachment={attachment} meta={meta} />
  ) : (
    <FileAttachmentRow attachment={attachment} meta={meta} />
  );

  if (!onRemove) return row;

  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">{row}</div>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label={`Delete ${attachmentLabel(attachment)}`}
        className="tap-target flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-secondary hover:text-destructive disabled:opacity-50"
      >
        {removing ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden />
        ) : (
          <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
        )}
      </button>
    </div>
  );
}

/** The "Image · 24 KB · Note" sub-line, dropping absent parts. */
function subLine(parts: (string | null | undefined)[]): string {
  return parts.filter((part): part is string => !!part).join(" · ");
}

function ImageAttachmentRow({
  attachment,
  meta,
}: {
  attachment: AttachmentLike;
  meta?: string;
}) {
  const url = useAttachmentUrl(attachment.id);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const label = attachmentLabel(attachment);
  const size = formatBytes(attachment.size_bytes);

  if (url.isError) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-muted-foreground">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <ImageOff className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        <button
          type="button"
          onClick={() => url.refetch()}
          className="text-xs underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!loaded}
        aria-label={`Open ${label}`}
        className="flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-secondary/60 disabled:cursor-default"
      >
        <span className="relative size-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
          {!loaded && (
            <span aria-hidden className="absolute inset-0 animate-pulse bg-muted" />
          )}
          {url.data && (
            // Signed Supabase Storage URL — unoptimized target, short-lived URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url.data.url}
              alt=""
              onLoad={() => setLoaded(true)}
              className={cn(
                "size-full object-cover transition-[opacity,filter] duration-200 ease-out",
                loaded ? "opacity-100 blur-0" : "opacity-0 blur-sm",
              )}
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{label}</span>
          <span
            className="block text-[11px] tabular-nums text-muted-foreground"
            title={formatAbsoluteDateTime(attachment.created_at)}
          >
            {subLine(["Image", size, meta])}
          </span>
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-[92vw] border-none bg-transparent p-0 shadow-none sm:max-w-3xl"
          showCloseButton
        >
          <DialogTitle className="sr-only">{label}</DialogTitle>
          {url.data && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url.data.url}
              alt={label}
              className="max-h-[85vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FileAttachmentRow({
  attachment,
  meta,
}: {
  attachment: AttachmentLike;
  meta?: string;
}) {
  const url = useAttachmentUrl(attachment.id);
  const label = attachmentLabel(attachment);
  const size = formatBytes(attachment.size_bytes);
  const typeLabel =
    attachment.content_type?.split("/").pop()?.toUpperCase() ?? "File";

  if (url.isError) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-muted-foreground">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <FileText className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        <button
          type="button"
          onClick={() => url.refetch()}
          className="text-xs underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // While the signed URL is loading the chip is a non-interactive placeholder;
  // once minted it becomes a real download link (opens in a new tab / saves).
  const href = url.data?.url;
  const inner = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <FileText className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{label}</span>
        <span
          className="block text-[11px] tabular-nums text-muted-foreground"
          title={formatAbsoluteDateTime(attachment.created_at)}
        >
          {subLine([typeLabel, size, meta])}
        </span>
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
    "flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors duration-150 ease-out";

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
      download={attachment.file_name ?? undefined}
      aria-label={`Download ${label}`}
      className={cn(className, "hover:bg-secondary/60")}
    >
      {inner}
    </a>
  );
}
