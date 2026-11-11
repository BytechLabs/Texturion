import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate } from "@/i18n/provider";

import type { ExportDeps } from "./contacts-export";
import { ApiError, parseErrorBody } from "./error";
import type { TaskListFilters } from "./task-filters";
import { taskSearchParams } from "./task-params";

/**
 * #745: the tasks in the current view, as a download.
 *
 * `GET /v1/tasks/export.csv` takes the list's own query string and answers with
 * the file itself, so this is a plain fetch to a blob. Nothing is queued and
 * nothing appears under Settings: only the workspace data export lives there.
 *
 * Environment-free like `contacts-export.ts`; the session wiring is in
 * `tasks-export-hook.ts`.
 */
const FILENAME = "tasks.csv";

export async function fetchTasksExport(
  companyId: string,
  filters: TaskListFilters,
  deps: ExportDeps,
): Promise<{ blob: Blob; filename: string }> {
  const fetchImpl = deps.fetch;
  const t = deps.t ?? makeTranslate(DEFAULT_LOCALE);

  const token = await deps.getToken();
  if (!token) throw new ApiError("unauthorized", t("misc.apiSignedOut"), 401);

  const url = new URL(`${deps.baseUrl.replace(/\/$/, "")}/v1/tasks/export.csv`);
  // The file is not a page of a list, and the map's flag means a different view.
  const params = taskSearchParams(
    { ...filters, has_location: undefined, sort: undefined },
    undefined,
  );
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "X-Company-Id": companyId },
  });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw parseErrorBody(response.status, payload, t);
  }

  // Bytes, not text: `.text()` drops the byte-order mark Excel needs.
  const blob = new Blob([await response.arrayBuffer()], { type: "text/csv;charset=utf-8" });
  const match = /filename="?([^"]+)"?/i.exec(response.headers.get("Content-Disposition") ?? "");
  return { blob, filename: match?.[1]?.trim() || FILENAME };
}
