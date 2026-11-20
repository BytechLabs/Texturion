import { Suspense } from "react";

import { DispatchPlanner } from "@/components/tasks/dispatch-planner";
import { ListSkeleton } from "@/components/ui/list-skeleton";

export const metadata = { title: "Planner" };

export default function PlannerPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <DispatchPlanner />
    </Suspense>
  );
}
