import type { Metadata } from "next";

import { CookiesPageBody } from "@/components/marketing/legal/cookies-page";
import { legalCookiesEn } from "@/i18n/marketing/legal-cookies";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/cookies";

export const metadata: Metadata = buildMetadata({
  title: legalCookiesEn.metaTitle,
  description: legalCookiesEn.metaDescription,
  path: PATH,
});

export default function CookiesPage() {
  return <CookiesPageBody locale="en" />;
}
