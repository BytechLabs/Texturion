import type { Metadata } from "next";

import { AssistantPageBody } from "@/components/marketing/assistant-page";
import { assistantEn } from "@/i18n/marketing/assistant";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/assistant";

export const metadata: Metadata = buildMetadata({
  title: assistantEn.metaTitle,
  description: assistantEn.metaDescription,
  path: PATH,
});

/** The English /features/assistant page. Body shared with /fr/lou. */
export default function AssistantPage() {
  return <AssistantPageBody locale="en" />;
}
