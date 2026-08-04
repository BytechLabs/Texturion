/**
 * #309 — "Call me and I'll record it".
 *
 * The last path in the issue's Scope: a greeting recorded over the phone
 * rather than in the app, for the owners least likely to hold a handset at
 * arm's length and grant a microphone permission.
 *
 * ## Why this rings the owner instead of the owner ringing us
 *
 * Scope words it as "call a number, record, hang up". This inverts it: one tap
 * in the app dials the owner's mobile, they speak after the beep and hang up.
 * Three reasons, and the first is the one that decides it.
 *
 * - **An inbound record-this number is a number anyone can call.** Identifying
 *   the workspace by caller ID means a spoofed caller ID rewrites a business's
 *   greeting — the most customer-visible string we hold. Every mitigation (a
 *   PIN, a number per workspace) rebuilds the authentication the app session
 *   already performed.
 * - **It carries no standing surface and costs less.** An outbound leg exists
 *   for the seconds it is used; an inbound number is provisioned, billed, and
 *   reachable forever.
 * - **It still answers the issue's reason.** What those owners will not do is
 *   RECORD in an app. Answering a call and talking is precisely what they are
 *   comfortable with, and the tap that starts it is the one they already use to
 *   open the settings screen.
 *
 * If the intent was a path that needs no app at all, the inbound number is the
 * only shape that satisfies it and this is the wrong build — flagged on the
 * issue before writing it.
 *
 * ## The call, end to end
 *
 *   POST /v1/voicemail-greetings/capture-call  → dial the owner, tagged below
 *   call.answered                              → speak the prompt
 *   call.speak.ended                           → record_start (beep, 2 min cap)
 *   call.recording.saved                       → store the audio, insert the
 *                                                row, hang up the leg
 *
 * There is deliberately no second `speak` after the recording lands. One would
 * be nicer ("Saved.") and it is exactly how this grows a loop: that
 * confirmation ends with its own `call.speak.ended`, which is the event that
 * starts a recording. The owner's confirmation is the greeting appearing in
 * the app they started the call from.
 */
import type { Env } from "../env";

/**
 * client_state on a greeting-capture leg:
 * `vgc|<sig>|<companyId>|<expiresAtMs>|<name>`, base64.
 *
 * The name rides the tag rather than a database row because the call IS the
 * whole transaction: nothing is written until the recording lands, so a call
 * the owner abandons leaves nothing to clean up. It takes the remainder of the
 * string for the same reason the inbound-ring tags put their pipe-risky field
 * last — a greeting called "After hours | holidays" must not shift the parse.
 *
 * ## Why the tag is SIGNED
 *
 * Every other leg this server dials goes to a Telnyx credential URI, which is
 * what `outbound-leg-gate.ts` keys the whole outgoing-leg defense on: a leg
 * dialed to a phone number cannot be one of ours, whatever its client_state
 * says, because a member holding a WebRTC token controls their own tag. This
 * leg breaks that rule — it is dialed to a PSTN number by design — so the tag
 * has to carry its own authorization or the gate cannot safely let it past.
 *
 * Unsigned, `vgc|<companyId>|<name>` would be worth forging twice over. It
 * would buy an outgoing PSTN call to any number, uncapped and unattributed;
 * and because every write downstream is scoped by the company id IN THE TAG,
 * it would let a member of one workspace overwrite the voicemail greeting of
 * another — the most customer-visible string we hold, which is the exact
 * damage #309 exists to prevent, delivered by the feature meant to prevent it.
 *
 * The key is DERIVED from the Supabase service key rather than being it: one
 * purpose, one key, and a signature that is never also a credential. There is
 * no new secret to provision, which matters because an unset secret would fail
 * this open at exactly the wrong moment.
 *
 * Residual, stated rather than hidden: a signature is not single-use, so a tag
 * that LEAKED could be replayed until it expires. Nothing hands one to a
 * client — it exists only in our dial command and in Telnyx's echo of it — and
 * the five-minute window is the bound. A nonce table would close it completely
 * at the cost of a row per abandoned call and a sweeper to remove them; that
 * trade is not worth making for a value no client is ever given.
 */
export const GREETING_CAPTURE_STATE = "vgc";

/**
 * How long a capture tag is good for. Long enough to ring for 45 seconds and
 * hold a two-minute recording with room to spare; short enough that a leaked
 * tag is worth nothing by the time anybody could use it.
 */
export const GREETING_CAPTURE_TAG_TTL_MS = 5 * 60_000;

/** 128 bits of tag, hex. A full SHA-256 doubles the client_state for security
 *  nobody can use — forging 2^128 is not a threat model, it is arithmetic. */
const SIG_BYTES = 16;

/** Matches the `voicemail_greetings.name` column and the upload route. */
export const GREETING_NAME_MAX_CHARS = 60;

