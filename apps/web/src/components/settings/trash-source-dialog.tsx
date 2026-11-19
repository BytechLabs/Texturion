"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ChoiceCards } from "@/components/ui/choice-cards";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/provider";
import { useTrashSourceTasks } from "@/lib/api/trash";

const COPY = {
  message: { title: "trash.deleteMessage", only: "trash.deleteMessageOnly", both: "trash.deleteMessageAndJob" },
  note: { title: "trash.deleteNote", only: "trash.deleteNoteOnly", both: "trash.deleteNoteAndJob" },
  call: { title: "trash.deleteCall", only: "trash.deleteCallOnly", both: "trash.deleteCallAndJob" },
} as const;

export function TrashSourceDialog({ id, source, pending, onClose, onConfirm }: {
  id: string;
  source: keyof typeof COPY;
  pending: boolean;
  onClose: () => void;
  onConfirm: (includeTasks: boolean) => void;
}) {
  const t = useT();
  const [includeTasks, setIncludeTasks] = useState(false);
  const preview = useTrashSourceTasks(source === "note" ? "message" : source, id);
  const linked = preview.data ?? [];
  const copy = COPY[source];

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => { if (!open && !pending) onClose(); }}
      title={t(copy.title)}
      description={linked.length > 0 ? t("trash.linkedJobErase", {
        number: linked.map((job) => job.number).join(", #"),
      }) : undefined}
      pending={pending}
      confirmLabel={t("trash.moveToTrash")}
      confirmDisabled={preview.isPending || preview.isError}
      onConfirm={() => onConfirm(linked.length > 0 && includeTasks)}
    >
      {preview.isPending && <p role="status" className="text-sm text-muted-foreground">{t("trash.loadingMore")}</p>}
      {preview.isError && (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span role="alert">{t("trash.linkedJobLoadFailed")}</span>
          <Button variant="outline" size="sm" onClick={() => void preview.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {linked.length > 0 && (
        <ChoiceCards
          ariaLabel={t(copy.title)}
          value={includeTasks ? "both" : "source"}
          options={[
            { value: "source", label: t(copy.only) },
            { value: "both", label: t(copy.both) },
          ]}
          onChange={(choice) => setIncludeTasks(choice === "both")}
          disabled={pending}
        />
      )}
    </ConfirmDialog>
  );
}
