"use client";

import { formatViewCount } from "@loonext/shared";
import { Bookmark, Check, MoreHorizontal, Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";

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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/error";
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViewCounts,
  useSavedViews,
  useSetDefaultSavedView,
  useUpdateSavedView,
  type SavedView,
} from "@/lib/api/saved-views";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

import type { InboxUrlFilters } from "./filter-url";
import {
  suggestViewName,
  urlFiltersToView,
  viewFiltersToUrl,
  viewMatchesUrl,
} from "./saved-view-filters";

/**
 * #280 — the row of saved views above the inbox filters.
 *
 * # What this is, in one line
 *
 * A strip of named chips that each set the whole filter state at once, plus one
 * affordance for keeping the arrangement currently on screen.
 *
 * Applying: the Safety Principle (a horizontal strip of named queries above a
 * list is where every product puts saved views, and a deviation here would
 * make people cautious about the one thing that has to feel disposable), Zen of
 * Clarity (four secondary actions per view live behind a triple-dot, never
 * inline), Chunking (this row is its own group — wide space below it, tight
 * space within), and Ethical Friction (deleting a view the whole crew opens is
 * confirmed; deleting your own is not, because it is yours and remaking it is
 * two taps).
 *
 * Smart Defaults, applied at the one point of real friction: the save dialog
 * opens with a name already in it, derived from what is filtered. The person
 * has already told us what the view is by building it, and "Open · Unread" is a
 * better name than most people would stop to type.
 *
 * # Why the whole bar disappears when there are no views
 *
 * Until somebody saves one there is nothing to show and a permanent empty rail
 * would be a advertisement occupying the top of the busiest screen in the
 * product. The save affordance instead appears beside the filters, where the
 * arrangement being kept actually lives.
 */
export function SavedViewsBar({
  filters,
  onApply,
}: {
  filters: InboxUrlFilters;
  onApply: (next: InboxUrlFilters) => void;
}) {
  const { role } = useActiveCompany();
  const views = useSavedViews("conversations");
  const rows = useMemo(() => views.data?.data ?? [], [views.data]);
  const defaultId = views.data?.defaults.conversations ?? null;

  const counts = useSavedViewCounts(
    "conversations",
    rows.map((v) => v.id),
    rows.length > 0,
  );

  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<SavedView | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<SavedView | null>(
    null,
  );

  const canShare = role === "owner" || role === "admin";
  const activeId =
    rows.find((view) => viewMatchesUrl(view.filters, filters))?.id ?? null;

  return (
    <>
      {rows.length > 0 && (
        <div
          className="flex items-center gap-1.5 overflow-x-auto px-4 pb-2"
          role="list"
          aria-label="Saved views"
        >
          {rows.map((view) => (
            <ViewChip
              key={view.id}
              view={view}
              active={view.id === activeId}
              isDefault={view.id === defaultId}
              count={counts.data?.counts[view.id]}
              canManage={view.shared ? canShare : true}
              onApply={() => onApply(viewFiltersToUrl(view.filters, filters))}
              onRename={() => setRenaming(view)}
              onConfirmDelete={() => setConfirmingDelete(view)}
            />
          ))}
        </div>
      )}

      <div className="flex px-4 pb-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[13px] text-muted-foreground"
          onClick={() => setSaving(true)}
        >
          <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
          Save this view
        </Button>
      </div>

      <SaveViewDialog
        open={saving}
        onOpenChange={setSaving}
        filters={filters}
        canShare={canShare}
      />
      <RenameViewDialog view={renaming} onClose={() => setRenaming(null)} />
      <DeleteSharedViewDialog
        view={confirmingDelete}
        onClose={() => setConfirmingDelete(null)}
      />
    </>
  );
}

