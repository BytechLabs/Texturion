import type { Metadata } from "next";

import { ContactsPageBody } from "@/components/marketing/contacts-page";
import { contactsFr } from "@/i18n/marketing/contacts";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/contacts";

export const metadata: Metadata = buildMetadata({
  title: contactsFr.metaTitle,
  description: contactsFr.metaDescription,
  path: PATH,
});

/**
 * /fr/contacts — the slug is NOT translated here, and that is the rule working
 * rather than an oversight: "contacts" is the same word in French. /fr/taches
 * and /fr/boite-partagee are translated because their English slugs are not
 * words a Quebec crew would search for. This one already is.
 */
export default function ContactsPageFr() {
  return <ContactsPageBody locale="fr-CA" />;
}
