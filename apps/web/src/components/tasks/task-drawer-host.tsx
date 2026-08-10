"use client";

import { Suspense } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useT } from "@/i18n/provider";

import { TaskDetailPanel } from "./task-detail-panel";
import { useTaskDrawer } from "./use-task-drawer";

/**
 * The global task drawer (TASKS-V2 D-A). Mounted once in the app shell, it reads
 * the `?task=<id>` URL param and slides in a right-side elevated sheet rendering
 * the shared TaskDetailPanel. Because it is URL-driven, opening a task from the
 * /tasks views, the conversation checklist, or a thread task-event line all go
 * through the same param — and the /tasks/[id] route renders the same panel for
 * a hard refresh / share. Closing clears the param (via useTaskDrawer.closeTask),
 * returning to whatever surface was underneath.
 *
 * useTaskDrawer reads useSearchParams, so the host is wrapped in Suspense (Next
 * 15 requirement for a component that reads search params under the app shell).
 */
export function TaskDrawerHost() {
  return (
    <Suspense fallback={null}>
      <TaskDrawerHostInner />
    </Suspense>
  );
}

function TaskDrawerHostInner() {
  const t = useT();
  const { openTaskId, closeTask } = useTaskDrawer();
  const open = openTaskId !== null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeTask();
      }}
    >
      <SheetContent
        side="right"
        // The slide-in task drawer is a true floating layer (PORTAL-UX §4), so
        // it carries the single permitted barely-there shadow; wider than the
        // default, calm app surface, no default padding (the panel owns spacing).
        className="app-scope w-full gap-0 border-app-line bg-app-paper p-0 app-shadow-float sm:max-w-md"
      >
        {/* Accessible title/description for the dialog; the visible header lives
            inside the panel, so keep these screen-reader-only. */}
        <SheetTitle className="sr-only">{t("tasks.drawerTitle")}</SheetTitle>
        <SheetDescription className="sr-only">
          {t("tasks.drawerDescription")}
        </SheetDescription>
        {openTaskId && (
          <TaskDetailPanel taskId={openTaskId} onClose={closeTask} />
        )}
      </SheetContent>
    </Sheet>
  );
}
