import type { Metadata } from "next";

import type { PaymentRequestState } from "@loonext/shared";

import { PaymentPage } from "@/components/public/payment-page";
import { publicEnv } from "@/env";

/**
 * #224 — the page a homeowner opens to pay a business.
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
  title: "Pay",
  robots: { index: false, follow: false, nocache: true },
};

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const base = publicEnv.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  // No-store: this page carries an amount and a business name, and a shared
  // machine must not keep either after the link stops opening.
  const response = await fetch(`${base}/pay/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });

  if (!response.ok) return <PaymentPage notAvailable />;

  const data = (await response.json()) as {
    locale?: string;
    business_name: string;
    amount: string;
    description: string;
    state: PaymentRequestState;
    pay_url: string | null;
  };
  return (
    <PaymentPage
      locale={data.locale}
      businessName={data.business_name}
      amount={data.amount}
      description={data.description}
      state={data.state}
      payUrl={data.pay_url}
    />
  );
}
