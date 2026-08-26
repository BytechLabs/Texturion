import type { Metadata } from "next";

import { CookiesPageBody } from "@/components/marketing/legal/cookies-page";
import { legalCookiesFr } from "@/i18n/marketing/legal-cookies";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/temoins";

export const metadata: Metadata = buildMetadata({
  title: legalCookiesFr.metaTitle,
  description: legalCookiesFr.metaDescription,
  path: PATH,
});

export default function CookiesPageFr() {
  return <CookiesPageBody locale="fr-CA" />;
}
