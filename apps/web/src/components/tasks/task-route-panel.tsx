"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { TaskDetailPanel } from "./task-detail-panel";

/**
 * The /tasks/[id] page body (TASKS-V2 D-A) — the same TaskDetailPanel the drawer
 * renders, framed as a standalone elevated card for a hard refresh / shared
 * link. On delete the panel calls onClose; here that navigates back to /tasks.
 */
export function TaskRoutePanel({ taskId }: { taskId: string }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <Link
        href="/tasks"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-app-muted transition-colors hover:text-app-ink"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
        Back to tasks
      </Link>
      <div className="overflow-hidden rounded-app-card border border-app-line bg-app-white">
        <div className="h-[calc(100svh-11rem)] min-h-[420px]">
          <TaskDetailPanelHost taskId={taskId} />
        </div>
      </div>
    </div>
  );
}

/** Wraps the panel with a client-side "back to /tasks" close. */
function TaskDetailPanelHost({ taskId }: { taskId: string }) {
  return (
    <TaskDetailPanel
      taskId={taskId}
      onClose={() => {
        // A hard nav so the deleted task's route unmounts cleanly.
        window.location.assign("/tasks");
      }}
    />
  );
}
