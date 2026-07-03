"use client";

import { Download, FileText, ImageOff, Images } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAttachmentGallery } from "@/lib/api/gallery";
import { flattenPages } from "@/lib/api/pagination";
import type { GalleryItem } from "@/lib/api/types";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";

import {
  fileLabel,
  formatBytes,
  groupByDate,
  itemsForTab,
  sourceLabel,
  type GalleryTab,
} from "./gallery-grouping";

/**
 * The attachments gallery (§5.2 — Telegram "Shared Media" trimmed to a
 * tradesperson's reality). One surface, one entry point (the thread-header
 * overflow); the context panel only links here. Consumes the two-arm union
 * GET /v1/conversations/:id/attachments — message + note + task media, each
 * item arriving pre-signed — with Images | Files category tabs, calm date
 * grouping, blur-up thumbnails, and the signed-URL lightbox / download.
 */
export function AttachmentsGallery({
  conversationId,
  open,
  onOpenChange,
  contactName,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactName: string;
}) {
  // Only fetch once the gallery is opened (one page of freshly-signed URLs).
  const gallery = useAttachmentGallery(conversationId, open);
  const items = useMemo(() => flattenPages(gallery.data), [gallery.data]);

  const [tab, setTab] = useState<GalleryTab>("images");
  const [lightbox, setLightbox] = useState<GalleryItem | null>(null);

  const imageCount = useMemo(
    () => items.filter((i) => i.kind === "image").length,
    [items],
  );
  const fileCount = items.length - imageCount;

  const tabItems = useMemo(() => itemsForTab(items, tab), [items, tab]);
  const groups = useMemo(() => groupByDate(tabItems), [tabItems]);

  const hasNext = gallery.hasNextPage ?? false;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <div className="border-b border-border px-5 pt-5 pb-3">
            <DialogTitle className="text-base font-semibold">
              Attachments
            </DialogTitle>
            <DialogDescription className="sr-only">
              Photos and files shared in the conversation with {contactName}.
            </DialogDescription>

            {/* Category tabs — quiet stone active pill, no petrol (§5.2). */}
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as GalleryTab)}
              className="mt-3"
            >
              <TabsList>
                <TabsTrigger value="images">
                  Images
                  {imageCount > 0 && (
                    <span className="ml-1 tabular-nums text-muted-foreground">
                      {imageCount}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="files">
                  Files
                  {fileCount > 0 && (
                    <span className="ml-1 tabular-nums text-muted-foreground">
                      {fileCount}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-stone-50 px-5 py-4 dark:bg-stone-950/40">
            {gallery.isPending ? (
              <GallerySkeleton />
            ) : gallery.isError ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  We couldn&apos;t load the attachments.
                </p>
                <button
                  type="button"
                  onClick={() => gallery.refetch()}
                  className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : tabItems.length === 0 ? (
              <GalleryEmpty tab={tab} />
            ) : (
              <div className="space-y-6">
                {groups.map((group) => (
                  <section key={group.label} className="space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground">
                      {group.label}
                    </h3>
                    {tab === "images" ? (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {group.items.map((item) => (
                          <GalleryThumb
                            key={item.id}
                            item={item}
                            onOpen={() => setLightbox(item)}
                          />
                        ))}
                      </div>
                    ) : (
                      <ul className="space-y-1">
                        {group.items.map((item) => (
                          <GalleryFileRow key={item.id} item={item} />
                        ))}
                      </ul>
                    )}
                  </section>
                ))}

                {hasNext && (
                  <div className="flex justify-center pt-1">
                    <button
                      type="button"
                      onClick={() => gallery.fetchNextPage()}
                      disabled={gallery.isFetchingNextPage}
                      className="rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground disabled:opacity-60"
                    >
                      {gallery.isFetchingNextPage ? "Loading…" : "Load more"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Signed-URL lightbox — an independent dialog (sibling, not nested) so
          closing it never dismisses the gallery. The gallery URL is already
          short-lived + signed, so it drives the full view directly (no per-item
          /url fetch, §5.2). */}
      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
    </>
  );
}

/** A blur-up image thumbnail with its origin tag; click → lightbox. */
function GalleryThumb({
  item,
  onOpen,
}: {
  item: GalleryItem;
  onOpen: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = fileLabel(item);
  const captured = formatRelativeTime(item.created_at);

  if (failed) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
        <ImageOff className="size-5" strokeWidth={1.75} aria-hidden />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!loaded}
      aria-label={`Open ${sourceLabel(item.source).toLowerCase()} photo from ${captured}`}
      className="group relative block aspect-square overflow-hidden rounded-lg border border-border bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {!loaded && (
        <span aria-hidden className="absolute inset-0 animate-pulse bg-muted" />
      )}
      {/* Signed Supabase Storage URL; next/image is unoptimized on this deploy
          target and the URL is short-lived — plain img (matches AttachmentImage). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.url}
        alt={label}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          "size-full object-cover transition-[opacity,filter] duration-200 ease-out",
          loaded ? "opacity-100 blur-0" : "opacity-0 blur-sm",
        )}
      />
      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {sourceLabel(item.source)}
      </span>
    </button>
  );
}

/** A file row (name, origin, size, date) with a signed-URL download. */
function GalleryFileRow({ item }: { item: GalleryItem }) {
  const label = fileLabel(item);
  const size = formatBytes(item.size_bytes);
  return (
    <li>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        download={item.file_name ?? undefined}
        className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors duration-150 ease-out hover:bg-secondary/60"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <FileText className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{label}</span>
          <span
            className="block text-[11px] tabular-nums text-muted-foreground"
            title={formatAbsoluteDateTime(item.created_at)}
          >
            {sourceLabel(item.source)}
            {size ? ` · ${size}` : ""} · {formatRelativeTime(item.created_at)}
          </span>
        </span>
        <Download
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
      </a>
    </li>
  );
}

/** The image lightbox — a focus-trapped dialog with ESC (Radix default). */
function Lightbox({
  item,
  onClose,
}: {
  item: GalleryItem | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[92vw] border-none bg-transparent p-0 shadow-none sm:max-w-3xl"
        showCloseButton
      >
        <DialogTitle className="sr-only">Photo</DialogTitle>
        {item && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.url}
            alt={fileLabel(item)}
            className="max-h-[85vh] w-full rounded-lg object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function GalleryEmpty({ tab }: { tab: GalleryTab }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Images
        className="size-6 text-muted-foreground"
        strokeWidth={1.5}
        aria-hidden
      />
      <p className="text-sm text-muted-foreground">
        {tab === "images"
          ? "No photos shared in this conversation yet."
          : "No files shared in this conversation yet."}
      </p>
    </div>
  );
}

function GallerySkeleton() {
  return (
    <div aria-hidden className="space-y-4">
      <Skeleton className="h-3 w-16" />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    </div>
  );
}

/**
 * The context panel's "View all attachments (N)" preview row (§1.5): up to a few
 * recent thumbnails plus a quiet count, opening the single gallery surface. Not a
 * second gallery — one entry point, one surface. Fetches lazily (only when the
 * panel is open) and renders nothing while empty so the panel stays calm.
 */
export function AttachmentsPreviewRow({
  conversationId,
  onOpenGallery,
  enabled = true,
}: {
  conversationId: string;
  onOpenGallery: () => void;
  enabled?: boolean;
}) {
  const gallery = useAttachmentGallery(conversationId, enabled);
  const items = useMemo(() => flattenPages(gallery.data), [gallery.data]);
  const images = useMemo(() => items.filter((i) => i.kind === "image"), [items]);
  const hasMore = gallery.hasNextPage ?? false;

  if (gallery.isPending || gallery.isError || items.length === 0) return null;

  // "N" is honest: the count loaded so far, with "+" when more pages remain.
  const countLabel = `${items.length}${hasMore ? "+" : ""}`;
  const thumbs = images.slice(0, 4);

  return (
    <button
      type="button"
      onClick={onOpenGallery}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 ease-out hover:bg-secondary/60"
    >
      <span className="flex-1 text-sm text-foreground">
        View all attachments{" "}
        <span className="tabular-nums text-muted-foreground">
          ({countLabel})
        </span>
      </span>
      {thumbs.length > 0 && (
        <span className="flex shrink-0 -space-x-1.5">
          {thumbs.map((item) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={item.id}
              src={item.url}
              alt=""
              aria-hidden
              loading="lazy"
              className="size-7 rounded-md border border-background object-cover"
            />
          ))}
        </span>
      )}
    </button>
  );
}
