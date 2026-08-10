"use client";

import { useState } from "react";
import { Plus, RotateCcw, Archive } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsCard } from "@/components/settings/section";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  useCreateLeadSource,
  useLeadSources,
  useUpdateLeadSource,
} from "@/lib/api/lead-sources";

/**
 * #301 — the workspace's own words for where customers come from.
 *
 * Design notes, and the principles behind them:
 *
 * - **The list starts empty, and the card says what to do with it.** A
 *   taxonomy we chose would be wrong for everyone: "Neighbour" matters to a
 *   plumber and "Trade counter" to an electrician. Same argument #298 settled
 *   for tags — suggest, never impose. So instead of seeding names, the empty
 *   state names the two ways attribution actually happens, in the order of
 *   effort. *Applying: Prioritize Intent.*
 *
 * - **The field is pre-filled with a suggestion.** An empty required box is a
 *   blank page, and the fastest first source for most of this trade is the one
 *   on the van. *Applying: Smart Defaults — never an empty form.*
 *
 * - **Archive, never delete, and the copy says why.** Removing a source would
 *   erase where existing customers came from; the button says "Archive" and
 *   the explanation says the history stays. *Applying: Ethical Friction on the
 *   action whose damage is invisible from this screen.*
 *
 * - **Archived rows stay visible, greyed, with a way back.** Hiding them would
 *   leave an owner unable to explain why a name they retired still appears in
 *   last quarter's report.
 */
export function LeadSourcesCard({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const sources = useLeadSources();
  const create = useCreateLeadSource();
  const update = useUpdateLeadSource();
  const defaultName = t("settings.leadSourceDefaultName");
  const [name, setName] = useState(defaultName);

  const rows = sources.data?.data ?? [];
  const active = rows.filter((row) => row.archived_at === null);
  const archived = rows.filter((row) => row.archived_at !== null);

  async function add() {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    try {
      await create.mutateAsync(trimmed);
      setName(defaultName);
      toast.success(t("settings.leadSourceAdded", { name: trimmed }));
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settings.leadSourceAddFailed"),
      );
    }
  }

  async function setArchived(id: string, archived: boolean) {
    try {
      await update.mutateAsync({ id, archived });
      toast.success(
        archived
          ? t("settings.leadSourceArchived")
          : t("settings.leadSourceRestored"),
      );
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settings.leadSourceSaveFailed"),
      );
    }
  }

  return (
    <SettingsCard
      title={t("settings.leadSourcesTitle")}
      description={t("settings.leadSourcesDescription")}
    >
      <div className="space-y-4">
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("settings.leadSourcesEmpty")}
          </p>
        )}

        {active.length > 0 && (
          <ul className="space-y-2">
            {active.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 border-b border-border-subtle pb-2 last:border-b-0 last:pb-0"
              >
                <span className="min-w-[9rem] text-sm">{row.name}</span>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-auto px-1.5 py-0.5 text-[12px]"
                    disabled={update.isPending}
                    onClick={() => void setArchived(row.id, true)}
                  >
                    <Archive className="mr-1 size-3.5" />
                    {t("settings.leadSourceArchiveAction")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {archived.length > 0 && (
          <div className="space-y-2">
            <p className="text-[12px] text-app-muted-2">
              {t("settings.leadSourcesArchivedNote")}
            </p>
            <ul className="space-y-2">
              {archived.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3">
                  <span className="min-w-[9rem] text-sm text-muted-foreground line-through">
                    {row.name}
                  </span>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-auto px-1.5 py-0.5 text-[12px]"
                      disabled={update.isPending}
                      onClick={() => void setArchived(row.id, false)}
                    >
                      <RotateCcw className="mr-1 size-3.5" />
                      {t("settings.leadSourceRestoreAction")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1 space-y-1.5">
              <Label htmlFor="lead-source-name">
                {t("settings.leadSourceAddLabel")}
              </Label>
              <Input
                id="lead-source-name"
                value={name}
                maxLength={40}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <Button
              onClick={() => void add()}
              disabled={create.isPending || name.trim().length === 0}
            >
              <Plus className="mr-1.5 size-4" />
              {create.isPending
                ? t("settings.leadSourceAdding")
                : t("settings.addAction")}
            </Button>
          </div>
        )}

        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            {t("settings.leadSourcesAdminOnly")}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

/*
 * The suggestion in the box — `settings.leadSourceDefaultName` — is the fastest
 * first source for most of this trade, so the field is never blank. Editable,
 * obviously, but somebody who has never thought about attribution should not
 * have to invent a vocabulary before they can add the first entry.
 */
