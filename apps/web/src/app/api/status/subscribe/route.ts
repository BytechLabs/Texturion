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
