import { AI_UNIT_COST_CENTS } from "../billing/costs";
import type { AiFeatureSpec } from "../ai/run";

/**
 * Voicemails you can read — the pure core.
 *
 * We already own the audio (the recording is downloaded into our own bucket and
 * the Telnyx copy deleted), so the only missing piece is words. Someone on a
 * roof, in a truck, or next to a running compressor cannot play a voicemail,
 * and one nobody listens to is a missed customer.
 *
 * This module holds the deterministic pieces — the limits, the model envelope
 * reader, and the sanitizer — so they are unit-testable with no AI binding. The
 * caller (messaging/inbound-ring.ts) owns the I/O: the settings gate, the
 * monthly-cap reservation, the `env.AI.run` call with a timeout, and the alert.
 *
 * Posture (cost-protection mandate):
 *   - Naturally bounded (one call per voicemail, voicemails bounded by inbound
 *     call volume) but still reserved against the per-feature monthly ledger,
 *     under its OWN feature key so a runaway here cannot starve task enrichment
 *     or reply drafting.
 *   - BEST EFFORT, always. Every failure path leaves the voicemail exactly as
 *     it is today: audio stored, threaded, playable. A transcript is an extra,
 *     never a precondition.
 *   - The transcript is DATA, never an instruction. Nothing downstream acts on
 *     it; it is stored and displayed.
 */

/**
 * Workers AI speech-to-text, $0.00051 per audio minute at the time of writing.
 *
 * The turbo model over the base one for two reasons that both matter here. It
 * takes its audio as BASE64 rather than an array of byte numbers: a 5-minute
 * recording is roughly a million array elements otherwise, built inside a
 * 128 MB Worker that is simultaneously holding the raw buffer and uploading it.
 * And voicemail is the hard case for transcription — phone-quality audio, a
 * running compressor, an accent — which is exactly where the better model earns
 * the extra six thousandths of a cent per minute.
 */
export const VOICEMAIL_TRANSCRIPT_MODEL = "@cf/openai/whisper-large-v3-turbo";

/**
 * The older model, kept as a fallback with a DIFFERENT input shape (an array of
 * byte numbers rather than base64). The AI binding cannot be exercised outside
 * a deployed Worker, so one model's input contract being wrong must not mean no
 * words at all.
 */
export const VOICEMAIL_TRANSCRIPT_FALLBACK_MODEL = "@cf/openai/whisper";

/** The per-feature key in the shared monthly AI ledger (`ai_usage_reserve`). */
export const VOICEMAIL_TRANSCRIPT_FEATURE = "voicemail_transcript";

/**
 * Hard per-company monthly cap. A voicemail is already gated by someone
 * actually calling, so this is far above real use and exists only to bound a
 * runaway (a webhook replay storm, a compromised key). Over the cap the audio
 * is stored and threaded exactly as before, just without words.
 */
export const VOICEMAIL_TRANSCRIPT_MONTHLY_CAP = 500;

/** Fire the one-shot ops alert at 80% of the cap (alert BEFORE the cap). */
export const VOICEMAIL_TRANSCRIPT_ALERT_THRESHOLD = Math.floor(
  VOICEMAIL_TRANSCRIPT_MONTHLY_CAP * 0.8,
);

/**
 * Longest recording we will transcribe. Voicemail greetings cap the recording
 * well under this; anything longer is a stuck recording, and paying per audio
 * minute for it is exactly the runaway the cap exists to stop.
 */
export const VOICEMAIL_TRANSCRIPT_MAX_SECONDS = 300;

/** Never hold up the voicemail write: race the model against this. */
export const VOICEMAIL_TRANSCRIPT_TIMEOUT_MS = 20_000;

/**
 * Everything this cost center is allowed to do, declared once. Both places that
 * transcribe (the recording arriving, and opening one that never got words)
 * hand this to `runAiFeature`, so neither can spend without the opt-in, the
 * cap, the alert and the timeout.
 */
