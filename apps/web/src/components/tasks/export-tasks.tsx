"use client";

import { FileDown } from "lucide-react";
import { toast } from "sonner";

import { capabilitiesOf } from "@loonext/shared";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/error";
import { useExportTasks } from "@/lib/api/exports";
import { useActiveCompany } from "@/lib/company/provider";

import type { TaskTab } from "./task-view-url";

/**
 * #304 — the work, as a file.
 *
 * Design notes, and the principles behind them:
 *
 * - **No second filter UI.** The page already has tabs. Asking again for a
 *   date range and a state, in a dialog, beside controls that already say
 *   both, is the duplicate-state bug users experience as "which one wins?".
 *   *Applying: Zen of Clarity — and Smart Defaults taken to its conclusion:
 *   the best default is the choice they have already made.*
 *
 * - **It says what it will contain, not "what you see".** The Mine tab filters
 *   by assignee and the export cannot, so a button promising the current view
 *   would quietly hand over everybody's work. The label names the actual
 *   contents in every tab, so there is no claim left to break. *Applying:
 *   Ethical Friction — the honest sentence goes where the decision is made.*
 *
 * - **Absent for anybody who cannot do it.** `contacts.bulk`, because every
 *   task names a customer. A task list looks like internal admin and is not.
 */
export function ExportTasks({ tab }: { tab: TaskTab }) {
  const { role } = useActiveCompany();
  const request = useExportTasks();

  const allowed = role ? capabilitiesOf(role).includes("contacts.bulk") : false;
  if (!allowed) return null;

  async function submit() {
    try {
      const result = await request.mutateAsync({ state: stateForTab(tab) });
      toast.success(
        result.already_building
          ? "One is already being put together. It will appear in Settings › Data export."
          : "Being put together now. It will appear in Settings › Data export.",
      );
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "That could not be started.",
      );
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={request.isPending}
      onClick={() => void submit()}
      title={EXPORT_TASKS_NOTE}
    >
      <FileDown className="size-3.5" strokeWidth={1.75} aria-hidden />
      {exportTasksLabel(tab)}
    </Button>
  );
}

/**
 * What the file will actually contain, per tab.
 *
 * `mine` and `all` both export every state, because the export has no assignee
 * filter — so the label for `mine` deliberately does NOT say "mine". A control
 * that promised one person's work and delivered the workspace's would be found
 * out only after the file arrived.
 */
export function exportTasksLabel(tab: TaskTab): string {
  if (tab === "open") return "Export outstanding work";
  if (tab === "done") return "Export finished work";
  return "Export all work";
}

/** The tab, as the API's state filter. Absent means both. */
export function stateForTab(tab: TaskTab): "open" | "done" | undefined {
  if (tab === "open") return "open";
  if (tab === "done") return "done";
  return undefined;
}

export const EXPORT_TASKS_NOTE =
  "A file of this work for your records. It covers the whole workspace, not " +
  "just your own jobs, and it is put together in the background.";