export interface GreetingCaptureTag {
  companyId: string;
  name: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The signing key: HMAC-SHA256 of a fixed purpose string under the service
 * key. Purpose-separated, so this signature can never be mistaken for — or
 * used as — the credential it descends from.
 */
async function tagKey(env: Env): Promise<CryptoKey> {
  const root = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SUPABASE_SECRET_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign(
    "HMAC",
    root,
    new TextEncoder().encode("jobtext:greeting-capture-tag:v1"),
  );
  return crypto.subtle.importKey(
    "raw",
    derived,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** What is signed. Never the whole tag string: the signature sits inside it. */
function signedPayload(
  companyId: string,
  expiresAtMs: number,
  name: string,
): string {
  return `${GREETING_CAPTURE_STATE}|${companyId}|${expiresAtMs}|${name}`;
}

async function sign(
  env: Env,
  companyId: string,
  expiresAtMs: number,
  name: string,
): Promise<string> {
  const mac = await crypto.subtle.sign(
    "HMAC",
    await tagKey(env),
    new TextEncoder().encode(signedPayload(companyId, expiresAtMs, name)),
  );
  return toHex(mac.slice(0, SIG_BYTES));
}

/**
 * Length-independent comparison. Both operands are fixed-width hex, so the
 * length check leaks nothing an attacker does not already know.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function buildGreetingCaptureState(
  env: Env,
  companyId: string,
  name: string,
  nowMs: number,
): Promise<string> {
  const expiresAtMs = nowMs + GREETING_CAPTURE_TAG_TTL_MS;
  const sig = await sign(env, companyId, expiresAtMs, name);
  return btoa(
    `${GREETING_CAPTURE_STATE}|${sig}|${companyId}|${expiresAtMs}|${name}`,
  );
}

/**
 * Parse and VERIFY a greeting-capture tag, or null for anything else.
 *
 * Null on ANY doubt. An unrecognised tag has to fall through to the ordinary
 * routing rules — where the outgoing-leg gate hangs up a PSTN leg nobody
 * authorized — rather than being treated as a capture leg on the strength of a
 * prefix somebody could type.
 */
export async function parseGreetingCaptureState(
  env: Env,
  clientState: string | null | undefined,
  nowMs: number,
): Promise<GreetingCaptureTag | null> {
  if (!clientState) return null;
  let decoded: string;
  try {
    decoded = atob(clientState);
  } catch {
    return null;
  }
  const [prefix, sig, companyId, expiry, ...rest] = decoded.split("|");
  if (prefix !== GREETING_CAPTURE_STATE) return null;
  if (!sig || !companyId || !UUID.test(companyId)) return null;

  const expiresAtMs = Number(expiry);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) return null;
  // A tag valid for longer than one could ever have been ISSUED for is a tag
  // whose expiry somebody else chose. Signed, so this is belt and braces — but
  // it costs one comparison and removes the case where a key leak becomes a
  // permanent credential rather than a five-minute one.
  if (expiresAtMs > nowMs + GREETING_CAPTURE_TAG_TTL_MS) return null;

  const rawName = rest.join("|");
  const name = rawName.trim();
  // Checked HERE rather than at the insert, where the call has already
  // happened and the owner has already spoken.
  if (!name || name.length > GREETING_NAME_MAX_CHARS) return null;

  // Verified against the name as ISSUED, not as trimmed: signing one string
  // and checking another is how a signature stops covering the value it exists
  // to protect.
  const expected = await sign(env, companyId, expiresAtMs, rawName);
  if (!constantTimeEquals(expected, sig)) return null;

  return { companyId, name };
}

/**
 * What the owner hears when they pick up.
 *
 * Their own company name, because the first second of an unexpected call is
 * spent deciding whether it is a robocall — and this one, ironically, IS a
 * synthetic voice ringing them out of the blue. Naming the business and the
 * reason in the first breath is the whole difference.
 *
 * The name is owner-authored, so it is stripped and bounded the same way the
 * greeting itself is before it reaches a speak command.
 */
export function greetingCapturePrompt(companyName: string): string {
  const cleaned = (companyName ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
  const business = cleaned ? cleaned.slice(0, 120) : "your business";
  return (
    `This is a greeting recording call for ${business}. ` +
    `After the beep, say what you'd like your callers to hear when nobody can pick up. ` +
    `When you're finished, just hang up and it'll be saved.`
  );
}

/** How long the owner's phone rings before we give up. Matches the member-ring
 *  window: past 45 seconds nobody is coming. */
export const GREETING_CAPTURE_RING_SECS = 45;

/**
 * Whole-leg ceiling, cost side. The recording is capped at two minutes; this
 * bounds what that cap cannot — a leg that answers and then does nothing (a
 * voicemail box picking up, a phone left face-down on a table).
 */
export const GREETING_CAPTURE_TIME_LIMIT_SECS = 300;

/** Recording cap, matching `voicemail_greetings.duration_ms`'s own ceiling. */
export const GREETING_CAPTURE_MAX_SECONDS = 120;

/**
 * Silence that ends the recording, for the owner who finishes speaking and
 * waits instead of hanging up. Ten seconds is past any pause inside a greeting
 * and well short of the leg ceiling.
 */
export const GREETING_CAPTURE_SILENCE_SECS = 10;

/** Under two seconds is a hangup on the beep, not a greeting. The same line
 *  the voicemail store draws, for the same reason. */
export const GREETING_CAPTURE_MIN_SECONDS = 2;

/**
 * Per-company capture calls per day.
 *
 * Every other outbound cost centre is bounded by the voice cap, which counts
 * SECONDS off the `calls` table — and a capture leg writes no calls row, so it
 * accrues nothing there and that cap can never see it. This is this leg's own
 * ceiling. Four greetings with a couple of retries each is a real day's work
 * and fits inside it; a client stuck in a loop stops at ten dials, worst case
 * ten times the five-minute leg ceiling.
 */
export const GREETING_CAPTURE_DAILY_CAP = 10;

/** The audit action whose rows ARE the daily count. */
export const GREETING_CAPTURE_AUDIT_ACTION = "voicemail_greeting.capture_call";
