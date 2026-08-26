import type { Metadata } from "next";

import { SecurityPageBody } from "@/components/marketing/security-page";
import { securityEn } from "@/i18n/marketing/security";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/security";

export const metadata: Metadata = buildMetadata({
  title: securityEn.metadataTitle,
  description: securityEn.metadataDescription,
  path: PATH,
});

export default function SecurityPage() {
  return <SecurityPageBody />;
}
