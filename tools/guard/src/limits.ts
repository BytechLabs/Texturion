const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long a complete first order's number may stay unlisted before ordering stops: Telnyx can list a new number late. */
export const NUMBER_LISTING_GRACE_MS = 30 * MINUTE;

export const BALANCE_CACHE_MS = 10 * MINUTE;
export const SIGNAL_REPEAT_WINDOW_MS = 30 * DAY;

export const MAIL_HEARTBEAT_FRESH_MS = 20 * MINUTE;

/** The start-up checks are repeated on a new deployment and at least this often. */
export const SAFETY_RECHECK_MS = 6 * HOUR;
export const PRODUCTION_HEALTH_CACHE_MS = 10 * MINUTE;

/** A registered leg older than this is not counted as live without asking Telnyx. */
export const LIVE_LEG_HORIZON_MS = HOUR;

/** The lease scenarios a number order (S28, dropped from the rig's runs) and the robot mailbox need. */
export const NUMBER_SCENARIO = "S28";
export const MAILBOX_SCENARIO = "S34";
/** The lease scenarios that may search for numbers: S32's onboarding picker searches and never orders. */
export const SEARCH_SCENARIOS: readonly string[] = ["S32"];

/** The models the app calls; keep in step with apps/api/src/billing/workers-ai-prices.ts. */
export const AI_MODELS: Readonly<Record<string, AiModelRate>> = {
  "@cf/meta/llama-3.1-8b-instruct-fast": { kind: "text", inPerMillion: 4091, outPerMillion: 34_910 },
  "@cf/meta/llama-3.2-1b-instruct": { kind: "text", inPerMillion: 2455, outPerMillion: 18_273 },
  "@cf/openai/whisper-large-v3-turbo": { kind: "audio", perMinute: 46 },
  // Unpriced in the app's table; billed here at the turbo model's rate.
  "@cf/openai/whisper": { kind: "audio", perMinute: 46 },
};

/**
 * Neurons, derived from the app's audited USD rates at $0.011 per 1,000
 * neurons (developers.cloudflare.com/workers-ai/platform/pricing).
 */
export type AiModelRate =
  | { kind: "text"; inPerMillion: number; outPerMillion: number }
  | { kind: "audio"; perMinute: number };

/** Workers AI's default when a request names no `max_tokens`. */
export const AI_DEFAULT_MAX_TOKENS = 256;
/** Low on purpose, so the estimate runs high. */
export const AI_CHARS_PER_TOKEN = 3;
/** Low on purpose (16 kbit/s), so audio minutes run high. */
export const AI_AUDIO_BYTES_PER_SECOND = 2000;

export const FCM_NONPROD_PACKAGE = "com.loonext.android.nonprod";

export const PRODUCTION_API_ORIGIN = "https://api.loonext.com";
/** Keep equal to TELNYX_PARTITION_CAPABILITY in apps/api/src/telnyx/ownership.ts. */
export const PARTITION_CAPABILITY = "telnyx-partition-v1";
