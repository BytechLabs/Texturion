"use client";

/**
 * D43 (#135) voicemail player — a quiet "Play voicemail (0:42)" affordance
 * that swaps to a native <audio controls> once the signed URL is fetched
 * (on demand — URLs are signed for an hour and never rendered eagerly into
 * lists). Used by the /calls rows and the thread's call line.
 */
import { callLooksSpam } from "@loonext/shared";
import { Play } from "lucide-react";
import { useRef, useState } from "react";

import { VoicemailTranscript } from "@/components/calls/voicemail-transcript";
import { useT, type Translate } from "@/i18n/provider";
import { useVoicemailUrl } from "@/lib/api/calls";
import { formatCallDuration } from "@/lib/format/call";

export function VoicemailPlayer({
  callSessionId,
  seconds,
  showTranscript = false,
}: {
  callSessionId: string;
  seconds: number | null;
  /**
   * Render the transcript under the player. Off by default because the row or
   * timeline line above usually shows it already, and two copies of the same
   * words is worse than none. Parents turn it on ONLY when they have nothing
   * to show themselves, which is exactly the recording that gets its words
   * backfilled on this open.
   */
  showTranscript?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const voicemail = useVoicemailUrl(callSessionId, open);
  const audio = useRef<HTMLAudioElement | null>(null);
  // A new signed URL would restart the recording, so this call keeps the one it started with.
  const latched = useRef<{ sessionId: string; url: string } | null>(null);
  const [, rerender] = useState(0);
  const latest = voicemail.data?.url ?? null;
  const kept = latched.current?.sessionId === callSessionId ? latched.current.url : null;
  if (latest !== null && latest !== kept && (kept === null || canTakeNewUrl(audio.current))) {
    latched.current = { sessionId: callSessionId, url: latest };
  }
  const src = latched.current?.sessionId === callSessionId ? latched.current.url : null;

  if (open && src) {
    return (
      <span className="block w-full">
        <audio
          ref={audio}
          src={src}
          onError={() => {
            // An expired URL with nothing newer cached: ask for a new one.
            if (latest === src) void voicemail.refetch();
            else rerender((n) => n + 1);
          }}
          controls
          autoPlay
          preload="auto"
          className="h-8 w-full max-w-[280px]"
          aria-label={t("shell.voicemailRecording")}
        />
        {/* A recording from before transcription existed, or one whose
            transcription failed at the time, gets its words on first open. */}
        {showTranscript && voicemail.data?.transcript && (
          <VoicemailTranscript
            text={voicemail.data.transcript}
            className="mt-1.5"
          />
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        // Rows are links — playing a voicemail must not navigate.
        event.preventDefault();
        event.stopPropagation();
        // A failed fetch already has open=true, so "retry" must refetch — not
        // setOpen(true) again (a no-op that leaves the button lying).
        if (voicemail.isError) {
          void voicemail.refetch();
        } else {
          setOpen(true);
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-app-line bg-app-paper px-2.5 py-1 text-[12px] font-medium text-app-ink transition-colors duration-150 hover:bg-app-hover"
    >
      <Play className="size-3.5" strokeWidth={1.75} aria-hidden />
      {voicemail.isFetching
        ? t("shell.loading")
        : voicemail.isError
          ? t("shell.voicemailLoadFailed")
          : seconds
            ? t("shell.playVoicemailWithLength", {
                duration: formatCallDuration(seconds),
              })
            : t("shell.playVoicemail")}
    </button>
  );
}

function canTakeNewUrl(element: HTMLAudioElement | null): boolean {
  return (
    element === null ||
    element.error !== null ||
    (element.paused && element.played.length === 0)
  );
}

/** D43: the carrier's spam verdict as a label; anything else shows nothing. */
export function screeningLabel(
  result: string | null,
  callerName: string | null,
  t: Translate,
): string | null {
  return callLooksSpam(result, callerName) ? t("shell.spamLikely") : null;
}
