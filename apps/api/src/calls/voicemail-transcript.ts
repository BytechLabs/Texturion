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

/** Workers AI speech-to-text. $0.00045 per audio minute at the time of writing. */
export const VOICEMAIL_TRANSCRIPT_MODEL = "@cf/openai/whisper";

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
 * Pull the text out of whatever envelope the binding hands back.
 *
 * Deliberately generous, and for a reason we already paid for once: the reply
 * drafting feature shipped reading exactly one envelope shape, the binding
 * returned a different one in production, and every draft came back empty with
 * the parser blamed. Read several shapes rather than assume one.
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
