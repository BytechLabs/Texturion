import type { Metadata } from "next";

import { TasksPageBody } from "@/components/marketing/tasks-page";
import { tasksEn } from "@/i18n/marketing/tasks";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/tasks";

export const metadata: Metadata = buildMetadata({
  title: tasksEn.metaTitle,
  description: tasksEn.metaDescription,
  path: PATH,
});

/**
 * The English /features/tasks page.
 *
 * D138: the body lives in `components/marketing/tasks-page.tsx` so this file
 * and `(marketing-fr)/fr/taches/page.tsx` render the same markup in different
 * languages.
 */
export default function TasksPage() {
  return <TasksPageBody locale="en" />;
}
