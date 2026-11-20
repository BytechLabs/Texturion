import { Suspense } from "react";

import { SavedTasksPage } from "@/components/tasks/tasks-page";

export default async function TaskViewPage({ params }: { params: Promise<{ viewId: string }> }) {
  const { viewId } = await params;
  return <Suspense><SavedTasksPage viewId={viewId} /></Suspense>;
}
