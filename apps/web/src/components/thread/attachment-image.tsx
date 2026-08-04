"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAttachmentUrl } from "@/lib/api/attachments";
import type { AttachmentSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * MMS thumbnail (G5): fixed 176px square (stable virtual-row measurement),
 * rounded, signed-URL fetch with a blur-up reveal, click → lightbox. The
 * signed URL comes from GET /v1/attachments/:id/url (1h TTL; the hook caches
 * just under it).
 *
 * #240: two fetches, not one. The square gets the PREVIEW — a 25 MB original
 * behind a 176px thumbnail was the single worst egress shape in the product,
 * and it is the tech's own mobile data too (#289). The lightbox gets the
 * ORIGINAL, and only once it is opened, so nobody pays for a full-size image
 * they never looked at.
 *
 * The lightbox shows the preview underneath while the original loads. It is
 * already decoded and in the browser's cache, so the picture appears instantly
 * and sharpens — rather than a spinner over a photo the reader has, in every
 * practical sense, already seen.
 * *Applying: the Excitement principle — a progressive reveal instead of a wait,
 * on the surface where somebody is looking closely.*
 */
export function AttachmentImage({
  attachment,
  alt,
}: {
  attachment: AttachmentSummary;
  alt: string;
}) {
  const url = useAttachmentUrl(attachment.id);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  // Fetched only while the lightbox is open — `enabled` is the whole point.
  // A row with no preview serves its original for both, so this is a second
  // mint of the same object rather than a wasted one.
  const fullSize = useAttachmentUrl(attachment.id, open, "original");
  const [fullSizeLoaded, setFullSizeLoaded] = useState(false);
  // The lightbox's full-size <img> can also fail to render (expired signed URL,
  // network blip) — without this the dialog is a blank frame.
  const [lightboxFailed, setLightboxFailed] = useState(false);
  // The URL fetch can succeed yet the <img> still fail to render (expired/broken
  // signed URL, mid-flight network blip) — without this the thumbnail is a
  // permanent pulsing skeleton on a disabled button. Treat it like a url error.
  const [failed, setFailed] = useState(false);

  if (url.isError || failed) {
    return (
      <div className="flex size-44 items-center justify-center rounded-lg border border-border bg-muted">
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <ImageOff className="size-5" strokeWidth={1.75} aria-hidden />
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setLoaded(false);
              void url.refetch();
            }}
            className="text-xs underline-offset-2 hover:underline"
          >
            Photo didn&apos;t load. Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!loaded}
        aria-label={`Open photo: ${alt}`}
        className="relative block size-44 overflow-hidden rounded-lg border border-border bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {!loaded && (
          <span aria-hidden className="absolute inset-0 animate-pulse bg-muted" />
        )}
        {url.data && (
          // Signed Supabase Storage URL — next/image is unoptimized on this
          // deploy target (SPEC §3) and the URL is short-lived; plain img.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url.data.url}
            alt={alt}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={cn(
              "size-full object-cover transition-[opacity,filter] duration-200 ease-out",
              loaded ? "opacity-100 blur-0" : "opacity-0 blur-sm",
            )}
          />
        )}
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setLightboxFailed(false); // fresh attempt each open
            setFullSizeLoaded(false); // …and the reveal starts again
          }
        }}
      >
        <DialogContent
          className="max-w-[92vw] border-none bg-transparent p-0 shadow-none sm:max-w-3xl"
          showCloseButton
        >
          <DialogTitle className="sr-only">Photo</DialogTitle>
          {url.data && !lightboxFailed && (
            <div className="relative">
              {/* The preview, already decoded and cached from the thumbnail.
                  Underneath, so the photo is there the instant the dialog is,
                  and it sharpens when the original lands. */}
              {!fullSizeLoaded && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url.data.url}
                  alt={alt}
                  aria-hidden={fullSize.data !== undefined}
                  className="max-h-[85vh] w-full rounded-lg object-contain"
                />
              )}
              {fullSize.data && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fullSize.data.url}
                  alt={alt}
                  onLoad={() => setFullSizeLoaded(true)}
                  // A failed ORIGINAL is not a failed photo: the preview above
                  // is still on screen and still shows what happened on the
                  // job. Falling back to it beats an error over a picture the
                  // reader can already see.
                  onError={() => setFullSizeLoaded(false)}
                  className={cn(
                    "max-h-[85vh] w-full rounded-lg object-contain",
                    fullSizeLoaded ? "relative" : "absolute inset-0 opacity-0",
                  )}
                />
              )}
            </div>
          )}
          {url.data && lightboxFailed && (
            <div className="flex items-center justify-center rounded-lg bg-muted p-12">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <ImageOff className="size-6" strokeWidth={1.75} aria-hidden />
                <span className="text-sm">This photo couldn&apos;t be loaded.</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
