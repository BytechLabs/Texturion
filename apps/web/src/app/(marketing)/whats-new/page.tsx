import type { Metadata } from "next";

import { WhatsNewPageBody } from "@/components/marketing/whats-new-page";
import { whatsNewEn } from "@/i18n/marketing/whats-new";
import { buildMetadata } from "@/lib/marketing/seo";
import { LIVE_ROUTES } from "@/lib/marketing/site";

export const metadata: Metadata = buildMetadata({
  title: whatsNewEn.metadataTitle,
  description: whatsNewEn.metadataDescription,
  path: LIVE_ROUTES.whatsNew,
});

export default function WhatsNewPage() {
  return <WhatsNewPageBody />;
}
