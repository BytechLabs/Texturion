/**
 * Every number the guard enforces, in one place (docs/RIG.md). Raising one
 * is a guard deploy, which is the point: the rig's spend and reach change
 * only through a reviewed commit.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The default dial cap, until Telnyx states the account's limits in writing. */
export const DIALS_PER_DAY = 18;
export const DIALS_PER_HOUR = 3;
/** About 300 texts a month; the day cap keeps one bad loop from spending the month. */
export const TEXTS_PER_DAY = 20;
export const TEXTS_PER_MONTH = 300;

export const RESEND_PER_DAY = 10;
export const FCM_PER_DAY = 300;
export const AI_NEURONS_PER_DAY = 2_000;
/** The app creates one per member device and deletes it on sign-out. */
export const CREDENTIALS_PER_DAY = 50;

export const SEARCH_INTERVAL_MS = 10 * 1000;
export const ORDER_INTERVAL_MS = 25 * DAY;
export const MAX_NUMBERS_HELD = 10;

/** All-in, rentals included. */
export const MONTHLY_CAP_USD = 35;
export const BALANCE_FLOOR_MIN_USD = 100;
export const BALANCE_FLOOR_DAYS = 14;
export const BALANCE_ALERT_USD = 150;
export const BALANCE_CACHE_MS = 10 * MINUTE;
/** Amber once this share of the month's usage budget is spent. */
export const AMBER_SHARE = 0.8;

/**
 * Conservative per-action charges in USD, from the rate sheet checked
 * 2026-10-29. A dial is a 60-second-billed leg plus the Voice API fee,
 * rounded up to cover recording and beep detection. A text part is billed on
 * both ends, because both ends are ours, plus the unconfirmed Canadian
 * carrier fee. A number costs its one-time fee when ordered and a rental for
 * every month it is held at any point.
 */
export const COST_USD = {
  dial: 0.03,
  transfer: 0.13,
  textPart: 0.0226,
  numberUpfront: 1.0,
  numberRental: 1.1,
  callerNameLookup: 0.4,
} as const;

/** The default until production's call history says otherwise. */
export const WINDOW_DEFAULT_START_HOUR = 4;
export const WINDOW_HOURS = 6;
/** guard.yml measures the window again once it is this old, leaving a week of daily retries. */
export const WINDOW_RECHECK_MS = 28 * DAY;
/** A measured window is rechecked monthly; older than this, the default applies. */
export const WINDOW_STALE_MS = 35 * DAY;
/** The production call history a window is chosen from. */
export const WINDOW_HISTORY_DAYS = 28;

/** Over the whole account, production's calls included. */
export const MAX_ABANDONED_SHARE = 0.15;
export const MAX_SHORT_SHARE = 0.1;
export const RATIOS_STALE_MS = 36 * HOUR;
/** Production's reserve is read daily; a missed day leaves no room at all. */
export const RESERVE_STALE_MS = 36 * HOUR;

export const SIGNAL_HALT_MS = 7 * DAY;
export const SIGNAL_REPEAT_WINDOW_MS = 30 * DAY;

export const MAIL_HEARTBEAT_FRESH_MS = 20 * MINUTE;
export const MAIL_ARRIVAL_DEADLINE_MS = 10 * MINUTE;

/** The start-up checks are repeated on a new deployment and at least this often. */
export const SAFETY_RECHECK_MS = 6 * HOUR;
export const PRODUCTION_HEALTH_CACHE_MS = 10 * MINUTE;

/** How often production's active calls are polled while a lease is live. */
export const PREEMPT_POLL_MS = 2 * 1000;
/** A registered leg older than this is not counted as live without asking Telnyx. */
export const LIVE_LEG_HORIZON_MS = HOUR;

/**
 * The scenarios amber still admits. The design names the tier "core only"
 * without listing the core, so this is the guard's reading: the isolation
 * proof, one call each way in the browser, voicemail, a text each way, and
 * the Android wake test.
 */
export const CORE_SCENARIOS: readonly string[] = ["G01", "S01", "S02", "S04", "S20", "S21", "D02"];

/** The lease scenarios that unlock a number search and order, and the robot mailbox. */
export const NUMBER_SCENARIO = "S28";
export const MAILBOX_SCENARIO = "S34";

/** The models the app calls; keep in step with apps/api/src/billing/workers-ai-prices.ts. */
export const AI_MODELS: Readonly<Record<string, AiModelRate>> = {
  "@cf/meta/llama-3.1-8b-instruct-fast": { kind: "text", inPerMillion: 4_091, outPerMillion: 34_910 },
  "@cf/meta/llama-3.2-1b-instruct": { kind: "text", inPerMillion: 2_455, outPerMillion: 18_273 },
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
export const AI_AUDIO_BYTES_PER_SECOND = 2_000;

export const FCM_NONPROD_PACKAGE = "com.loonext.android.nonprod";

export const PRODUCTION_API_ORIGIN = "https://api.loonext.com";
/** Keep equal to TELNYX_PARTITION_CAPABILITY in apps/api/src/telnyx/ownership.ts. */
export const PARTITION_CAPABILITY = "telnyx-partition-v1";
