import type { Metadata } from "next";

import { AssistantPageBody } from "@/components/marketing/assistant-page";
import { assistantFr } from "@/i18n/marketing/assistant";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/lou";

export const metadata: Metadata = buildMetadata({
  title: assistantFr.metaTitle,
  description: assistantFr.metaDescription,
  path: PATH,
});

/**
 * /fr/lou — the assistant's own name rather than a translation of "assistant".
 *
 * "Lou" is what the product calls it on every screen in both languages, so it
 * is the word a Quebec crew will actually type. "adjoint" would be a correct
 * translation of a word nobody uses to find this page.
 */
export default function AssistantPageFr() {
  return <AssistantPageBody locale="fr-CA" />;
}
