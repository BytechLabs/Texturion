/**
 * PUBLIC POST /contact — the marketing site's contact form endpoint (replaces
 * the old mailto: link; the form UI lands separately). No JWT: the abuse
 * posture is layered instead, in check order:
 *
 *   1. HONEYPOT — the body carries a `website` field humans never see. A bot
 *      that fills it gets the normal 201 and NOTHING happens (no store, no
 *      email), so it never learns it was dropped.
 *   2. RATE — VERIFY_RATE_LIMITER (3/60s, the SPEC §10 idiom) keyed
 *      `contact:<ip>` on the CF-Connecting-IP the edge stamps. Absent binding
 *      (local dev/tests) → gate skipped, exactly like the other limiter uses.
 *   3. CAPTCHA — when TURNSTILE_SECRET_KEY is configured, the body must carry
 *      a `turnstileToken`, verified server-side against Cloudflare siteverify.
 *      Unset (schema-optional) → layers 1/2/4 only, no token required.
 *   4. DAILY CAP — api_claim_contact_message (guarded-claim: advisory-lock
 *      re-count + insert in one RPC) stores the submission append-only in
 *      contact_messages and enforces a GLOBAL 20/day backstop, so a bot army
 *      can never run up the Resend bill (cost-protection mandate).
 *
 * A claimed submission is forwarded to the support inbox with
 * Reply-To = submitter (support replies land straight in their thread) and
 * acknowledged to the submitter (best-effort: an ack failure never fails a
 * submission that is already stored and forwarded). CORS mirrors the /v1
 * chain: the exact APP_ORIGIN (the marketing site is same-origin with the
 * app), never a wildcard.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { emailLayout, escapeHtml, renderEmailHtml, toHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";

/**
 * Destination inbox for contact submissions. A product constant, not config:
 * https://loonext.com is the canonical domain and support@ is the routed
 * human inbox (docs/deploy/10-email-inbox.md).
 */
export const CONTACT_INBOX = "support@loonext.com";

/**
 * Global daily backstop on stored-and-emailed submissions. 20/day is far
 * above launch-volume contact traffic while capping the worst-case Resend
 * spend of a distributed bot run at 40 emails/day.
 */
export const CONTACT_DAILY_CAP = 20;

/**
 * #303 — the separate daily budget for abuse reports.
 *
 * A SEPARATE COUNTER, not a bigger shared one. The cap exists because each
 * stored row sends two emails and an uncapped public form is a bot army
 * running up the bill — but counting a carrier's abuse report against the same
 * twenty as a sales enquiry means an ordinary Tuesday can silently drop the
 * one message that protects every customer's deliverability.
 *
 * Higher than the general cap because the cost of missing one is asymmetric:
 * a dropped sales enquiry loses a lead, a dropped abuse report loses the
 * sending pool.
 */
export const ABUSE_DAILY_CAP = 100;

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const contactBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  message: z.string().trim().min(10).max(4000),
  company: z.string().trim().max(120).optional(),
  /** Honeypot — rendered invisibly by the form; humans never fill it. */
  website: z.string().max(400).optional(),
  /** Cloudflare Turnstile response token (required iff the secret is set). */
  turnstileToken: z.string().min(1).max(4096).optional(),
  /**
   * #303: what this is. `abuse` is a report about a Loonext number — from a
   * recipient, a carrier, or anybody — and it gets its own daily budget so
   * ordinary traffic can never exhaust the day and drop it.
   *
   * Defaulted rather than required, so every existing caller keeps working
   * and means exactly what it meant before.
   */
  kind: z.enum(["general", "abuse"]).default("general"),
});

type ContactBody = z.infer<typeof contactBodySchema>;

export const contactRoutes = new Hono<AppEnv>();

