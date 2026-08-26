import type { Metadata } from "next";

import { DeleteMyDataPageBody } from "@/components/marketing/legal/delete-my-data-page";
import { legalDeleteMyDataEn } from "@/i18n/marketing/legal-delete-my-data";
import { buildMetadata } from "@/lib/marketing/seo";

/**
 * #227: the public deletion URL.
 *
 * Google Play's Data Safety form requires a **web-accessible** deletion URL for
 * any app with accounts, reachable without signing in and independent of any
 * in-app flow. That is why this lives on the marketing site rather than behind
 * the app: a reviewer, or someone who has already lost access to their account,
 * has to be able to read it.
 *
 * The path is STABLE. It is filed with Google and printed in the privacy
 * policy; renaming it silently breaks a store declaration.
 */
const PATH = "/legal/delete-my-data";

export const metadata: Metadata = buildMetadata({
  title: legalDeleteMyDataEn.metaTitle,
  description: legalDeleteMyDataEn.metaDescription,
  path: PATH,
});

export default function DeleteMyDataPage() {
  return <DeleteMyDataPageBody locale="en" />;
}
