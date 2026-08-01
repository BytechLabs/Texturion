import { NextResponse, type NextRequest } from "next/server";

import { readWorkerBindings } from "@/lib/marketing/status-mailer";
import {
  unsubscribe,
  type SubscriberStore,
} from "@/lib/marketing/status-subscribe";

/**
 * #477 — leaving the status list.
 *
 * GET is the link at the bottom of every message. POST is the same thing for
 * `List-Unsubscribe-Post`, which is how a mail client's own unsubscribe button
 * reaches us — it never renders anything, so it answers 204 and stops.
 *
 * NEITHER ASKS ANYTHING. No "are you sure", no preferences page, no sign-in.
 * The one place in this product where friction is unambiguously wrong is the
 * exit from a mailing list somebody may not remember joining.
 *
 * A token that is already gone still reports success. Somebody clicking twice,
 * or a mail client that prefetched the link, must not be told it failed: they
 * are off the list either way, and that is the only fact worth asserting.
 *
 * No `export const runtime` — the OpenNext adapter runs the Node runtime (D1).
 */
async function drop(token: string): Promise<void> {
  const bindings = await readWorkerBindings();
  const store = bindings?.STATUS_FEED as SubscriberStore | undefined;
  if (store) await unsubscribe(store, token);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  await drop(request.nextUrl.searchParams.get("token") ?? "");
  return NextResponse.redirect(
    new URL("/status/unsubscribed", request.nextUrl.origin),
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  await drop(request.nextUrl.searchParams.get("token") ?? "");
  return new NextResponse(null, { status: 204 });
}
