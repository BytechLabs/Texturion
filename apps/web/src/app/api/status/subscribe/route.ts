import { NextResponse, type NextRequest } from "next/server";

import {
  buildMailer,
  readWorkerBindings,
} from "@/lib/marketing/status-mailer";
import {
  normalizeEmail,
  startSubscription,
  type SubscriberStore,
} from "@/lib/marketing/status-subscribe";

/**
 * #477 — "email me when something is broken", step one.
 *
 * Posted from the /status page. Writes a pending address to the same KV
 * namespace that carries the live incident line, and sends one confirmation
 * email. Nothing is added to the list until that link is opened.
 *
 * THE RESPONSE IS THE SAME FOR ALMOST EVERY OUTCOME, and that is a feature.
 * "Already subscribed", "we just mailed you", and "the daily cap stopped us"
 * all return the same sentence, because a form that distinguishes them is a
 * form that tells a stranger whether an address is on our list. The two
 * exceptions are the ones the visitor can act on: an address that is not an
 * address, and a list that is full.
 *
 * No `export const runtime` — the OpenNext adapter runs the Node runtime (D1).
 *
 * #228: THE FOUR SENTENCES BELOW STAY ENGLISH, AND STAY HERE.
 *
 * They are only ever read by `components/marketing/status-subscribe-card.tsx`
 * on `/status`, which is the Bill 96 marketing deliverable — a different
 * problem with a different answer (real French URLs and `hreflang`, resolved by
 * routing) from the app catalogue's, which is a per-PERSON setting read from a
 * session. This request has no session, no company and no member, so there is
 * nothing here to resolve a language from: filing these under `i18n/sections/`
 * would record them as handled by a scheme that can never reach them.
 */

/** The response every non-actionable outcome gets. */
const NEUTRAL = "Check your email for a link to confirm.";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const body = (payload ?? {}) as Record<string, unknown>;

  // The honeypot the contact form already uses: a field no person sees and no
  // person fills. A bot that fills it gets the success sentence and nothing
  // else happens, so it has no signal to learn from.
  if (typeof body.website === "string" && body.website.trim().length > 0) {
    return NextResponse.json({ message: NEUTRAL });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json(
      { error: "That doesn't look like an email address." },
      { status: 400 },
    );
  }

  const bindings = await readWorkerBindings();

  // #575: a per-caller gate, because everything else here is shared.
  //
  // The spend was already bounded (200 subscribers, 50 confirmations a day, 1000
  // emails a month — lib/marketing/status-subscribe), so this is not about a
  // runaway bill. It is about who gets to spend that allowance. Without it one
  // script consumes the whole day's fifty and points them at fifty addresses that
  // never asked for anything, and the reputational cost of sending that mail lands
  // on the domain every customer notification also leaves from.
  //
  // Placed AFTER the honeypot and the address check so a bot learns nothing new
  // from being limited, and BEFORE the store and mailer are touched so a limited
  // caller costs a KV read rather than an email.
  //
  // Absent binding (local dev, vitest, `next build`'s prerender) skips the gate,
  // the same as every other limiter in this codebase.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const limiter = bindings?.STATUS_SUBSCRIBE_RATE_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key: `status-subscribe:${ip}` });
    if (!success) {
      // The NEUTRAL sentence, not a 429 with an explanation. A form that says
      // "too many attempts" tells a script its rate is being measured and what to
      // slow down to; this tells it nothing it did not already have. Same reasoning
      // as the honeypot two checks up.
      return NextResponse.json({ message: NEUTRAL });
    }
  }

  const store = bindings?.STATUS_FEED as SubscriberStore | undefined;
  const mailer = buildMailer(bindings);
  // Unconfigured is not the visitor's problem to solve, and it should not
  // happen: the form only renders when both exist. Saying "not available" is
  // still better than a success message for a subscription that cannot exist.
  if (!store || !mailer) {
    return NextResponse.json(
      { error: "Status updates by email aren't available right now." },
      { status: 503 },
    );
  }

  const outcome = await startSubscription(store, mailer, email, new Date());
  if (outcome === "full") {
    return NextResponse.json(
      {
        error:
          "The status list is full right now. Email support and we'll add you.",
      },
      { status: 503 },
    );
  }
  return NextResponse.json({ message: NEUTRAL });
}
