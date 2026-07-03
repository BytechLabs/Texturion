import { ListChecks } from "lucide-react";

import { hasActiveChips, type TaskPageState } from "./task-view-url";

/**
 * The calm empty state (T6.1 / T5.3). Two voices:
 *  - a filtered/tab view with nothing in it → one quiet line ("Nothing here");
 *  - the true first-run all-empty → a one-line sentence that TEACHES promotion
 *    (the discoverability fix — tasks are created only by promoting a message
 *    from its ⋯ menu, T5.3), since there is no standalone "+ Add task".
 *
 * No illustration, generous air (per APP-UI-ELEVATION §3.1 calm empty states).
 */
export function EmptyTasks({ state }: { state: TaskPageState }) {
  const filtered = hasActiveChips(state) || state.tab !== "open";
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
        <p className="text-[15px] text-muted-foreground">Nothing on this list.</p>
      ) : (
        <div className="space-y-1">
          <p className="text-[15px] font-medium text-foreground">No tasks yet.</p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Promote a message from its ⋯ menu in a conversation to track it as a
            task here.
          </p>
        </div>
      )}
    </div>
  );
}
