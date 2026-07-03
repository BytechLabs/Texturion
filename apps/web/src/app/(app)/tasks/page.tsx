import { ListChecks } from "lucide-react";

import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = {
  title: "Tasks",
};

/**
 * /tasks — the task views (D25, provisional; docs/HOME-AND-VIEWS.md / TASKS.md).
 * Wired into the nav now for shell placement (APP-LAYOUT-V2 §1.3); the four
 * switchable views (list / board / calendar / map) land in the later features
 * wave. Placeholder keeps the nav link live (zero dead links).
 */
export default function TasksPage() {
  return (
    <ComingSoon
      icon={ListChecks}
      title="Tasks"
      description="Turn any message into a task and track it here. Tasks are coming soon — you can already mark messages done right in a conversation."
    />
  );
}
