"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/**
 * #566 — a voicemail transcript, and a way to get it out.
 *
 * The founder's ask: *"What about other UX like copying the transcription? By
 * holding? Or something?"* A transcript is read on a phone and then needed
 * somewhere else — pasted to a colleague, into a job note, into a quote — and
 * there was no way to lift it off the screen on any client.
 *
 * ## Why this is a component rather than a copy button
 *
 * The same paragraph was rendered in four places on web with four sets of class
 * strings that had already drifted apart: the call row, the voicemail player, the
 * call detail, and the thread timeline. A copy control added to one of them would
 * have been a copy control missing from three. Naming the thing once is also what
 * lets the phones' long-press and this button mean the same thing.
 *
 * ## Why a visible button and not a long-press
 *
 * Long-press is right on a phone and wrong here. A pointer has no press-and-hold
 * vocabulary, and the two web precedents for copying prose are both explicit
 * controls (`message-actions.tsx` in the overflow menu, `share-job-photos.tsx` as
 * a labelled button). The phones use `.contextMenu` / `combinedClickable`, which
 * IS what a thumb reaches for — one gesture per platform, each the platform's own.
 *
 * ## Why the click is swallowed
 *
 * A call row is an `<a>` (`call-row.tsx`, shared by /calls and a contact's call
 * history), so copying there must not navigate — the same reason the play button in
 * `voicemail-player.tsx` stops its own event. The thread's event line is NOT a
 * link, and the call permalink is a page; the handler simply costs nothing at
 * those two, so it is unconditional rather than a prop nobody would remember to
 * set at the one site that needs it.
 */
/**
 * Render ONLY real transcribed words.
 *
 * `transcriptState` (call-detail-copy.ts) returns explanatory sentences for the
 * four honest not-transcribed states — "No voicemail was left on this call.",
 * "We couldn't make out any words in this one." — with `muted: true`. Those are
 * the page talking, not the caller, and offering to copy one would be offering
 * to copy our own apology. Callers gate on that flag; this component assumes it
 * has been gated.
 */
export function VoicemailTranscript({
  text,
  className,
  /**
   * The call permalink is a reading surface, not a row: the transcript is the
   * thing somebody followed a link to read, so it gets body size there.
   */
  prominent = false,
}: {
  text: string;
  className?: string;
  prominent?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (event: React.MouseEvent) => {
    // The row around this is a link; copying is not navigation.
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Transcript copied.");
      // Long enough to read, short enough that the control is ready again for
      // somebody pasting into two places.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Same sentence the thread uses, because it is the same failure: a
      // browser that refuses clipboard access, not anything the reader did.
      toast.error("Couldn't copy. Your browser blocked clipboard access.");
    }
  };

  return (
    <span className={cn("flex items-start gap-1.5", className)}>
      <span
        className={cn(
          "min-w-0 flex-1",
          prominent
            ? "text-sm text-app-ink"
            : "text-[12.5px] leading-[1.45] text-app-muted",
        )}
      >
        {text}
      </span>
      {/* Icon-only: the transcript is the content and a labelled button beside a
          paragraph reads as a second heading. `shrink-0` because the paragraph is
          what should reflow — the whole lesson of this issue. */}
      <button
        type="button"
        onClick={(event) => void copy(event)}
        aria-label="Copy transcript"
        className="tap-target -mt-0.5 shrink-0 rounded-md p-1 text-app-muted-2 transition-colors duration-150 ease-out hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? (
          <Check className="size-3.5" strokeWidth={2} aria-hidden />
        ) : (
          <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
        )}
      </button>
    </span>
  );
}
