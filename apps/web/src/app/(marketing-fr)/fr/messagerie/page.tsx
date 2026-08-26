import type { Metadata } from "next";

import { MessagingPageBody } from "@/components/marketing/legal/messaging-page";
import { legalMessagingFr } from "@/i18n/marketing/legal-messaging";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/messagerie";

export const metadata: Metadata = buildMetadata({
  title: legalMessagingFr.metaTitle,
  description: legalMessagingFr.metaDescription,
  path: PATH,
});

export default function MessagingPageFr() {
  return <MessagingPageBody locale="fr-CA" />;
}
