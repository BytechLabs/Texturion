"use client";

import { formatViewCount, type SavedViewFilters, type SavedViewSurface } from "@loonext/shared";
import { Bookmark, Check, Pencil, Star, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  useSavedViewCounts,
  useSavedViews,
  useSetDefaultSavedView,
  useUpdateSavedView,
  type SavedView,
} from "@/lib/api/saved-views";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

/**
 * #711: the one Views control every list uses, beside its Filter button.
 *
 * The menu applies a view in one click. "Save these filters as a view…" shows
 * only when the filters on screen match no saved view, because saving what is
 * already saved is a second copy. Opening by default, renaming, sharing and
 * deleting live in Manage views, out of the way of the everyday choice.
 * *Applying: Zen of Clarity (secondary actions behind a menu) and Chunking (one
 * control for one concept).*
 */
export function SavedViewsMenu({
  surface,
  isCurrent,
  onApply,
  currentFilters,
  suggestName,
  hasFilters,
  saveDescription,
  shareNote,
  compact = false,
}: {
  surface: SavedViewSurface;
  /** Whether a saved view's filters are what is on screen. */
  isCurrent: (filters: SavedViewFilters) => boolean;
  onApply: (filters: SavedViewFilters) => void;
  /** The filters on screen, as a view stores them. */
  currentFilters: () => SavedViewFilters;
  /** A name describing the filters on screen, so the save field is never empty. */
  suggestName: () => string;
  /** Something is filtered, so there is something to save. */
  hasFilters: boolean;
  saveDescription: string;
  shareNote: string;
  /** An icon button for a narrow list column; the label shows otherwise. */
  compact?: boolean;
}) {
  const t = useT();
  const { role } = useActiveCompany();
  const views = useSavedViews(surface);
  const rows = useMemo(() => views.data?.data ?? [], [views.data]);
  const counts = useSavedViewCounts(surface, rows.map((view) => view.id), rows.length > 0);
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);
  const canShare = role === "owner" || role === "admin";

  const current = rows.find((view) => isCurrent(view.filters));
  const label = current ? current.name : t("inbox.viewsMenu");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={compact ? "icon-sm" : "sm"}
            aria-label={compact ? t("inbox.viewsMenuAria", { current: label }) : undefined}
            title={compact ? label : undefined}
            className={cn("shrink-0 text-muted-foreground", current && "text-app-ink")}
          >
            <Bookmark
              className="size-4"
              strokeWidth={1.75}
              fill={current ? "currentColor" : "none"}
              aria-hidden
            />
            {!compact && <span className="max-w-32 truncate">{label}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {rows.length === 0 ? (
            <DropdownMenuLabel className="text-[13px] font-normal text-muted-foreground">
              {t("tasks.viewsNone")}
            </DropdownMenuLabel>
          ) : (
            rows.map((view) => {
              const count = counts.data?.counts[view.id];
              return (
                <DropdownMenuItem key={view.id} onSelect={() => onApply(view.filters)}>
                  {view.shared && (
                    <Users
                      className="size-3.5 shrink-0"
                      strokeWidth={1.75}
                      aria-label={t("inbox.viewSharedAria")}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{view.name}</span>
                  {count !== undefined && count > 0 && (
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {formatViewCount(count)}
                    </span>
                  )}
                  {current?.id === view.id && (
                    <Check className="size-4 text-primary" strokeWidth={1.75} aria-hidden />
                  )}
                </DropdownMenuItem>
              );
            })
          )}
          {((hasFilters && !current) || rows.length > 0) && <DropdownMenuSeparator />}
          {hasFilters && !current && (
            <DropdownMenuItem onSelect={() => setSaving(true)}>
              {t("inbox.viewsSaveCurrent")}
            </DropdownMenuItem>
          )}
          {rows.length > 0 && (
            <DropdownMenuItem onSelect={() => setManaging(true)}>
              {t("inbox.viewsManage")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SaveViewDialog
        open={saving}
        onOpenChange={setSaving}
        surface={surface}
        filters={currentFilters}
        suggestName={suggestName}
        canShare={canShare}
        description={saveDescription}
        shareNote={shareNote}
      />
      <ManageViewsDialog
        open={managing}
        onOpenChange={setManaging}
        surface={surface}
        views={rows}
        defaultId={views.data?.defaults[surface] ?? null}
        canShare={canShare}
      />
    </>
  );
}

function SaveViewDialog({
  open,
  onOpenChange,
  surface,
  filters,
  suggestName,
  canShare,
  description,
  shareNote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: SavedViewSurface;
  filters: () => SavedViewFilters;
  suggestName: () => string;
  canShare: boolean;
  description: string;
  shareNote: string;
}) {
  const t = useT();
  const create = useCreateSavedView();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(false);

  // Smart Defaults: recomputed each time it opens, so the suggested name
  // describes what is on screen now.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(suggestName());
      setShared(false);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("inbox.viewsSave")}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="saved-view-name">{t("inbox.viewNameLabel")}</Label>
            <Input
              id="saved-view-name"
              autoFocus
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("inbox.viewNamePlaceholder")}
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
                  {shareNote}
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
                  surface,
                  name: name.trim(),
                  filters: filters(),
                  ...(shared ? { shared: true } : {}),
                })
                .then(() => onOpenChange(false))
                .catch((cause: unknown) => {
                  setError(cause instanceof ApiError ? cause.message : t("inbox.viewSaveFailed"));
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

/**
 * Every view's settings in one place. Deleting your own view is immediate,
 * since rebuilding it is two taps; deleting a shared one asks first, because it
 * removes a screen the rest of the crew may open every morning.
 */
function ManageViewsDialog({
  open,
  onOpenChange,
  surface,
  views,
  defaultId,
  canShare,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: SavedViewSurface;
  views: SavedView[];
  defaultId: string | null;
  canShare: boolean;
}) {
  const t = useT();
  const setDefault = useSetDefaultSavedView();
  const update = useUpdateSavedView();
  const remove = useDeleteSavedView();
  const [renaming, setRenaming] = useState<SavedView | null>(null);
  const [deleting, setDeleting] = useState<SavedView | null>(null);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inbox.viewsManage")}</DialogTitle>
          </DialogHeader>
          <ul className="divide-y rounded-lg border">
            {views.map((view) => {
              const isDefault = view.id === defaultId;
              const canManage = view.shared ? canShare : true;
              return (
                <li key={view.id} className="flex items-center gap-1 py-1 pl-3 pr-1">
                  {view.shared && (
                    <Users
                      className="size-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                      aria-label={t("inbox.viewSharedAria")}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{view.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-pressed={isDefault}
                    aria-label={t(
                      isDefault ? "inbox.viewStopOpeningHere" : "inbox.viewOpenHereByDefault",
                    )}
                    title={t(isDefault ? "inbox.viewStopOpeningHere" : "inbox.viewOpenHereByDefault")}
                    onClick={() =>
                      void setDefault.mutateAsync({ surface, view_id: isDefault ? null : view.id })
                    }
                  >
                    <Star
                      className={cn("size-4", isDefault && "text-primary")}
                      strokeWidth={1.75}
                      fill={isDefault ? "currentColor" : "none"}
                      aria-hidden
                    />
                  </Button>
                  {canManage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("inbox.viewRenameAria", { name: view.name })}
                      onClick={() => setRenaming(view)}
                    >
                      <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
                    </Button>
                  )}
                  {canManage && canShare && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-pressed={view.shared}
                      aria-label={t(view.shared ? "inbox.viewMakeMine" : "inbox.viewShareWithCrew")}
                      title={t(view.shared ? "inbox.viewMakeMine" : "inbox.viewShareWithCrew")}
                      onClick={() =>
                        void update.mutateAsync({ id: view.id, surface, shared: !view.shared })
                      }
                    >
                      <Users
                        className={cn("size-4", view.shared && "text-primary")}
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("inbox.viewDeleteAria", { name: view.name })}
                      className="hover:text-destructive"
                      onClick={() => {
                        if (view.shared) setDeleting(view);
                        else void remove.mutateAsync({ id: view.id, surface });
                      }}
                    >
                      <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RenameViewDialog view={renaming} surface={surface} onClose={() => setRenaming(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={t("inbox.viewDeleteTitle", { name: deleting?.name ?? "" })}
        description={t("inbox.viewDeleteBody")}
        cancelLabel={t("inbox.viewDeleteKeep")}
        confirmLabel={t("inbox.viewDeleteConfirm")}
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          void remove
            .mutateAsync({ id: deleting.id, surface })
            .finally(() => setDeleting(null));
        }}
      />
    </>
  );
}

function RenameViewDialog({
  view,
  surface,
  onClose,
}: {
  view: SavedView | null;
  surface: SavedViewSurface;
  onClose: () => void;
}) {
  const t = useT();
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
          <DialogTitle>{t("inbox.viewRenameTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rename-view">{t("inbox.viewNameLabel")}</Label>
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
            {t("common.cancel")}
          </Button>
          <Button
            disabled={name.trim() === "" || update.isPending}
            onClick={() => {
              if (!view) return;
              setError(null);
              update
                .mutateAsync({ id: view.id, surface, name: name.trim() })
                .then(onClose)
                .catch((cause: unknown) => {
                  setError(cause instanceof ApiError ? cause.message : t("inbox.viewRenameFailed"));
                });
            }}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
