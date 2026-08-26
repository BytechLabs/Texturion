import type { Metadata } from "next";

import { DevelopersPageBody } from "@/components/marketing/developers-page";
import { developersEn } from "@/i18n/marketing/developers";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/developers";

export const metadata: Metadata = buildMetadata({
  title: developersEn.metadataTitle,
  description: developersEn.metadataDescription,
  path: PATH,
});

export default function DevelopersPage() {
  return <DevelopersPageBody />;
}
