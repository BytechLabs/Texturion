import { ListChecks } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/i18n/provider";

import { hasActiveChips, serializeTaskState, type TaskPageState } from "./task-view-url";

/**
 * The calm empty state (T6.1 / T5.3). Three voices:
 *  - a filtered view with nothing in it → one quiet line ("Nothing here");
 *  - your own open list with nothing in it → says it is YOURS that is empty
 *    and offers every task, because the workspace may well have some (#718:
 *    "No tasks yet" there read as if nobody had any);
 *  - the true first run → a sentence naming the two ways to add one: New task,
 *    or promoting a message from its ⋯ menu (T5.3).
 *
 * No illustration, generous air (per APP-UI-ELEVATION §3.1 calm empty states).
 */
export function EmptyTasks({ state }: { state: TaskPageState }) {
  const t = useT();
  const filtered = hasActiveChips(state);
  const mine = !filtered && state.tab !== "all";
  const icon = <ListChecks strokeWidth={1.75} />;
  if (filtered) return <EmptyState icon={icon} title={t("tasks.emptyFiltered")} />;
  if (mine) {
    return (
      <EmptyState
        icon={icon}
        title={t(
          state.tab === "done"
            ? "tasks.emptyMineDone"
            : state.tab === "mine"
              ? "tasks.emptyMineAny"
              : "tasks.emptyMine",
        )}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={`/tasks${serializeTaskState({ ...state, tab: "all" })}`}>
              {t("tasks.emptySeeAll")}
            </Link>
          </Button>
        }
      />
    );
  }
  return <EmptyState icon={icon} title={t("tasks.emptyTitle")} description={t("tasks.emptyBody")} />;
}
