"use client";

import {
  Download,
  FileText,
  ImageOff,
  Loader2,
  MoreHorizontal,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/provider";
import {
  useAttachmentUrl,
  useReportAttachment,
} from "@/lib/api/attachments";
import { ApiError } from "@/lib/api/error";
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

  // #317: the actions menu is on EVERY attachment now, not only the deletable
  // ones. Reporting matters most for the files nobody here chose — a customer's
  // texted-in photo, which is exactly the arm that has no delete.
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">{row}</div>
      <AttachmentActions
        attachment={attachment}
        onRemove={onRemove}
        removing={removing}
      />
    </div>
  );
}

/**
 * #317: is this failure "the file is held" rather than "the mint failed"?
 *
 * `forbidden` is unambiguous on this route. A file hidden by number access
 * (#106) returns not_found on purpose — hiding its existence — so the only way
 * to get a 403 from the URL mint is a reported file.
 */
function heldReason(error: unknown): string | null {
  return error instanceof ApiError && error.code === "forbidden"
    ? error.message
    : null;
}

/**
 * #317: the file was reported, so it is on hold for the whole workspace.
 *
 * This is NOT the generic error row. The distinction is the point: a failed
 * mint is "try again", and a hold is "somebody stopped this on purpose".
 * Offering Retry here would invite a crew member to keep tapping at a thing
 * that is working exactly as intended, and — worse — read as a glitch rather
 * than as a decision a teammate made.
 */
function HeldRow({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-app-amber-line bg-app-amber-bg px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-app-amber-bg text-app-amber">
        <ShieldAlert className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-app-amber-ink">{label}</span>
        <span className="block text-[11px] leading-[1.5] text-app-amber-ink/80">
          {reason}
        </span>
      </span>
    </div>
  );
}

/**
 * The trailing controls, collapsed into one overflow menu.
 *
 * Report is on every attachment; Delete exists only where the API can actually
 * delete (generic rows, never a customer's MMS). Two trailing icon buttons on a
 * row this compact is clutter, and the second one arriving is exactly the
 * moment to collapse them — so both live behind the triple dot and the row
 * keeps one visual job.
 *
 * Reporting asks first. It affects everyone, and an accidental tap that pulls a
 * customer's photo from the whole crew's view is worth one deliberate beat —
 * but only one, because hesitation is how somebody ends up opening the file
 * instead of flagging it.
 */
function AttachmentActions({
  attachment,
  onRemove,
  removing,
}: {
  attachment: AttachmentLike;
  onRemove?: () => void;
  removing: boolean;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const report = useReportAttachment();
  const label = attachmentLabel(attachment);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("misc.attachmentActionsAria", { name: label })}
            className="tap-target flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-secondary hover:text-foreground"
          >
            {removing || report.isPending ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden />
            ) : (
              <MoreHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setConfirming(true)}>
            <ShieldAlert className="size-4" strokeWidth={1.75} aria-hidden />
            {t("misc.reportFile")}
          </DropdownMenuItem>
          {onRemove && (
            <DropdownMenuItem onSelect={onRemove} disabled={removing}>
              <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
              {t("common.delete")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t("misc.reportFileTitle")}</DialogTitle>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("misc.reportFileBodyBefore")}{" "}
            <span className="text-foreground">{label}</span>{" "}
            {t("misc.reportFileBodyAfter")}
          </p>
          {report.isError && (
            <p className="text-sm text-destructive">{report.error.message}</p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:bg-secondary"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={report.isPending}
              onClick={() =>
                report.mutate(
                  { attachmentId: attachment.id },
                  { onSuccess: () => setConfirming(false) },
                )
              }
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:opacity-90 disabled:opacity-50"
            >
              {report.isPending
                ? t("misc.reportingFile")
                : t("misc.reportFileAction")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
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
  // #240: the 40px chip gets the preview; the lightbox gets the original, and
  // only once it is opened. `size` below stays the ORIGINAL's — it is what
  // "12.4 MB" means to somebody deciding whether to open it on mobile data.
  const t = useT();
  const url = useAttachmentUrl(attachment.id);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const fullSize = useAttachmentUrl(attachment.id, open, "original");
  const label = attachmentLabel(attachment);
  const size = formatBytes(attachment.size_bytes);

  const imageHeld = heldReason(url.error);
  if (imageHeld) return <HeldRow label={label} reason={imageHeld} />;

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
          {t("misc.retry")}
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
        aria-label={t("misc.attachmentOpenAria", { name: label })}
        className="flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-app-hover disabled:cursor-default"
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
            {subLine([t("misc.attachmentKindImage"), size, meta])}
          </span>
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-[92vw] border-none bg-transparent p-0 shadow-none sm:max-w-3xl"
          showCloseButton
        >
          <DialogTitle className="sr-only">{label}</DialogTitle>
          {/* The original once it lands, the already-cached preview until then,
              so the picture is on screen the instant the dialog is. */}
          {(fullSize.data ?? url.data) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={(fullSize.data ?? url.data)!.url}
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
  // #240: a download hands over the FILE. Nothing here has a preview today —
  // this row is PDFs and documents, which never get one — but asking for the
  // original explicitly is what keeps that true if the rule ever widens: a
  // download that quietly saved a thumbnail would be a silent data loss.
  const t = useT();
  const url = useAttachmentUrl(attachment.id, true, "original");
  const label = attachmentLabel(attachment);
  const size = formatBytes(attachment.size_bytes);
  const typeLabel =
    attachment.content_type?.split("/").pop()?.toUpperCase() ??
    t("misc.attachmentKindFile");

  const fileHeld = heldReason(url.error);
  if (fileHeld) return <HeldRow label={label} reason={fileHeld} />;

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
          {t("misc.retry")}
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
      aria-label={t("misc.attachmentDownloadAria", { name: label })}
      className={cn(className, "hover:bg-app-hover")}
    >
      {inner}
    </a>
  );
}
