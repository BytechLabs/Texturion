import type { Metadata } from "next";

import { CallsPageBody } from "@/components/marketing/calls-page";
import { callsEn } from "@/i18n/marketing/calls";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/calls";

export const metadata: Metadata = buildMetadata({
  title: callsEn.metaTitle,
  description: callsEn.metaDescription,
  path: PATH,
});

/** The English /features/calls page. Body shared with /fr/appels. */
export default function CallsPage() {
  return <CallsPageBody locale="en" />;
}
