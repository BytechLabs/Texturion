import type { Metadata } from "next";
import type { ComponentProps } from "react";

import { QuotePage } from "@/components/public/quote-page";
import { publicPageLoader, publicPageMetadata } from "@/lib/public-page";

interface Props {
  params: Promise<{ token: string }>;
}

const loadQuote = publicPageLoader<NonNullable<ComponentProps<typeof QuotePage>["quote"]>>("q");

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const quote = await loadQuote((await params).token);
  return publicPageMetadata(quote?.locale, "quotes.customerPageTitle");
}

export default async function Page({ params }: Props) {
  const quote = await loadQuote((await params).token);
  return quote ? <QuotePage quote={quote} /> : <QuotePage notAvailable />;
}
