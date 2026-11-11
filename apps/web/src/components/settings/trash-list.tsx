"use client";

import { ListSkeleton } from "@/components/ui/list-skeleton";
import { Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SettingsCard } from "@/components/settings/section";
import { LoadError } from "@/components/ui/load-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useMembers } from "@/lib/api/team";
import {
  usePurgeTrashItem,
  useRestoreFromTrash,
  useTrash,
  type TrashRow,
} from "@/lib/api/trash";
import { useActiveCompany } from "@/lib/company/provider";
import { formatTimestamp } from "@/lib/format/time";
import { EmptyState } from "@/components/ui/empty-state";
import {
  daysLeftLabel,
  detailLabel,
  kindLabel,
  whoLabel,
} from "@/lib/settings/trash-row";

/**
 * #691 — the Trash: everything deleted in the last 30 days, with the two
 * things a person can do to it.
 *
 * Restore is one click and says so; it is the safe direction. Delete forever is
 * the opposite and is drawn that way: a quiet text button that opens a dialog
 * naming exactly what will be erased, stating that it cannot be undone, and
 * keeping the confirm button disabled until the person types the word. A
 * pointed-at row is not enough warning for something with no way back.
 * *Applying: Ethical Friction, Loss Aversion.*
 */
export function TrashList() {
  const t = useT();
  const trash = useTrash();
  // Not flattenPages: it dedupes by id, and a call and its voicemail share one.
  const rows = trash.data?.pages.flatMap((page) => page.data) ?? [];
  const [purging, setPurging] = useState<TrashRow | null>(null);

  if (trash.isError) return <LoadError onRetry={() => void trash.refetch()} />;

  if (trash.isPending) {
    return (
      <SettingsCard>
        <ListSkeleton rows={3} className="p-4" />
      </SettingsCard>
    );
  }

  if (rows.length === 0) {
    return (
      <SettingsCard>
        <EmptyState
          size="panel"
          icon={<Trash2 strokeWidth={1.75} />}
          title={t("trash.emptyTitle")}
          description={t("trash.emptyBody")}
        />
      </SettingsCard>
    );
  }

  return (
    <>
      <SettingsCard>
        <ul className="divide-y">
          {rows.map((row) => (
            <TrashItem
              key={`${row.kind}:${row.id}`}
              row={row}
              onPurge={() => setPurging(row)}
            />
          ))}
        </ul>
        {trash.hasNextPage && (
          <div className="border-t p-3 text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void trash.fetchNextPage()}
              disabled={trash.isFetchingNextPage}
            >
              {trash.isFetchingNextPage
                ? t("trash.loadingMore")
                : t("trash.loadMore")}
            </Button>
          </div>
        )}
      </SettingsCard>
      <PurgeDialog row={purging} onClose={() => setPurging(null)} />
    </>
  );
}

function TrashItem({ row, onPurge }: { row: TrashRow; onPurge: () => void }) {
  const t = useT();
  const restore = useRestoreFromTrash();
  const members = useMembers();
  const { userId } = useActiveCompany();

  const deletedBy =
    row.deleted_by_user_id === null
      ? null
      : row.deleted_by_user_id === userId
        ? t("trash.you")
        : (members.data?.data.find((m) => m.user_id === row.deleted_by_user_id)
            ?.display_name ?? t("trash.someone"));
  const when = formatTimestamp(row.deleted_at, { style: "long", t });

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[15px] leading-snug">
          <span className="font-medium">{whoLabel(row, t)}</span>
          <span className="text-muted-foreground"> · {kindLabel(row, t)}</span>
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {detailLabel(row, t)}
        </p>
        <p className="text-xs text-muted-foreground">
          {deletedBy
            ? t("trash.deletedByLine", { when, who: deletedBy })
            : t("trash.deletedByUnknown", { when })}
          {" · "}
          {daysLeftLabel(row.purge_after, t)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={restore.isPending}
          onClick={() =>
            restore.mutate([{ kind: row.kind, id: row.id }], {
              onSuccess: () => toast.success(t("trash.restored")),
              onError: (error) =>
                // A 409 here is "restore the conversation first": the server
                // wrote that sentence, so show it.
                toast.error(
                  error instanceof ApiError
                    ? error.message
                    : t("trash.restoreFailed"),
                ),
            })
          }
        >
          <Undo2 className="size-4" strokeWidth={1.75} aria-hidden />
          {restore.isPending ? t("trash.restoring") : t("trash.restore")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={onPurge}
        >
          {t("trash.deleteForever")}
        </Button>
      </div>
    </li>
  );
}

/**
 * Delete forever. Typed confirmation, named target, plain statement that it
 * cannot be undone. The server can still refuse (a legal hold), and says why.
 */
function PurgeDialog({
  row,
  onClose,
}: {
  row: TrashRow | null;
  onClose: () => void;
}) {
  const t = useT();
  const purge = usePurgeTrashItem();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const word = t("trash.confirmWord");
  const matches = typed.trim().toLocaleUpperCase(t.locale) === word;

  const close = () => {
    setTyped("");
    setError(null);
    onClose();
  };

  return (
    <ConfirmDialog
      open={row !== null}
      onOpenChange={(open) => !open && close()}
      title={t("trash.deleteForeverTitle")}
      description={
        row
          ? t("trash.deleteForeverBody", {
              what: `${kindLabel(row, t)} · ${whoLabel(row, t)}`,
            })
          : null
      }
      cancelLabel={t("trash.keep")}
      confirmLabel={t("trash.deleteForeverConfirm")}
      pendingLabel={t("trash.deleteForeverWorking")}
      pending={purge.isPending}
      confirmDisabled={!matches || row === null}
      onConfirm={() => {
        if (!row) return;
        setError(null);
        purge.mutate(
          { kind: row.kind, id: row.id },
          {
            onSuccess: () => {
              toast.success(t("trash.deletedForever"));
              close();
            },
            onError: (cause) =>
              setError(
                cause instanceof ApiError
                  ? cause.message
                  : t("trash.deleteForeverFailed"),
              ),
          },
        );
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="purge-confirm">
          {t("trash.deleteForeverType", { word })}
        </Label>
        <Input
          id="purge-confirm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </ConfirmDialog>
  );
}
