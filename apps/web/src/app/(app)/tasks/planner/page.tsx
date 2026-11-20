import { Suspense } from "react";

import { TasksPage } from "@/components/tasks/tasks-page";

export default function PlannerPage() {
  return <Suspense><TasksPage planner /></Suspense>;
}
