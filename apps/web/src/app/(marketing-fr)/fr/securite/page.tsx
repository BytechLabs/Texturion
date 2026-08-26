import type { Metadata } from "next";

import { SecurityPageBody } from "@/components/marketing/security-page";
import { securityFr } from "@/i18n/marketing/security";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/securite";

export const metadata: Metadata = buildMetadata({
  title: securityFr.metadataTitle,
  description: securityFr.metadataDescription,
  path: PATH,
});

export default function SecuritePage() {
  return <SecurityPageBody locale="fr-CA" />;
}
