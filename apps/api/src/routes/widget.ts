/**
 * #232 / D124 — the "Text us" widget's server intake.
 *
 * A public write endpoint, embedded on OTHER PEOPLE'S websites, that spends our
 * money per use. The issue's own devil's advocate is the design brief: build it
 * locked down or do not build it. So the layers come first and the feature is
 * what is left over.
 *
 * ## The order, and why each one is where it is
 *
 *   1. HONEYPOT. A `website` field humans never see. A bot that fills it gets
 *      the same answer as everybody else and nothing happens — it never learns
 *      it was dropped.
 *   2. PER-IP RATE. `VERIFY_RATE_LIMITER`, the SPEC §10 idiom, keyed on the
 *      CF-Connecting-IP the edge stamps. The only thing between a script and
 *      unlimited attempts, because there is no account to key on.
 *   3. TURNSTILE, when configured. Server-side siteverify, failing closed.
 *   4. THE SEND GATES. `runPreSendGates` — kill switch, AUP ladder,
 *      subscription, NANP, and the OPT-OUT check. A stranger who once texted
 *      STOP to this workspace's number must not receive a code because they
 *      typed their number into a form.
 *   5. THE BUDGETS. `api_claim_widget_verification`, a guarded claim that
 *      counts TEXTS SENT rather than conversations opened — an abandoned code
 *      still cost a segment.
 *
 * Only then does anything cost money.
 *
 * ## One answer for every refusal
 *
 * Wrong company, closed workspace, capped, throttled, opted out — the visitor
 * is told the same thing. They are standing on a plumber's website and can do
 * nothing with a distinction; a caller who CAN distinguish them has an oracle
 * for which numbers have been targeted and which workspaces exist.
 *
 * The one exception is the rate limit, which says "wait a moment", because that
 * is advice a real person can act on and it reveals only that they themselves
 * pressed the button too often.
 */
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { verifyTurnstile } from "../http/turnstile";
import { runPreSendGates, sendSystemText } from "../messaging/send";

/**
 * How long a code is good for.
 *
 * Ten minutes: long enough for a phone in another room, short enough that a
 * code read over somebody's shoulder is worthless by the time it is used.
 */
export const WIDGET_CODE_TTL_SECONDS = 600;

/**
 * How many codes one workspace's widget may send in a day.
 *
 * The cost ceiling, and it counts TEXTS rather than conversations. Fifty is far
 * above what a trades business's website produces and low enough that a bot
 * pointed at one customer's widget costs us a rounding error before it stops.
 */
export const WIDGET_CODES_PER_COMPANY_PER_DAY = 50;

/**
 * How many codes one NUMBER may receive in a day, across every workspace.
 *
 * Spans companies deliberately. Without it, the widget is a way to text one
 * person once per workspace, and the whole platform becomes the amplifier.
 */
export const WIDGET_CODES_PER_NUMBER_PER_DAY = 5;

/** The ordinary "I didn't get it" press, bounded. */
export const WIDGET_RESEND_SECONDS = 60;

/** Wrong guesses before the code is dead. */
export const WIDGET_MAX_ATTEMPTS = 5;

const startSchema = z.object({
  /**
   * The embed's own key, NOT a workspace id.
   *
   * `auth/company.test.ts` refuses a company id read off a request body, and it
   * is right about more than the rule: an internal identifier published in
   * every customer's page source cannot be rotated when it is abused, because
   * it IS the workspace. A key is public by design, grants nothing on its own,
   * and an owner can replace it.
   */
  widgetKey: z.uuid(),
  /** As typed by the visitor; normalised below before anything is stored. */
  phone: z.string().trim().min(7).max(20),
  /** Honeypot — rendered invisibly by the widget; humans never fill it. */
  website: z.string().max(400).optional(),
  turnstileToken: z.string().min(1).max(4096).optional(),
});

export type WidgetStartBody = z.infer<typeof startSchema>;

