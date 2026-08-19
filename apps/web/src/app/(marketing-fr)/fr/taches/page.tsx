import type { Metadata } from "next";

import { TasksPageBody } from "@/components/marketing/tasks-page";
import { tasksFr } from "@/i18n/marketing/tasks";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/taches";

export const metadata: Metadata = buildMetadata({
  title: tasksFr.metaTitle,
  description: tasksFr.metaDescription,
  path: PATH,
});

/**
 * /fr/taches — and the slug is translated, unlike the first two.
 *
 * `/fr/contact` and `/fr/canada` kept their English slugs because those words
 * are the same in French. "Tasks" is not: a Quebec crew searches *tâches*, and
 * a French page under an English slug is a page they find in spite of its URL
 * rather than because of it. The registry pairs arbitrary paths, so a
 * translated slug costs nothing structurally — it is only ever a choice about
 * the word.
 *
 * Without the circumflex, because a URL with a diacritic in it is one somebody
 * cannot type from a phone keyboard reliably and every mail client escapes
 * differently.
 */
export default function TasksPageFr() {
  return <TasksPageBody locale="fr-CA" />;
}