export const VOICEMAIL_TRANSCRIPT_FEATURE_SPEC: AiFeatureSpec = {
  key: VOICEMAIL_TRANSCRIPT_FEATURE,
  label: "voicemail transcript",
  cap: VOICEMAIL_TRANSCRIPT_MONTHLY_CAP,
  unitCostCents: AI_UNIT_COST_CENTS.voicemail_transcript,
  alertThreshold: VOICEMAIL_TRANSCRIPT_ALERT_THRESHOLD,
  stops:
    "new voicemails are still recorded and playable, just not transcribed.",
  timeoutMs: VOICEMAIL_TRANSCRIPT_TIMEOUT_MS,
  enabled: (settings) => settings.transcribe_voicemail,
  outcomes: {
    // ONE observable outcome, and #431 names it: "played the audio anyway".
    //
    // The positive case — read the words and moved on — is a person NOT doing
    // something. No client can see that without inferring it from unmount and
    // scroll timing, and on a list-based screen a row disposes when you scroll
    // past it, which would count "scrolled by" as "read and satisfied". Three
    // platforms guessing differently would make the number worse than absent.
    //
    // So this row reports how many transcripts failed to save a listen, against
    // `used` (how many were produced), and states no positive count it cannot
    // observe. There is also no editing a transcript.
    used: null,
    edited: null,
    discarded: "listened anyway",
  },
};

/**
 * Longest transcript we store. Whisper on a 5-minute recording lands far under
 * this; the ceiling stops a degenerate output from bloating every read of the
 * calls list, which embeds the transcript.
 */
export const VOICEMAIL_TRANSCRIPT_MAX_CHARS = 4000;

/**
 * Is this recording worth transcribing at all? Length is the only gate: an
 * empty or absurdly long recording spends money for nothing.
 */
export function shouldTranscribe(seconds: number): boolean {
  return seconds > 0 && seconds <= VOICEMAIL_TRANSCRIPT_MAX_SECONDS;
}

/**
 * The turbo model's input: base64 audio and nothing else.
 *
 * Deliberately minimal. This call is wrapped so it can never break the
 * voicemail, which also means a rejected input body is indistinguishable from a
 * bad transcription — every optional knob is one more way to get nothing back,
 * so we send the documented minimum.
 */
export function transcriptInput(audioBase64: string): Record<string, unknown> {
  return { audio: audioBase64 };
}

/** The fallback model's input: the raw bytes as an array of numbers. */
export function fallbackTranscriptInput(audio: ArrayBuffer): Record<string, unknown> {
  return { audio: [...new Uint8Array(audio)] };
}

/**
 * Pull the text out of whatever envelope the binding hands back. Deliberately
 * generous: assuming a single shape turns an unrecognised envelope into a
 * silent empty result that looks like a parser bug.
 */
export function transcriptText(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Record<string, unknown>;
  for (const key of ["text", "transcription", "output_text"]) {
    const value = bag[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  // Some bindings wrap the payload one level deeper.
  if (bag.result && typeof bag.result === "object") {
    return transcriptText(bag.result);
  }
  return null;
}

/**
 * The transcript we are willing to store: collapsed whitespace, trimmed, and
 * length-capped. Returns null for anything that carries no words, so "no
 * transcript" and "an empty transcript" are the same state downstream rather
 * than an empty bubble under the player.
 */
export function sanitizeTranscript(raw: unknown): string | null {
  const text = transcriptText(raw);
  if (text === null) return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  // A transcript of silence: Whisper emits filler like "you" or "." for a
  // recording with no speech in it. One word of punctuation is not a message.
  if (collapsed.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return null;
  return collapsed.length > VOICEMAIL_TRANSCRIPT_MAX_CHARS
    ? `${collapsed.slice(0, VOICEMAIL_TRANSCRIPT_MAX_CHARS - 1).trimEnd()}…`
    : collapsed;
}
