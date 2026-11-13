"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, type MouseEvent } from "react";

import { updateSearch } from "@/lib/url/search-state";

/**
 * The task detail drawer is URL-driven (TASKS-V2 D-A): a `?task=<id>` search
 * param opens a right-side drawer over whatever surface is showing (the /tasks
 * views, the conversation checklist, the thread). Because the state lives in the
 * URL, ANY `<Link>` or router push to `?task=<id>` opens it — the /tasks rows,
 * the checklist rows, and the thread task-event lines all use one mechanism, and
 * a dedicated `/tasks/[id]` route renders the same panel for refresh / share.
 *
 * These helpers keep the rest of the current URL intact (they only add/remove
 * the `task` param), so opening a task from a filtered /tasks view or a specific
 * thread and then closing it returns you exactly where you were. Opening and
 * closing write history directly (lib/url/search-state.ts), so neither waits on
 * a router navigation.
 */

/** The search-param key that carries the open task id. */
export const TASK_DRAWER_PARAM = "task";

/** A new history entry, so Back closes the drawer again. */
function openTask(taskId: string): void {
  updateSearch((params) => params.set(TASK_DRAWER_PARAM, taskId), "push");
}

function closeTask(): void {
  updateSearch((params) => params.delete(TASK_DRAWER_PARAM));
}

/**
 * The onClick for a `<Link href={hrefForTask(id)}>`: a plain primary click opens
 * the drawer in place, while a modified or middle click and "copy link" keep
 * the href.
 */
export function taskLinkClickHandler(taskId: string) {
  return (event: MouseEvent<HTMLElement>) => {
    const target = event.currentTarget.getAttribute("target");
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target !== null && target !== "_self")
    ) {
      return;
    }
    event.preventDefault();
    openTask(taskId);
  };
}

export function useTaskDrawer() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const openTaskId = searchParams.get(TASK_DRAWER_PARAM);

  /** Build an href that opens `taskId` while preserving the current URL. */
  const hrefForTask = useCallback(
    (taskId: string): string => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(TASK_DRAWER_PARAM, taskId);
      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams],
  );

  return { openTaskId, hrefForTask, openTask, closeTask };
}
