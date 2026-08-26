import type { Metadata } from "next";

import { MessagingPageBody } from "@/components/marketing/legal/messaging-page";
import { legalMessagingEn } from "@/i18n/marketing/legal-messaging";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/messaging";
export const metadata: Metadata = buildMetadata({
  title: legalMessagingEn.metaTitle,
  description: legalMessagingEn.metaDescription,
  path: PATH,
});

export default function MessagingPolicyPage() {
  return <MessagingPageBody locale="en" />;
}
