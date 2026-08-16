import type { Metadata } from "next";

import { QuotePage } from "@/components/public/quote-page";
import { publicEnv } from "@/env";

/**
 * #287 — the page a homeowner opens to read a quote and accept it.
 *
 * No account, no login, no shell. This file may export ONLY the page and its
 * metadata; a Next page.tsx that exports anything else breaks `next build`
 * while every other check passes.
 */

/**
 * Kept out of every index, belt and braces.
 *
 * The API already sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`
 * on its side (D75). This is the HTML half of the same instruction, because the
 * page is fetched by a browser a crawler may also be driving, and a snippet is
 * where the amount and the business would surface.
 */
export const metadata: Metadata = {
  title: "Quote",
  robots: { index: false, follow: false, nocache: true },
};

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const base = publicEnv.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  // No-store: this page carries an amount, a business name and a description
  // of somebody's work. A shared machine must not keep any of it after the
  // link stops opening.
  const response = await fetch(`${base}/q/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });

  // Every failure renders the same page, matching the API. A page that told
  // the holder WHICH failure it was would be an oracle for the rest.
  if (!response.ok) return <QuotePage notAvailable />;

  const quote = (await response.json()) as {
    locale?: string;
    business_name: string;
    amount_cents: number;
    currency: string;
    description: string;
    status: string;
    expires_at: string;
    can_accept: boolean;
  };

  return <QuotePage quote={quote} token={token} />;
}
