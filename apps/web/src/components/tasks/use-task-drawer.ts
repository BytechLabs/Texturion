"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

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
 * thread and then closing it returns you exactly where you were.
 */

/** The search-param key that carries the open task id. */
export const TASK_DRAWER_PARAM = "task";

export function useTaskDrawer() {
  const router = useRouter();
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

  const openTask = useCallback(
    (taskId: string) => {
      router.push(hrefForTask(taskId), { scroll: false });
    },
    [router, hrefForTask],
  );

  const closeTask = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(TASK_DRAWER_PARAM);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  return { openTaskId, hrefForTask, openTask, closeTask };
}
