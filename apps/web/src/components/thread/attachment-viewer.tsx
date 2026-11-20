"use client";

import { Download, ImageOff, Play, ZoomIn, ZoomOut } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n/provider";
import { useAttachmentUrl } from "@/lib/api/attachments";
import { downloadAttachment } from "@/lib/attachments/download";

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4] as const;

export function AttachmentViewer({
  id,
  kind,
  label,
  fileName,
  preview,
  original: initialOriginal,
  onClose,
}: {
  id: string;
  kind: "image" | "video";
  label: string;
  fileName: string;
  preview?: string;
  original?: string;
  onClose: () => void;
}) {
  const t = useT();
  const [refresh, setRefresh] = useState(false);
  const original = useAttachmentUrl(id, !initialOriginal || refresh, "original");
  const src = original.data?.url ?? initialOriginal;
  const [failedSrc, setFailedSrc] = useState<string>();
  const [failedPreview, setFailedPreview] = useState<string>();
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const [zoomIndex, setZoomIndex] = useState(0);
  const zoom = ZOOM_LEVELS[zoomIndex] ?? 1;
  const viewport = useRef<HTMLDivElement>(null);
  const previousZoom = useRef(1);
  const focusBeforeOpen = useRef<HTMLElement>(null);
  const failed = failedSrc !== undefined && failedSrc === src;
  const usablePreview = preview === failedPreview ? undefined : preview;
  const imageReady = usablePreview !== undefined || (!failed && loadedSrc === src && src !== undefined);

  useLayoutEffect(() => {
    const stage = viewport.current;
    const ratio = zoom / previousZoom.current;
    if (stage) {
      stage.scrollLeft = (stage.scrollLeft + stage.clientWidth / 2) * ratio - stage.clientWidth / 2;
      stage.scrollTop = (stage.scrollTop + stage.clientHeight / 2) * ratio - stage.clientHeight / 2;
    }
    previousZoom.current = zoom;
  }, [zoom]);

  function retry() {
    setFailedSrc(undefined);
    setRefresh(true);
    if (!initialOriginal || refresh) void original.refetch();
  }

  const shownPreview =
    usablePreview === src || (!failed && src && loadedSrc === src) ? undefined : usablePreview;
  const playbackFailed = failed || original.isError;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          if (active instanceof HTMLElement) focusBeforeOpen.current = active;
        }}
        onCloseAutoFocus={(event) => {
          if (!focusBeforeOpen.current?.isConnected) return;
          event.preventDefault();
          focusBeforeOpen.current.focus();
        }}
        className="max-w-[calc(100%-1rem)] gap-0 overflow-hidden border-app-line bg-app-paper p-0 text-app-ink sm:max-w-4xl"
      >
        <DialogTitle className="px-4 py-4 pr-14 text-base">
          {kind === "image" ? t("thread.photo") : t("thread.mediaVideo")}
        </DialogTitle>
        <div
          ref={viewport}
          className="h-[min(65dvh,40rem)] overflow-auto overscroll-contain bg-background"
          tabIndex={kind === "image" && zoom > 1 ? 0 : undefined}
          role={kind === "image" && zoom > 1 ? "region" : undefined}
          aria-label={kind === "image" && zoom > 1 ? label : undefined}
        >
          <div
            className="relative grid place-items-center"
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          >
            {shownPreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shownPreview}
                alt={label}
                onError={() => setFailedPreview(shownPreview)}
                className="absolute inset-0 size-full object-contain"
              />
            )}
            {src && !failed && kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={shownPreview ? "" : label}
                onLoad={() => setLoadedSrc(src)}
                onError={() => setFailedSrc(src)}
                className="absolute inset-0 size-full object-contain"
                style={{ opacity: shownPreview ? 0 : 1 }}
              />
            )}
            {src && !failed && kind === "video" && (
              // oxlint-disable-next-line jsx-a11y/media-has-caption -- Attachments carry only the sender's original video.
              <video
                src={src}
                aria-label={label}
                controls
                playsInline
                preload="metadata"
                onError={() => setFailedSrc(src)}
                className="absolute inset-0 size-full object-contain"
              />
            )}
            {!src && !shownPreview && !original.isError && (
              <p role="status" className="text-sm text-app-muted">{t("thread.loadingAttachment")}</p>
            )}
            {playbackFailed && !shownPreview && (
              <div className="flex flex-col items-center gap-2 text-app-muted">
                {kind === "image" ? <ImageOff aria-hidden /> : <Play aria-hidden />}
                <Button type="button" variant="ghost" onClick={retry}>
                  {t("thread.didntLoadRetry")}
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 border-t border-app-line px-2 py-2">
          {kind === "image" && (
            <>
              <Button
                type="button" variant="ghost" size="icon"
                aria-label={t("thread.zoomOut")}
                disabled={zoomIndex === 0}
                onClick={() => setZoomIndex(zoomIndex - 1)}
              >
                <ZoomOut aria-hidden />
              </Button>
              <Button
                type="button" variant="ghost"
                aria-label={t("thread.resetZoom")}
                disabled={zoomIndex === 0}
                onClick={() => setZoomIndex(0)}
                className="px-2 tabular-nums"
              >
                {zoom * 100}%
              </Button>
              <Button
                type="button" variant="ghost" size="icon"
                aria-label={t("thread.zoomIn")}
                disabled={!imageReady || zoomIndex === ZOOM_LEVELS.length - 1}
                onClick={() => setZoomIndex(zoomIndex + 1)}
              >
                <ZoomIn aria-hidden />
              </Button>
            </>
          )}
          {playbackFailed && shownPreview && (
            <Button type="button" variant="ghost" onClick={retry}>
              {t("thread.didntLoadRetry")}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!src}
            onClick={() => {
              if (src) downloadAttachment(src, fileName);
            }}
            className="ml-auto"
          >
            <Download aria-hidden />
            {t("thread.downloadAttachment")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
