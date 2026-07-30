/**
 * #312 — PUBLIC endpoints for the prospects who leave.
 *
 *   POST /marketing/comparison   capture a consent and send the comparison
 *   POST /marketing/unsubscribe  one click, by token, no account
 *
 * A visitor who reads a comparison page and closes the tab was invisible: no
 * account, no email, no signal, no way to follow up. Everything else #312 asked
 * for turned out to be shipped already — the 30-day money-back guarantee is the
 * trial, and the contact form already lets somebody raise their hand. This is the
 * part that was genuinely missing.
 *
 * ---------------------------------------------------------------------------
 * THE ABUSE POSTURE IS THE CONTACT FORM'S, deliberately unchanged in shape:
 *
 *   1. HONEYPOT — a `website` field humans never see. A bot that fills it gets
 *      the normal 201 and nothing happens, so it never learns it was dropped.
 *   2. RATE — VERIFY_RATE_LIMITER keyed on the edge IP. Absent binding (local
 *      dev, tests) → skipped, exactly like every other use.
 *   3. CAPTCHA — Turnstile when TURNSTILE_SECRET_KEY is configured.
 *   4. DAILY CAP — enforced inside `api_claim_marketing_contact`, global rather
 *      than per-address, because a bot army uses a different address every time
 *      and the thing being protected is our Resend bill.
 *
 * ITS OWN CAP, NOT THE CONTACT FORM'S. Sharing `POST /contact` would have let a
 * capture run down the 20/day ceiling that protects the founder's actual support
 * channel — a marketing convenience crowding out a customer trying to get help.
 *
 * ---------------------------------------------------------------------------
 * UNSUBSCRIBE IS UNAUTHENTICATED AND MUST STAY THAT WAY. The token in the email
 * is the whole credential, one click, no confirmation step and no login. An
 * unsubscribe that asks somebody to prove who they are is an unsubscribe that
 * fails, and this is the one place a destructive-looking action should be
 * immediate: the entire point is that it costs the person nothing.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import {
  MARKETING_CONSENT_TEXT,
  MARKETING_DAILY_CAP,
  sendComparisonEmail,
} from "../marketing/comparison-email";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const captureSchema = z.object({
  email: z.email().max(254),
  /**
   * Which surface the consent was given on. A closed set rather than free text:
   * it is stored on the consent row so a complaint can be traced back to a page,
   * and an open string would let the client write anything into our record of
   * what somebody agreed to.
   */
  source: z.enum(["compare_page", "pricing_page"]),
  /** Honeypot — rendered invisibly by the form; humans never fill it. */
  website: z.string().max(400).optional(),
  turnstileToken: z.string().min(1).max(4096).optional(),
});

const unsubscribeSchema = z.object({ token: z.uuid() });

export const marketingRoutes = new Hono<AppEnv>();

// Same exact-origin CORS as /contact, and for the same reason: these are called
// from the MARKETING origin, which under the D27 host split is a different origin
// from the app. Never a wildcard.
marketingRoutes.use(
  "/marketing/*",
  cors({
    origin: (origin, c) => {
      const env = getEnv(c.env);
      return origin === env.APP_ORIGIN ||
        (env.SITE_ORIGIN !== undefined && origin === env.SITE_ORIGIN)
        ? origin
        : null;
    },
    allowMethods: ["POST"],
    allowHeaders: ["Content-Type"],
  }),
);

/** Shared by both routes: parse JSON, or null so the caller can say so plainly. */
async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

