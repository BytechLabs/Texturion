import { Suspense } from "react";

import { ListSkeleton } from "@/components/ui/list-skeleton";
import { TasksPage } from "@/components/tasks/tasks-page";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Tasks",
};

/**
 * /tasks — the task views (D17 / D25; docs/HOME-AND-VIEWS.md, docs/TASKS.md).
 * A URL-state view switcher over four views: List (default) · Board · Calendar
 * · Map. The client component reads `useSearchParams`, so it renders inside a
 * Suspense boundary (Next 15 requirement). The Board / Calendar / Map views —
 * and the map's react-leaflet island — are lazy client islands (§7 perf).
 */
export default function TasksRoute() {
  return (
    <Suspense fallback={<TasksLoading />}>
      <TasksPage />
    </Suspense>
  );
}

function TasksLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-6 md:py-8">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-9 w-56" />
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <ListSkeleton rows={5} className="pt-2" />
    </div>
  );
}
