"use client";

import { Download, MoreHorizontal, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MergeDialog } from "@/components/contacts/duplicate-contacts-card";
import { Button } from "@/components/ui/button";
import { TagChecklist } from "@/components/ui/tag-checklist";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { undoableToast } from "@/components/ui/optimistic-undo";
import { useT } from "@/i18n/provider";
import {
  useBulkContacts,
  type ContactBulkRequest,
  type DuplicatePair,
} from "@/lib/api/contacts";
import { useExportContacts } from "@/lib/api/contacts-export-hook";
import { ApiError } from "@/lib/api/error";
import { useTags } from "@/lib/api/tags";
import type { ContactListItem } from "@/lib/api/types";
import { useCanDeleteRecords } from "@/lib/hooks/use-records-delete";

/**
 * #695 - the selection bar over the customer list.
 *
 * Appears only when something is selected and sits above the rows, so the row
 * just ticked does not jump out from under the pointer (the inbox bar's rule).
 *
 * *Chunking.* Four things are visible: Tag, Untag, Export, and one "More" menu
 * holding the two the crew reaches for least (merge, delete). The brain holds
 * three or four.
 *
 * *Ethical Friction.* Tag and untag are reversible, so they apply at once and
 * offer an Undo toast built from what the server says it changed. Delete is the
 * only thing here that cannot be taken back, so it asks first
 * (docs/UNDO-AUDIT.md).
 *
 * There is no bulk text. Selecting customers and composing to all of them is a
 * mass-texting tool, which this product deliberately does not have.
 */
export function ContactsBulkBar({
  selected,
  canEdit,
  canMerge,
  onClear,
}: {
  selected: ContactListItem[];
  /** Tagging, untagging and deleting need `conversations.note`. */
  canEdit: boolean;
  /** Merging needs `settings.manage`, the same gate as the merge route. */
  canMerge: boolean;
  onClear: () => void;
}) {
  const t = useT();
  const canDeleteRecords = useCanDeleteRecords();
  const tags = useTags();
  const bulk = useBulkContacts();
  const exportContacts = useExportContacts();
  const [merging, setMerging] = useState<DuplicatePair | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const ids = selected.map((row) => row.id);
  const tagList = tags.data?.data ?? [];

  function run(request: ContactBulkRequest, onDone: (applied: string[]) => void) {
    bulk.mutate(request, {
      onSuccess: (result) => {
        if (result.failed.length > 0) {
          toast.warning(t("contacts.bulkSomeMissing", { count: result.failed.length }));
        }
        onDone(result.applied.map((row) => row.id));
      },
      onError: (cause) =>
        toast.error(
          cause instanceof ApiError ? cause.message : t("contacts.bulkFailed"),
        ),
    });
  }

  function changeTag(action: "add_tag" | "remove_tag", tagId: string, tagName: string) {
    run({ action, ids, tag_id: tagId }, (applied) => {
      if (applied.length === 0) {
        toast(t("contacts.bulkNothingChanged"));
        return;
      }
      const inverse = action === "add_tag" ? "remove_tag" : "add_tag";
      undoableToast({
        undoLabel: t("thread.undo"),
        message: t(
          action === "add_tag" ? "contacts.bulkTagged" : "contacts.bulkUntagged",
          { count: applied.length, tag: tagName },
        ),
        // Only the rows that actually changed go back, so an undo never strips
        // a tag somebody already had.
        onUndo: () =>
          run({ action: inverse, ids: applied, tag_id: tagId }, () => undefined),
      });
    });
  }

  const mergePair: DuplicatePair | null =
    selected.length === 2
      ? {
          contact_a: selected[0].id,
          name_a: selected[0].name,
          phone_a: selected[0].phone_e164,
          contact_b: selected[1].id,
          name_b: selected[1].name,
          phone_b: selected[1].phone_e164,
          reason: "",
        }
      : null;

  return (
    <div
      role="region"
      aria-label={t("contacts.bulkSelected", { count: selected.length })}
      className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-muted/40 px-3 py-2"
    >
      <span className="text-sm font-medium tabular-nums">
        {t("contacts.bulkSelected", { count: selected.length })}
      </span>
      <TagChecklist
        label={t("contacts.bulkTags")}
        tags={tagList}
        itemTagIds={selected.map((row) => (row.tags ?? []).map((tag) => tag.id))}
        selectionKey={ids.join(",")}
        emptyLabel={t("contacts.bulkNoTags")}
        disabled={!canEdit || bulk.isPending}
        onToggle={(tag, action) =>
          changeTag(action === "add" ? "add_tag" : "remove_tag", tag.id, tag.name)
        }
      />
      <Button
        variant="outline"
        size="sm"
        disabled={exportContacts.isPending}
        onClick={() =>
          exportContacts.mutate(
            { q: "", ids },
            {
              onError: (cause) =>
                toast.error(
                  cause instanceof ApiError
                    ? cause.message
                    : t("contacts.exportFailed"),
                ),
            },
          )
        }
      >
        <Download className="size-3.5" strokeWidth={1.75} aria-hidden />
        {t("contacts.bulkExport")}
      </Button>

      {/* #713: both items are role-gated; with neither, the menu would open empty. */}
      {(canMerge || canDeleteRecords) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("contacts.bulkMore")}
            >
              <MoreHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {canMerge && (
              <DropdownMenuItem
                disabled={mergePair === null}
                onSelect={() => setMerging(mergePair)}
              >
                {mergePair === null
                  ? t("contacts.bulkMergeNeedsTwo")
                  : t("contacts.bulkMerge")}
              </DropdownMenuItem>
            )}
            {canDeleteRecords && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setConfirmingDelete(true)}
              >
                {t("contacts.bulkDelete")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={onClear}
        aria-label={t("contacts.bulkClear")}
      >
        <X className="size-3.5" strokeWidth={1.75} aria-hidden />
        {t("contacts.bulkClear")}
      </Button>

      <MergeDialog pair={merging} onClose={() => setMerging(null)} />

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("contacts.bulkDeleteTitle", { count: selected.length })}
        description={t("contacts.bulkDeleteBody")}
        confirmLabel={t("contacts.bulkDeleteConfirm", { count: selected.length })}
        pending={bulk.isPending}
        onConfirm={() =>
          run({ action: "delete", ids }, (applied) => {
            setConfirmingDelete(false);
            toast.success(t("contacts.bulkDeleted", { count: applied.length }));
            onClear();
          })
        }
      />
    </div>
  );
}
