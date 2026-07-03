"use client";

import { Download, FileText, ImageOff } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAttachmentUrl } from "@/lib/api/attachments";
import type { Attachment } from "@/lib/api/types";
import { formatAbsoluteDateTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";

import { formatBytes } from "@/components/thread/gallery-grouping";

/** True when the row is an image — drives preview vs. file-chip (D19). */
export function isImageAttachment(attachment: Attachment): boolean {
  return (attachment.content_type ?? "").toLowerCase().startsWith("image/");
}

/** A readable name for a row: the stored name, else a type-derived fallback. */
function attachmentLabel(attachment: Attachment): string {
  if (attachment.file_name && attachment.file_name.trim() !== "") {
    return attachment.file_name;
  }
  const subtype = attachment.content_type?.split("/")[1]?.toUpperCase();
  return subtype ? `${subtype} file` : "File";
}

/**
 * One note/task attachment row (D19 / APP-FEATURES-V2 §2.5). Images render a
 * small blur-up preview that opens a signed-URL lightbox; every other type
 * (PDF, doc, csv, zip…) is a calm file chip whose name links to a freshly
 * signed download URL. The signed URL is minted on demand from
 * `GET /v1/attachments/:id/url` (the same route the MMS thumbnails use).
 *
 * `onRemove`, when supplied, renders a quiet trailing remove control — kept
 * out of MVP by default (soft-delete of a single attachment is a separate
 * backend action), so callers simply omit it.
 */
export function AttachmentItem({ attachment }: { attachment: Attachment }) {
  return isImageAttachment(attachment) ? (
    <ImageAttachmentRow attachment={attachment} />
  ) : (
    <FileAttachmentRow attachment={attachment} />
  );
}

function ImageAttachmentRow({ attachment }: { attachment: Attachment }) {
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
            Image{size ? ` · ${size}` : ""}
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

function FileAttachmentRow({ attachment }: { attachment: Attachment }) {
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
          {typeLabel}
          {size ? ` · ${size}` : ""}
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