// Exact-origin CORS, enumerated method/headers, no wildcard (SPEC §7 posture).
// UNLIKE the /v1 chain (called only by the app at APP_ORIGIN), the contact form
// is served from the MARKETING origin. Under the D27 host split that is a
// DIFFERENT origin (loonext.com) than the app (app.loonext.com = APP_ORIGIN),
// so we allow SITE_ORIGIN too or every real submission is CORS-blocked. When
// SITE_ORIGIN is unset (single-host dev/deploy, same-origin) only APP_ORIGIN
// is allowed, which is correct there.
contactRoutes.use(
  "/contact",
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

contactRoutes.post("/contact", async (c) => {
  const env = getEnv(c.env);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return errorResponse(c, "validation_failed", "Body must be JSON.");
  }
  const parsed = contactBodySchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ];
    return errorResponse(
      c,
      "validation_failed",
      `Invalid contact submission: ${fields.join(", ")}.`,
    );
  }
  const body = parsed.data;

  // 1. HONEYPOT: filled → pretend success, do nothing. Returning an error
  // would teach the bot which field to skip.
  if (body.website !== undefined && body.website.trim() !== "") {
    return c.json({ ok: true }, 201);
  }

  // 2. RATE: per-IP, 3/60s (the VERIFY_RATE_LIMITER binding's configured
  // period). CF-Connecting-IP is stamped by the Cloudflare edge on every
  // production request; its absence only happens off-platform (local dev).
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (env.VERIFY_RATE_LIMITER) {
    const { success } = await env.VERIFY_RATE_LIMITER.limit({
      key: `contact:${ip}`,
    });
    if (!success) {
      return errorResponse(
        c,
        "rate_limited",
        "Too many messages from this connection. Wait a minute and try again.",
      );
    }
  }

  // 3. CAPTCHA: only when the secret is configured (silent no-op otherwise).
  if (env.TURNSTILE_SECRET_KEY !== undefined) {
    if (body.turnstileToken === undefined) {
      return errorResponse(
        c,
        "validation_failed",
        "Captcha token is required.",
      );
    }
    const human = await verifyTurnstile(
      env.TURNSTILE_SECRET_KEY,
      body.turnstileToken,
      ip,
    );
    if (!human) {
      return errorResponse(c, "forbidden", "Captcha verification failed.");
    }
  }

  // 4. DAILY CAP + STORE, atomically (guarded-claim RPC).
  const db = getDb(env);
  const { data, error } = await db.rpc("api_claim_contact_message", {
    p_name: body.name,
    p_email: body.email,
    p_company: body.company ?? null,
    p_message: body.message,
    p_ip: ip,
    p_cap: body.kind === "abuse" ? ABUSE_DAILY_CAP : CONTACT_DAILY_CAP,
    p_kind: body.kind,
  });
  if (error) {
    throw new Error(`api_claim_contact_message failed: ${error.message}`);
  }
  const claim = data as { allowed: boolean };
  if (!claim.allowed) {
    return errorResponse(
      c,
      "rate_limited",
      `The contact form is at its daily limit. Email ${CONTACT_INBOX} instead.`,
    );
  }

  // Forward to support. A failure here throws (500): the submission is
  // already stored, and the founder can recover it from contact_messages.
  await sendEmail(env, {
    to: CONTACT_INBOX,
    replyTo: body.email,
    // #303: an abuse report must be findable in an inbox at a glance. A
    // subject reading "Contact form" buries the one message that needs
    // answering today under the ones that can wait.
    subject:
      body.kind === "abuse"
        ? `ABUSE REPORT: ${body.name}`
        : `Contact form: ${body.name}`,
    text: supportText(body, ip),
    html: supportHtml(body, ip),
  });

  // Acknowledge the submitter, best-effort: the submission is stored and
  // forwarded, so an ack failure must not turn a delivered message into a
  // user-facing error (and a retry would double-post).
  try {
    const ack = ackCopy();
    await sendEmail(env, {
      to: body.email,
      subject: ack.subject,
      text: ack.text,
      html: renderEmailHtml(ack.text),
    });
  } catch (cause) {
    console.error("contact acknowledgment email failed:", cause);
  }

  return c.json({ ok: true }, 201);
});

/** Server-side Turnstile check; any network/HTTP failure counts as not-human. */
async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string,
): Promise<boolean> {
  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret,
      response: token,
      ...(ip !== "unknown" ? { remoteip: ip } : {}),
    }),
  });
  if (!response.ok) return false;
  const payload = (await response.json()) as { success?: unknown };
  return payload.success === true;
}

function supportText(body: ContactBody, ip: string): string {
  return (
    `New contact form submission on loonext.com\n\n` +
    `Name: ${body.name}\n` +
    `Email: ${body.email}\n` +
    (body.company !== undefined && body.company !== ""
      ? `Company: ${body.company}\n`
      : "") +
    `IP: ${ip}\n\n` +
    `Message:\n\n${body.message}\n\n` +
    `Reply to this email to answer them directly.\n`
  );
}

/** Every interpolated field is submitter-controlled — escape all of them. The
 *  composed body is framed by the shared branded email layout (#88). */
function supportHtml(body: ContactBody, ip: string): string {
  return emailLayout(
    `<p>New contact form submission on loonext.com</p>` +
      `<p><strong>Name:</strong> ${escapeHtml(body.name)}<br>` +
      `<strong>Email:</strong> ${escapeHtml(body.email)}<br>` +
      (body.company !== undefined && body.company !== ""
        ? `<strong>Company:</strong> ${escapeHtml(body.company)}<br>`
        : "") +
      `<strong>IP:</strong> ${escapeHtml(ip)}</p>` +
      `<blockquote style="margin:0 0 16px;padding:8px 16px;border-left:3px solid #E8E8E0;color:#4A4D3C;">${toHtml(body.message)}</blockquote>` +
      `<p>Reply to this email to answer them directly.</p>`,
  );
}

/**
 * Plain acknowledgment. Deliberately carries NOTHING the submitter wrote: the
 * address it goes to is whatever the form said and is never verified, so any
 * attacker-written content echoed here makes this endpoint a spam relay.
 *
 * That already excluded the message body. It now excludes the NAME too, which
 * was the same hole one field narrower (#581): the greeting was interpolated
 * raw, and this email renders through `renderEmailHtml`, which linkifies bare
 * URLs — so a `name` of "https://…" arrived at an address the same submitter
 * chose as a clickable, Loonext-branded link in a message our own domain signed.
 * Extending the existing rule beats sanitizing the name: a filter that has to
 * decide which strings are link-shaped is a list nobody can finish, and the
 * greeting is the whole cost. The founder still sees the real name on the
 * support forward, which goes to a fixed inbox.
 */
function ackCopy(): { subject: string; text: string } {
  return {
    subject: "We received your message",
    text:
      `Hi there,\n\n` +
      `Thanks for contacting Loonext. Your message is in our inbox and we ` +
      `reply to this address, usually within one business day.\n\n` +
      `If you did not submit the contact form on loonext.com, you can ` +
      `ignore this email.\n\n` +
      `Loonext\nhttps://loonext.com\n`,
  };
}
