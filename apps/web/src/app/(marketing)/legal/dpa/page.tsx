import statement from "@root/docs/DPA.md";
import type { Metadata } from "next";

import { DpaPageBody, DPA_EN_PATH } from "@/components/marketing/legal/dpa-page";
import { legalDpaEn } from "@/i18n/marketing/legal-dpa";
import { buildMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMetadata({
  title: legalDpaEn.metaTitle,
  description: legalDpaEn.metaDescription,
  path: DPA_EN_PATH,
});

export default function DpaPage() {
  return <DpaPageBody locale="en" statement={statement} />;
}
