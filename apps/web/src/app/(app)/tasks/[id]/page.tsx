import { TaskRoutePanel } from "@/components/tasks/task-route-panel";

export const metadata = {
  title: "Task",
};

/**
 * /tasks/[id] — the deep-linkable task detail (TASKS-V2 D-A). Renders the SAME
 * TaskDetailPanel the drawer uses, but as a standalone page for a hard refresh
 * or a shared link. A "Back to tasks" affordance returns to the list; the panel
 * body is identical (editable metadata, source message, attachments, activity +
 * note composer).
 */
export default async function TaskDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TaskRoutePanel taskId={id} />;
}