/**
 * E.164, or null.
 *
 * Deliberately strict and deliberately NOT a parser for every format on earth:
 * a widget sends a number a person typed into one field, and the answer to
 * "that is not a number we can text" is to say so rather than to guess. Ten
 * digits are assumed North American because the product is US/CA only and the
 * send gates refuse anything else anyway.
 */
export function normaliseVisitorNumber(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  const bare = digits.startsWith("+") ? digits.slice(1) : digits;
  if (!/^\d+$/.test(bare)) return null;
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith("1")) return `+${bare}`;
  if (digits.startsWith("+") && bare.length >= 8 && bare.length <= 15) {
    return `+${bare}`;
  }
  return null;
}

/**
 * The code a visitor reads off their phone.
 *
 * Six digits from `crypto.getRandomValues` rather than `Math.random`: this is
 * the only thing standing between a stranger and somebody else's conversation,
 * and a predictable code is not a code. Leading zeros are kept — a five-digit
 * code that happens to start with one would be a quietly weaker code.
 */
export function mintWidgetCode(): string {
  const buffer = crypto.getRandomValues(new Uint32Array(1));
  return String(buffer[0] % 1_000_000).padStart(6, "0");
}

/**
 * What is stored instead of the code.
 *
 * SHA-256 of the code and the verification's own id, so two visitors who draw
 * the same six digits do not share a hash, and a stolen table cannot be
 * reversed into a working answer with one rainbow table. The id is not secret;
 * it is a salt, and that is all it needs to be.
 */
