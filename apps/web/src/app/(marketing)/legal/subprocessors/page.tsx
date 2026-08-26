import type { Metadata } from "next";

import { SubprocessorsPageBody } from "@/components/marketing/legal/subprocessors-page";
import { legalSubprocessorsEn } from "@/i18n/marketing/legal-subprocessors";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/subprocessors";

export const metadata: Metadata = buildMetadata({
  title: legalSubprocessorsEn.metaTitle,
  description: legalSubprocessorsEn.metaDescription,
  path: PATH,
});

export default function SubprocessorsPage() {
  return <SubprocessorsPageBody locale="en" />;
}