marketingRoutes.post("/marketing/comparison", async (c) => {
  const env = getEnv(c.env);

  const raw = await readJson(c.req.raw);
  if (raw === null) return errorResponse(c, "validation_failed", "Body must be JSON.");
  const parsed = captureSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))];
    return errorResponse(c, "validation_failed", `Invalid request: ${fields.join(", ")}.`);
  }
  const body = parsed.data;

  // 1. HONEYPOT: filled → pretend success, do nothing. An error would teach the
  // bot which field to skip.
  if (body.website !== undefined && body.website.trim() !== "") {
    return c.json({ ok: true }, 201);
  }

  // 2. RATE, per IP.
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (env.VERIFY_RATE_LIMITER) {
    const { success } = await env.VERIFY_RATE_LIMITER.limit({
      key: `marketing:${ip}`,
    });
    if (!success) {
      return errorResponse(c, "rate_limited", "Too many requests. Try again shortly.");
    }
  }

  // 3. CAPTCHA, when configured.
  if (env.TURNSTILE_SECRET_KEY) {
    if (!body.turnstileToken) {
      return errorResponse(c, "validation_failed", "Captcha token is required.");
    }
    const verify = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: body.turnstileToken,
        remoteip: ip === "unknown" ? undefined : ip,
      }),
    });
    const outcome = (await verify.json().catch(() => ({}))) as { success?: boolean };
    if (outcome.success !== true) {
      return errorResponse(c, "validation_failed", "Captcha verification failed.");
    }
  }

  // 4. CLAIM: cap, complaint check and the consent record, in one statement.
  const db = getDb(env);
  const { data, error } = await db.rpc("api_claim_marketing_contact", {
    p_email: body.email,
    p_source: body.source,
    // Stored from the SERVER's constant, never from the request. The record of
    // what somebody agreed to must be the words we actually showed, and a client
    // that could send its own consent text could record any agreement it liked.
    p_consent_text: MARKETING_CONSENT_TEXT,
    p_cap: MARKETING_DAILY_CAP,
  });
  if (error) {
    return errorResponse(c, "service_unavailable", "Could not record that right now.");
  }

  const claim = (data ?? {}) as { ok?: boolean; reason?: string };
  if (claim.ok !== true) {
    if (claim.reason === "daily_cap") {
      return errorResponse(c, "rate_limited", "Too many requests today. Try tomorrow.");
    }
    // `suppressed` (a previous spam complaint) and any validation failure both
    // land here as a plain 201. A complaint must not be reversed by a form, and
    // telling the submitter which of the two happened would confirm to anybody
    // that a given address had complained about us.
    return c.json({ ok: true }, 201);
  }

  // The send is separate from the claim, and its failure is not the claim's.
  // Their consent is recorded either way, which is the part that must not be lost.
  let sent = false;
  try {
    const result = await sendComparisonEmail(env, db, body.email);
    sent = result.sent;
  } catch (cause) {
    console.error(`marketing comparison send failed: ${String(cause)}`);
  }

  // `sent` is reported honestly so the form can say "check your email" only when
  // there is something to check. With MARKETING_POSTAL_ADDRESS unset the consent
  // is stored and nothing is sent, and the UI must not claim otherwise.
  return c.json({ ok: true, sent }, 201);
});

marketingRoutes.post("/marketing/unsubscribe", async (c) => {
  const env = getEnv(c.env);

  const raw = await readJson(c.req.raw);
  if (raw === null) return errorResponse(c, "validation_failed", "Body must be JSON.");
  const parsed = unsubscribeSchema.safeParse(raw);
  if (!parsed.success) {
    // A malformed token cannot be acted on, and there is nothing the person
    // clicking can do about it — so this is the one case that says so, rather
    // than reporting a success that did not happen.
    return errorResponse(c, "validation_failed", "That unsubscribe link is not valid.");
  }

  // No rate limit and no captcha, deliberately. The token is unguessable, the
  // action is idempotent, and the worst a flood achieves is unsubscribing
  // somebody who is already unsubscribed. A captcha here would make a mail
  // client's one-click unsubscribe impossible, which is the opposite of the goal.
  const { data, error } = await getDb(env).rpc("api_marketing_unsubscribe", {
    p_token: parsed.data.token,
  });
  if (error) {
    return errorResponse(c, "service_unavailable", "Could not unsubscribe you right now.");
  }

  const result = (data ?? {}) as { ok?: boolean; known?: boolean };
  // An unknown token reports success: the person cannot fix it, and "invalid
  // token" reads as "you are still subscribed", which is the opposite of what
  // they need to hear.
  return c.json({ ok: true, known: result.known === true });
});