function ViewChip({
  view,
  active,
  isDefault,
  count,
  canManage,
  onApply,
  onRename,
  onConfirmDelete,
}: {
  view: SavedView;
  active: boolean;
  isDefault: boolean;
  count: number | undefined;
  canManage: boolean;
  onApply: () => void;
  onRename: () => void;
  /** Shared views route through the parent's confirmation instead of deleting. */
  onConfirmDelete: () => void;
}) {
  const setDefault = useSetDefaultSavedView();
  const update = useUpdateSavedView();
  const remove = useDeleteSavedView();
  const { role } = useActiveCompany();
  const canShare = role === "owner" || role === "admin";

  return (
    <div
      role="listitem"
      className={cn(
        "group flex h-7 shrink-0 items-center rounded-full border pl-2.5 pr-1 text-[13px] transition-colors duration-150 ease-out",
        active
          ? "border-primary bg-primary/5 text-app-ink"
          : "border-border bg-card text-muted-foreground hover:bg-accent",
      )}
    >
      <button type="button" onClick={onApply} className="flex items-center gap-1.5">
        {view.shared && (
          // The one piece of state worth a permanent icon: whether the whole
          // crew sees this. Everything else is behind the menu.
          <Users className="size-3 shrink-0" strokeWidth={1.75} aria-label="Shared" />
        )}
        <span className="max-w-40 truncate font-medium">{view.name}</span>
        {count !== undefined && count > 0 && (
          <span className="tabular-nums text-muted-foreground">
            {formatViewCount(count)}
          </span>
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Options for ${view.name}`}
            className="ml-0.5 rounded-full p-1 text-muted-foreground hover:bg-accent"
          >
            <MoreHorizontal className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={() =>
              void setDefault.mutateAsync({
                surface: "conversations",
                view_id: isDefault ? null : view.id,
              })
            }
          >
            {isDefault ? (
              <>
                <Check strokeWidth={1.75} aria-hidden />
                Stop opening here
              </>
            ) : (
              <>
                <Bookmark strokeWidth={1.75} aria-hidden />
                Open here by default
              </>
            )}
          </DropdownMenuItem>
          {canManage && (
            <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
          )}
          {canManage && canShare && (
            <DropdownMenuItem
              onSelect={() =>
                void update.mutateAsync({
                  id: view.id,
                  surface: "conversations",
                  shared: !view.shared,
                })
              }
            >
              {view.shared ? "Make it just mine" : "Share with the crew"}
            </DropdownMenuItem>
          )}
          {canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  // Your own view goes immediately; a shared one asks first.
                  if (view.shared) {
                    onConfirmDelete();
                    return;
                  }
                  void remove.mutateAsync({
                    id: view.id,
                    surface: "conversations",
                  });
                }}
              >
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SaveViewDialog({
  open,
  onOpenChange,
  filters,
  canShare,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: InboxUrlFilters;
  canShare: boolean;
}) {
  const create = useCreateSavedView();
  // Smart Defaults: the field is never empty. Recomputed each time the dialog
  // opens, so it describes what is on screen NOW rather than the last time.
  const suggested = useMemo(() => suggestViewName(filters), [filters]);
  const [name, setName] = useState(suggested);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(false);

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(suggested);
      setShared(false);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this view</DialogTitle>
          <DialogDescription>
            The filters you have on now, under a name, one tap away tomorrow.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="saved-view-name">Name</Label>
            <Input
              id="saved-view-name"
              autoFocus
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Monday morning"
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
                <span className="font-medium">Share it with the crew</span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  Everyone gets the same view, and each person sees only the
                  numbers they already have access to.
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
            Cancel
          </Button>
          <Button
            disabled={name.trim() === "" || create.isPending}
            onClick={() => {
              setError(null);
              create
                .mutateAsync({
                  surface: "conversations",
                  name: name.trim(),
                  filters: urlFiltersToView(filters),
                  ...(shared ? { shared: true } : {}),
                })
                .then(() => onOpenChange(false))
                .catch((cause: unknown) => {
                  setError(
                    cause instanceof ApiError
                      ? cause.message
                      : "Could not save that. Try again in a moment.",
                  );
                });
            }}
          >
            {create.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameViewDialog({
  view,
  onClose,
}: {
  view: SavedView | null;
  onClose: () => void;
}) {
  const update = useUpdateSavedView();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);

  if (view !== null && view.id !== lastId) {
    setLastId(view.id);
    setName(view.name);
    setError(null);
  }

  return (
    <Dialog open={view !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename view</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rename-view">Name</Label>
          <Input
            id="rename-view"
            autoFocus
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={name.trim() === "" || update.isPending}
            onClick={() => {
              if (!view) return;
              setError(null);
              update
                .mutateAsync({
                  id: view.id,
                  surface: "conversations",
                  name: name.trim(),
                })
                .then(onClose)
                .catch((cause: unknown) => {
                  setError(
                    cause instanceof ApiError
                      ? cause.message
                      : "Could not rename that. Try again in a moment.",
                  );
                });
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ethical Friction, applied only where it is earned.
 *
 * Deleting your OWN view is immediate: it is yours, and rebuilding it is two
 * taps. Deleting a SHARED one removes a screen the rest of the crew opens every
 * morning, possibly the one they land on, and the person doing it cannot see
 * who that affects. That asymmetry is the whole reason this dialog exists.
 */
function DeleteSharedViewDialog({
  view,
  onClose,
}: {
  view: SavedView | null;
  onClose: () => void;
}) {
  const remove = useDeleteSavedView();
  return (
    <Dialog open={view !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{view?.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            The whole crew uses this one. Anyone who opens the app here will
            land on the ordinary inbox instead.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (!view) return;
              void remove
                .mutateAsync({ id: view.id, surface: "conversations" })
                .then(onClose)
                .catch(onClose);
            }}
          >
            Delete for everyone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
