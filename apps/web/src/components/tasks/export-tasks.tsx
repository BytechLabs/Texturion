"use client";

import { FileDown } from "lucide-react";
import { toast } from "sonner";

import { capabilitiesOf } from "@loonext/shared";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import type { TaskListFilters } from "@/lib/api/task-filters";
import { useExportTasks } from "@/lib/api/tasks-export-hook";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * #745: the tasks in this view, as a file, at once.
 *
 * A click downloads a CSV of exactly what the list shows, with the tab and chips
 * already set. Nothing is queued and nothing lands in Settings: the data export
 * there is the workspace's regulatory copy, a different thing for a different
 * reader. The only toast is the one for a failure; a download that starts needs
 * no announcement.
 *
 * *Applying: Zen of Clarity (one quiet button, no second filter dialog) and
 * Prioritize Intent (the click does the thing).*
 *
 * Absent for anybody without `contacts.bulk`: every task names a customer.
 */
export function ExportTasks({ filters }: { filters: TaskListFilters }) {
  const t = useT();
  const { role } = useActiveCompany();
  const download = useExportTasks();

  const allowed = role ? capabilitiesOf(role).includes("contacts.bulk") : false;
  if (!allowed) return null;

  async function submit() {
    try {
      await download.mutateAsync(filters);
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : t("tasks.exportDownloadFailed"),
      );
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={download.isPending}
      onClick={() => void submit()}
      title={t("tasks.exportListNote")}
    >
      <FileDown className="size-3.5" strokeWidth={1.75} aria-hidden />
      {t("tasks.exportList")}
    </Button>
  );
}
