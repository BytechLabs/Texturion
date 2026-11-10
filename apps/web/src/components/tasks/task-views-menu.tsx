"use client";

import { Bookmark, Check } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  type SavedView,
} from "@/lib/api/saved-views";
import { useActiveCompany } from "@/lib/company/provider";

import {
  taskStateToView,
  taskViewMatches,
  viewToTaskState,
} from "./task-saved-views";
import type { TaskPageState } from "./task-view-url";

/**
 * #689 G: the tasks page's saved views, in one small menu.
 *
 * Applying a view sets the filters, the sort and the board grouping at once and
 * leaves the layout (list, board, calendar, map) and the search box alone. The
 * current state is already in the URL, so sharing a view with someone is
 * copying the address bar; saving one is for the arrangement you reopen.
 *
 * Applying: Zen of Clarity (one control, saved views behind it, not a second
 * row of chips) and Ethical Friction (deleting a view the whole crew opens
 * asks first; deleting your own does not).
 */
export function TaskViewsMenu({
  state,
  onChange,
}: {
  state: TaskPageState;
  onChange: (next: TaskPageState) => void;
}) {
  const t = useT();
  const { userId, role } = useActiveCompany();
  const views = useSavedViews("tasks");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<SavedView | null>(null);
  const remove = useDeleteSavedView();
  const canShare = role === "owner" || role === "admin";

  const list = views.data?.data ?? [];
  const current = list.find((view) => taskViewMatches(view.filters, state, userId));
  const canDeleteCurrent = current !== undefined && (!current.shared || canShare);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("tasks.viewsAria")}
            className="tap-target inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:bg-secondary hover:text-foreground"
          >
            <Bookmark className="size-3" strokeWidth={1.75} aria-hidden />
            {current ? current.name : t("tasks.views")}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {list.length === 0 ? (
            <DropdownMenuLabel className="text-[13px] font-normal text-muted-foreground">
              {t("tasks.viewsNone")}
            </DropdownMenuLabel>
          ) : (
            list.map((view) => (
              <DropdownMenuItem
                key={view.id}
                onSelect={() => onChange(viewToTaskState(view.filters, userId, state))}
              >
                <span className="truncate">{view.name}</span>
                {current?.id === view.id && (
                  <Check className="ml-auto size-4 text-primary" strokeWidth={1.75} />
                )}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaving(true)}>
            {t("inbox.viewsSave")}
          </DropdownMenuItem>
          {canDeleteCurrent && current && (
            <DropdownMenuItem
              onSelect={() => {
                if (current.shared) setDeleting(current);
                else void remove.mutateAsync({ id: current.id, surface: "tasks" });
              }}
            >
              {t("tasks.viewDelete", { name: current.name })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SaveTaskViewDialog
        open={saving}
        onOpenChange={setSaving}
        state={state}
        canShare={canShare}
      />

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inbox.viewDeleteTitle", { name: deleting?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("inbox.viewDeleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t("inbox.viewDeleteKeep")}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                void remove
                  .mutateAsync({ id: deleting.id, surface: "tasks" })
                  .finally(() => setDeleting(null));
              }}
            >
              {t("inbox.viewDeleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SaveTaskViewDialog({
  open,
  onOpenChange,
  state,
  canShare,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: TaskPageState;
  canShare: boolean;
}) {
  const t = useT();
  const { userId } = useActiveCompany();
  const create = useCreateSavedView();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(false);

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(suggestTaskViewName(state, t));
      setShared(false);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("inbox.viewsSave")}</DialogTitle>
          <DialogDescription>{t("tasks.viewSaveDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-view-name">{t("inbox.viewNameLabel")}</Label>
            <Input
              id="task-view-name"
              autoFocus
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {canShare && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              <span className="text-sm">
                <span className="font-medium">{t("inbox.viewShareToggle")}</span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  {t("tasks.viewShareNote")}
                </span>
              </span>
            </label>
          )}
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={name.trim() === "" || create.isPending}
            onClick={() => {
              setError(null);
              create
                .mutateAsync({
                  surface: "tasks",
                  name: name.trim(),
                  filters: taskStateToView(state, userId),
                  ...(shared ? { shared: true } : {}),
                })
                .then(() => onOpenChange(false))
                .catch((cause: unknown) => {
                  setError(
                    cause instanceof ApiError ? cause.message : t("inbox.viewSaveFailed"),
                  );
                });
            }}
          >
            {create.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A name for what is on screen, so the field is never empty. */
function suggestTaskViewName(state: TaskPageState, t: ReturnType<typeof useT>): string {
  if (state.refs) return t("tasks.hasLinks");
  if (state.files) return t("tasks.hasFiles");
  if (state.due === "overdue") return t("tasks.overdue");
  if (state.source) {
    const source = {
      text: t("tasks.sourceText"),
      call: t("tasks.sourceCall"),
      none: t("tasks.sourceNone"),
    }[state.source];
    return t("tasks.chipSource", { source });
  }
  if (state.tab === "all") return t("tasks.tabAll");
  if (state.tab === "done") return t("tasks.tabDone");
  if (state.tab === "mine") return t("tasks.tabMine");
  return t("tasks.tabOpen");
}
