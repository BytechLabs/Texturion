"use client";

import { Download, FileMusic } from "lucide-react";

import { useAttachmentUrl } from "@/lib/api/attachments";
import type { AttachmentSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { formatBytes } from "./gallery-grouping";

/**
 * An audio MMS attachment, PLAYABLE in the thread.
 *
 * Founder report (live device): a customer sent a voice message and there was
 * nowhere in the app to hear it — audio fell into the generic #189 file chip,
 * so listening meant opening a signed URL in a new tab and leaving the
 * conversation. A voice message is a message; it belongs in the bubble next to
 * the text, the same way a photo does.
 *
 * The native `<audio controls>` element is the right tool: it plays every
 * format carriers deliver (mp3/m4a/amr/wav/ogg/3gp) using the platform decoder,
 * ships keyboard support and a scrubber for free, and respects OS media keys.
 * The download affordance stays alongside it, because a crew often wants to
 * keep the clip.
 */
export function AttachmentAudio({
  attachment,
  fromLabel,
}: {
  attachment: AttachmentSummary;
  /** Whose clip this is, for the accessible name ("Voice message from Dana"). */
  fromLabel: string;
}) {
  // #240: audio never has a preview, and a player needs the whole file. Said
  // explicitly so the default cannot quietly change underneath it.
  const url = useAttachmentUrl(attachment.id, true, "original");
  const size = formatBytes(attachment.size_bytes);
  const href = url.data?.url;

  if (url.isError) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2 text-muted-foreground">
        <FileMusic className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="text-sm">Audio message</span>
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

  return (
    <div
      className={cn(
        "flex w-64 max-w-full flex-col gap-1.5 rounded-lg border border-border bg-app-paper px-3 py-2.5",
        !href && "opacity-70",
      )}
      aria-busy={!href || undefined}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <FileMusic className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          Audio message
        </span>
        {size && (
          <span className="shrink-0 text-[11px] tabular-nums">{size}</span>
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Download audio message ${fromLabel}`}
            className="shrink-0 rounded-md p-0.5 transition-colors duration-150 ease-out hover:text-foreground"
          >
            <Download className="size-4" strokeWidth={1.75} aria-hidden />
          </a>
        )}
      </div>
      {/* `preload="none"` keeps a thread full of clips from pulling every file
          on render — the browser fetches only what someone presses play on. */}
      {href ? (
        <audio
          controls
          preload="none"
          src={href}
          aria-label={`Audio message ${fromLabel}`}
          className="w-full"
        />
      ) : (
        <div className="h-8 animate-pulse rounded-md bg-muted" aria-hidden />
      )}
    </div>
  );
}
