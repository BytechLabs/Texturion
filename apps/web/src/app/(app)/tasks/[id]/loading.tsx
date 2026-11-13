import { TaskDetailSkeleton } from "@/components/tasks/task-detail-panel";
import { TaskRouteFrame } from "@/components/tasks/task-route-panel";

/** Painted at the click while the task's page is fetched, in the page's own frame. */
export default function TaskDetailLoading() {
  return (
    <TaskRouteFrame>
      <TaskDetailSkeleton />
    </TaskRouteFrame>
  );
}
