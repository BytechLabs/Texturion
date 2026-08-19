import type { Metadata } from "next";

import { ContactPageBody } from "@/components/marketing/contact-page";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/contact";

export const metadata: Metadata = buildMetadata({
  title: "Contact",
  description:
    "Email Loonext and a real person answers. No sales team and no phone tree: your message goes straight to the small crew who built and run the product.",
  path: PATH,
});

/**
 * The English contact page.
 *
 * D138: the body lives in `components/marketing/contact-page.tsx` so this file
 * and `(marketing-fr)/fr/contact/page.tsx` render the same markup in different
 * languages. What stays here is what is genuinely per-route — the path and the
 * metadata, including the hreflang pair `buildMetadata` derives from the
 * translated-pages registry.
 */
export default function ContactPage() {
  return <ContactPageBody locale="en" />;
}
