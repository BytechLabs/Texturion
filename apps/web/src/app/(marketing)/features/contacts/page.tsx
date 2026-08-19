import type { Metadata } from "next";

import { ContactsPageBody } from "@/components/marketing/contacts-page";
import { contactsEn } from "@/i18n/marketing/contacts";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/contacts";

export const metadata: Metadata = buildMetadata({
  title: contactsEn.metaTitle,
  description: contactsEn.metaDescription,
  path: PATH,
});

/** The English /features/contacts page. Body shared with /fr/contacts. */
export default function ContactsPage() {
  return <ContactsPageBody locale="en" />;
}