export async function hashWidgetCode(id: string, code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${id}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** What the visitor is told, whatever went wrong. */
function widgetUnavailable(c: Context<AppEnv>) {
  return errorResponse(
    c,
    "forbidden",
    "We could not text that number right now. Try again later, or call.",
  );
}

export const widgetRoutes = new Hono<AppEnv>();

/**
 * CORS is a WILDCARD here, and that is not an oversight.
 *
 * Every other public route in this API pins the exact origin, because it is
 * called from a page we serve. This one is embedded on customers' own sites —
 * WordPress, Wix, Squarespace, a hand-written page, any of them on a domain we
 * have never heard of. Pinning an origin would mean maintaining a list of our
 * customers' domains, which is a support burden and a new way for a working
 * install to break silently the day somebody moves to a new domain.
 *
 * What makes it safe is that this endpoint grants NOTHING to its caller. It
 * reads no session, returns no data about a workspace, and the only thing it
 * can cause is a text message to a number the caller must then prove they
 * hold — behind five layers, every one of which is server-side.
 */
widgetRoutes.use("/widget/*", cors({ origin: "*", allowMethods: ["POST", "OPTIONS"] }));

widgetRoutes.post("/widget/start", async (c) => {
  const env = getEnv(c.env);
  const parsed = startSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(c, "validation_failed", "Check the number and try again.");
  }
  const body = parsed.data;

  // 1. HONEYPOT. The same answer a real visitor gets, and nothing happens.
  if (body.website !== undefined && body.website !== "") {
    return c.json({ ok: true, verificationId: crypto.randomUUID() }, 202);
  }

  const phone = normaliseVisitorNumber(body.phone);
  if (phone === null) {
    return errorResponse(
      c,
      "validation_failed",
      "That does not look like a mobile number we can text.",
    );
  }

  // 2. PER-IP RATE. Absent binding (local dev, tests) → skipped, exactly like
  // every other use of this limiter.
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (env.VERIFY_RATE_LIMITER) {
    const { success } = await env.VERIFY_RATE_LIMITER.limit({ key: `widget:${ip}` });
    if (!success) {
      return errorResponse(
        c,
        "rate_limited",
        "Too many tries from this connection. Wait a minute and try again.",
      );
    }
  }

  // 3. TURNSTILE, when configured.
  if (env.TURNSTILE_SECRET_KEY !== undefined) {
    if (body.turnstileToken === undefined) {
      return errorResponse(c, "validation_failed", "Captcha token is required.");
    }
    if (!(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, body.turnstileToken, ip))) {
      return errorResponse(c, "forbidden", "Captcha verification failed.");
    }
  }

  const db = getDb(env);

  // The key resolves to a workspace, or to nothing. A closed workspace resolves
  // to nothing too: a widget left embedded on a site outlives the account
  // behind it, and a text sent for a business that no longer exists is the
  // first thing that must not happen.
  const { data: resolved, error: resolveError } = await db.rpc(
    "api_company_for_widget_key",
    { p_key: body.widgetKey },
  );
  if (resolveError) {
    throw new Error(`widget key lookup failed: ${resolveError.message}`);
  }
  const companyId = resolved as string | null;
  if (companyId === null) return widgetUnavailable(c);

  // The number the code is sent FROM. Chosen server-side from the workspace's
  // own numbers — a client-supplied `from` would let anybody send from any
  // number we own.
  const { data: numbers, error: numberError } = await db
    .from("phone_numbers")
    .select("number_e164")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1);
  if (numberError) {
    throw new Error(`widget number lookup failed: ${numberError.message}`);
  }
  const from = (numbers ?? [])[0]?.number_e164 as string | undefined;
  if (from === undefined) return widgetUnavailable(c);

  // 4. THE SEND GATES, including opt-out. Throws an ApiError the error
  // middleware renders; a refusal here is deliberately NOT flattened into the
  // generic answer, because an opted-out number being told "we cannot text you"
  // is the honest outcome and the one the carrier rules require.
  const clearance = await runPreSendGates(env, companyId, phone);

  // 5. THE BUDGETS. Nothing above this line has cost anything.
  const id = crypto.randomUUID();
  const code = mintWidgetCode();
  const { data: claim, error: claimError } = await db.rpc(
    "api_claim_widget_verification",
    {
      p_company_id: companyId,
      p_phone: phone,
      p_code_hash: await hashWidgetCode(id, code),
      p_ip: ip === "unknown" ? null : ip,
      p_ttl_seconds: WIDGET_CODE_TTL_SECONDS,
      p_company_cap: WIDGET_CODES_PER_COMPANY_PER_DAY,
      p_number_cap: WIDGET_CODES_PER_NUMBER_PER_DAY,
      p_resend_seconds: WIDGET_RESEND_SECONDS,
    },
  );
  if (claimError) throw new Error(`widget claim failed: ${claimError.message}`);
  const claimed = claim as { allowed?: boolean; id?: string; reason?: string };
  if (claimed.allowed !== true || claimed.id === undefined) {
    // Every reason, one answer. See the header.
    return widgetUnavailable(c);
  }

  // The hash was computed against a client-side id and the row has its own, so
  // the code is re-hashed against the id that was actually stored. Getting this
  // wrong would make every code wrong — which is why the answer step is tested
  // end to end rather than against a fixture hash.
  const storedHash = await hashWidgetCode(claimed.id, code);
  const { error: rehashError } = await db
    .from("widget_verifications")
    .update({ code_hash: storedHash })
    .eq("id", claimed.id);
  if (rehashError) {
    throw new Error(`widget code hash write failed: ${rehashError.message}`);
  }

  const sent = await sendSystemText(env, {
    from,
    to: phone,
    text:
      `${code} is your code to text this business from their website. ` +
      `It expires in 10 minutes.`,
    clearance,
    idempotencyKey: `widget-code:${claimed.id}`,
  });
  if (!sent.ok) {
    // The row stays. It has already spent its place in the budget, which is the
    // honest accounting: we attempted a text and the carrier refused it, and
    // pretending otherwise would let a failing number be retried without limit.
    console.error(
      `widget code send failed for ${claimed.id}: ${sent.errorCode ?? "unknown"}`,
    );
    return widgetUnavailable(c);
  }

  return c.json({ ok: true, verificationId: claimed.id }, 202);
});
