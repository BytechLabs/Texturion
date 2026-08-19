import type { Metadata } from "next";

import { ContactPageBody } from "@/components/marketing/contact-page";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/contact";

export const metadata: Metadata = buildMetadata({
  title: "Nous joindre",
  description:
    "Écrivez à Loonext et une vraie personne répond. Pas d'équipe de vente ni de menu téléphonique : votre message va directement à la petite équipe qui a bâti le produit et le fait fonctionner.",
  path: PATH,
});

/**
 * The French contact page — the first URL on the site that is not English.
 *
 * Same body as `/contact`, same markup, different locale and different
 * metadata. The hreflang pair is derived by `buildMetadata` from the
 * translated-pages registry, so this page and its English twin cannot disagree
 * about each other's existence.
 */
export default function ContactPageFr() {
  return <ContactPageBody locale="fr-CA" />;
}
