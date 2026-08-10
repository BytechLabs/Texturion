"use client";

import { FileDown } from "lucide-react";
import { toast } from "sonner";

import { capabilitiesOf, DEFAULT_LOCALE } from "@loonext/shared";

import { Button } from "@/components/ui/button";
import { makeTranslate, useT, type Translate } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useExportTasks } from "@/lib/api/exports";
import { useActiveCompany } from "@/lib/company/provider";

import type { TaskTab } from "./task-view-url";

/** English, for the pure helpers below when nobody hands them a `t`. */
const EN = makeTranslate(DEFAULT_LOCALE);

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
  const t = useT();
  const { role } = useActiveCompany();
  const request = useExportTasks();

  const allowed = role ? capabilitiesOf(role).includes("contacts.bulk") : false;
  if (!allowed) return null;

  async function submit() {
    try {
      const result = await request.mutateAsync({ state: stateForTab(tab) });
      toast.success(
        result.already_building
          ? t("tasks.exportAlreadyBuilding")
          : t("tasks.exportStarted"),
      );
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : t("tasks.exportFailed"),
      );
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={request.isPending}
      onClick={() => void submit()}
      title={t("tasks.exportNote")}
    >
      <FileDown className="size-3.5" strokeWidth={1.75} aria-hidden />
      {exportTasksLabel(tab, t)}
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
export function exportTasksLabel(tab: TaskTab, t: Translate = EN): string {
  if (tab === "open") return t("tasks.exportOutstanding");
  if (tab === "done") return t("tasks.exportFinished");
  return t("tasks.exportAll");
}

/** The tab, as the API's state filter. Absent means both. */
export function stateForTab(tab: TaskTab): "open" | "done" | undefined {
  if (tab === "open") return "open";
  if (tab === "done") return "done";
  return undefined;
}

/**
 * The button's hover note, in English.
 *
 * #228 moved the sentence itself into the catalogue — the button renders the
 * READER's language via `t("tasks.exportNote")`. This constant survives as the
 * English rendering of that same key, which is what the tests query the DOM by.
 */
export const EXPORT_TASKS_NOTE = EN("tasks.exportNote");
