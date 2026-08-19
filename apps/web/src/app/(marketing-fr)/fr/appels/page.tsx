import type { Metadata } from "next";

import { CallsPageBody } from "@/components/marketing/calls-page";
import { callsFr } from "@/i18n/marketing/calls";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/appels";

export const metadata: Metadata = buildMetadata({
  title: callsFr.metaTitle,
  description: callsFr.metaDescription,
  path: PATH,
});

/** /fr/appels — a Quebec crew searches "appels", not "calls". */
export default function CallsPageFr() {
  return <CallsPageBody locale="fr-CA" />;
}
