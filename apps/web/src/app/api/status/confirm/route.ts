import { NextResponse, type NextRequest } from "next/server";

import { readWorkerBindings } from "@/lib/marketing/status-mailer";
import {
  STATUS_SUBSCRIPTION_PATHS,
  confirmSubscription,
  statusSubscriptionLocale,
  type SubscriberStore,
} from "@/lib/marketing/status-subscribe";

/**
 * #477 — "email me when something is broken", step two: the link in the
 * confirmation email.
 *
 * Redirects rather than rendering, so the outcome lands on a plain static page
 * and the token leaves the address bar. A token sitting in a URL that stays on
 * screen is one that ends up in a screenshot, a support ticket, or a shared
 * link — and this one is also the unsubscribe token.
 *
 * An expired or unknown token is not an error page. It redirects to the same
 * status page with nothing claimed: the request expired on its own after a day,
 * which is a normal thing to happen, not a failure to explain.
 *
 * No `export const runtime` — the OpenNext adapter runs the Node runtime (D1).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const bindings = await readWorkerBindings();
  const store = bindings?.STATUS_FEED as SubscriberStore | undefined;

  const confirmedLocale = store
    ? await confirmSubscription(store, token)
    : null;
  const locale =
    confirmedLocale ??
    statusSubscriptionLocale(request.nextUrl.searchParams.get("locale"));
  const paths = STATUS_SUBSCRIPTION_PATHS[locale];
  return NextResponse.redirect(
    new URL(
      confirmedLocale ? paths.subscribed : paths.status,
      request.nextUrl.origin,
    ),
  );
}
