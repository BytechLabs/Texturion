import type { Metadata } from "next";

import { SharedInboxPageBody } from "@/components/marketing/shared-inbox-page";
import { sharedInboxEn } from "@/i18n/marketing/shared-inbox";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/shared-inbox";

export const metadata: Metadata = buildMetadata({
  title: sharedInboxEn.metaTitle,
  description: sharedInboxEn.metaDescription,
  path: PATH,
});

/** The English /features/shared-inbox page. Body shared with /fr/boite-partagee. */
export default function SharedInboxPage() {
  return <SharedInboxPageBody locale="en" />;
}
