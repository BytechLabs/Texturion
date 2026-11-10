import { ListChecks } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
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
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-20 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted">
        <ListChecks
          className="size-5 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
      </span>
      {filtered ? (
        <p className="text-[15px] text-muted-foreground">
          {t("tasks.emptyFiltered")}
        </p>
      ) : mine ? (
        <div className="space-y-3">
          <p className="text-[15px] font-medium text-foreground">
            {t(
              state.tab === "done"
                ? "tasks.emptyMineDone"
                : state.tab === "mine"
                  ? "tasks.emptyMineAny"
                  : "tasks.emptyMine",
            )}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/tasks${serializeTaskState({ ...state, tab: "all" })}`}>
              {t("tasks.emptySeeAll")}
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-[15px] font-medium text-foreground">
            {t("tasks.emptyTitle")}
          </p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t("tasks.emptyBody")}
          </p>
        </div>
      )}
    </div>
  );
}
