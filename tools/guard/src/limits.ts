/**
 * Every number the guard enforces, in one place (docs/RIG.md). Raising one
 * is a guard deploy, which is the point: the rig's spend and reach change
 * only through a reviewed commit.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The guard's own cap. At the Paid level, 25% of 10 an hour is 2.5, so this
 * never rises on that route.
 */
export const DIALS_PER_DAY = 18;
export const DIALS_PER_HOUR = 3;

/**
 * The Paid row of Telnyx's account levels (developers.telnyx.com, checked
 * 2026-10-29): 5 concurrent calls across all connection types, and 10
 * outbound calls an hour and 100 a day across the whole account, production's
 * included. No API reports the account's level, so these are assumed: the
 * level evidence caps the limit at PAID_CONCURRENT, and the account-wide
 * rate rule counts production's measured peak against the other two.
 */
export const PAID_CONCURRENT = 5;
export const PAID_DIALS_PER_HOUR = 10;
export const PAID_DIALS_PER_DAY = 100;

/** Concurrency evidence older than this lapses, and the floor applies again. */
export const LIMIT_EVIDENCE_STALE_MS = 35 * DAY;
/** The validation check runs again once its last result is this old. */
export const LIMIT_PROBE_INTERVAL_MS = 30 * DAY;
/** Written first: a limit no account has, so only a profile check that is enforced refuses it. */
export const LIMIT_PROBE_ABSURD = 9999;
/** The search's whole budget of profile writes, the reset to 1 included. */
export const LIMIT_PROBE_MAX_WRITES = 16;
/** Telnyx answers 429 (code 10011) to a quick run of requests, so each write waits. */
export const LIMIT_PROBE_PAUSE_MS = 1_500;
/** Waits before each retry of a write that got a 429; a write that still gets one after the last is given up. */
export const LIMIT_PROBE_RETRY_MS = [2_000, 5_000, 10_000, 20_000] as const;
/** Production's peak hour and day of outbound legs, read daily. */
export const ACCOUNT_RATE_STALE_MS = 36 * HOUR;
/** About 300 texts a month; the day cap keeps one bad loop from spending the month. */
export const TEXTS_PER_DAY = 20;
export const TEXTS_PER_MONTH = 300;

export const RESEND_PER_DAY = 10;
export const FCM_PER_DAY = 300;
export const AI_NEURONS_PER_DAY = 2_000;
/** The app creates one per member device and deletes it on sign-out. */
export const CREDENTIALS_PER_DAY = 50;

export const SEARCH_INTERVAL_MS = 10 * 1000;
/** Searches one lease may make, at least this far apart: enough for the wizard's picker to switch country and retry. */
export const SEARCH_PER_LEASE = 12;
export const LEASE_SEARCH_SPACING_MS = 1_000;
export const ORDER_INTERVAL_MS = 25 * DAY;
export const MAX_NUMBERS_HELD = 10;
/** How long a complete first order's number may stay unlisted before ordering stops: Telnyx can list a new number late. */
export const NUMBER_LISTING_GRACE_MS = 30 * MINUTE;

/** All-in, rentals included. */
export const MONTHLY_CAP_USD = 35;
/** Kept inside the cap for month-end surcharges and detached numbers' charges, which the ledger never sees. */
export const SET_ASIDE_USD = 1.5;
export const BALANCE_FLOOR_MIN_USD = 30;
export const BALANCE_FLOOR_DAYS = 14;
export const BALANCE_CACHE_MS = 10 * MINUTE;
/** Amber once this share of the month's usage budget is spent. */
export const AMBER_SHARE = 0.8;

/**
 * Conservative per-action charges in USD, from the rate sheet checked
 * 2026-10-29. A dial is a 60-second-billed leg plus the Voice API fee,
 * rounded up to cover recording and beep detection. A text part is $0.0025
 * on both ends, because both ends are ours, plus the Canadian carrier fee on
 * both ends at its highest published $0.008845, rounded up. A number costs its one-time fee when ordered and a rental for
 * every month it is held at any point.
 */
export const COST_USD = {
  dial: 0.03,
  transfer: 0.13,
  textPart: 0.0227,
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
/** Below this many calls in the window a share means nothing, and the surcharge is a few cents. */
export const MIN_RATIO_SAMPLE = 30;
/** A connected call this short or shorter is a short call to Telnyx's surcharge. */
export const SHORT_CALL_SECONDS = 6;
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

/** The lease scenarios a number order (S28, dropped from the rig's runs) and the robot mailbox need. */
export const NUMBER_SCENARIO = "S28";
export const MAILBOX_SCENARIO = "S34";
/** The lease scenarios that may search for numbers: S32's onboarding picker searches and never orders. */
export const SEARCH_SCENARIOS: readonly string[] = ["S32"];

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
