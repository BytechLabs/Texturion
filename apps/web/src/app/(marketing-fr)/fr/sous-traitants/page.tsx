import type { Metadata } from "next";

import { SubprocessorsPageBody } from "@/components/marketing/legal/subprocessors-page";
import { legalSubprocessorsFr } from "@/i18n/marketing/legal-subprocessors";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/sous-traitants";

export const metadata: Metadata = buildMetadata({
  title: legalSubprocessorsFr.metaTitle,
  description: legalSubprocessorsFr.metaDescription,
  path: PATH,
});

export default function SubprocessorsPageFr() {
  return <SubprocessorsPageBody locale="fr-CA" />;
}
