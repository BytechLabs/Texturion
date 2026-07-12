"use client";

/**
 * D43 (#135) voicemail player — a quiet "Play voicemail (0:42)" affordance
 * that swaps to a native <audio controls> once the signed URL is fetched
 * (on demand — URLs are signed for an hour and never rendered eagerly into
 * lists). Used by the /calls rows and the thread's call line.
 */
import { Play } from "lucide-react";
import { useState } from "react";

import { useVoicemailUrl } from "@/lib/api/calls";
import { formatCallDuration } from "@/lib/format/call";

export function VoicemailPlayer({
  callSessionId,
  seconds,
}: {
  callSessionId: string;
  seconds: number | null;
}) {
  const [open, setOpen] = useState(false);
  const voicemail = useVoicemailUrl(callSessionId, open);

  if (open && voicemail.data?.url) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption -- a customer
      // voicemail has no caption track; the duration label is the context.
      <audio
        src={voicemail.data.url}
        controls
        autoPlay
        preload="auto"
        className="h-8 w-full max-w-[280px]"
        aria-label="Voicemail recording"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        // Rows are links — playing a voicemail must not navigate.
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-app-line bg-app-white px-2.5 py-1 text-[12px] font-medium text-app-ink transition-colors duration-150 hover:bg-app-stone-1"
    >
      <Play className="size-3.5" strokeWidth={1.75} aria-hidden />
      {voicemail.isFetching
        ? "Loading…"
        : voicemail.isError
          ? "Couldn't load — retry"
          : `Play voicemail${seconds ? ` (${formatCallDuration(seconds)})` : ""}`}
    </button>
  );
}

/** D43: honest screening label from the raw carrier verdict — mirrors the
 *  server's flag vocabulary; unknown strings show nothing (never cry wolf). */
export function screeningLabel(result: string | null): string | null {
  if (!result) return null;
  const value = result.toLowerCase();
  if (value.includes("no_flag") || value.includes("clean")) return null;
  if (["spam", "fraud", "scam", "robo", "flag", "spoof"].some((m) => value.includes(m))) {
    return "Spam likely";
  }
  return null;
}
