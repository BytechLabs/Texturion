"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { LoadError, SettingsPage } from "@/components/settings/section";
import { TagManagementCard } from "@/components/settings/tag-management-card";
import { Button } from "@/components/ui/button";
import { useActiveCompany } from "@/lib/company/provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useDeleteTemplate, useTemplates } from "@/lib/api/templates";
import type { Template } from "@/lib/api/types";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";

import { groupTemplates } from "./grouping";
import { TemplateDialog } from "./template-dialog";

function TemplateRow({
  template,
  editorName,
  onEdit,
  onDelete,
}: {
  template: Template;
  /** #419: who last changed it, when we can name them. */
  editorName: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{template.name}</p>
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {template.body}
        </p>
        <p
          className="mt-1 text-xs text-muted-foreground"
          title={formatAbsoluteDateTime(template.updated_at)}
        >
          {/* #419: not a permission — visibility. A template is the only
              object here where one person's edit changes what everyone else
              says to customers, and in a crew of ten "Sam changed this on
              Tuesday" settles the question before it becomes a dispute.
              The name is omitted rather than guessed when the editor has
              left the crew or predates the column.
              *Applying: G10 — system states must be precise.* */}
          {t("appShell.templateUpdatedAgo", {
            when: formatRelativeTime(template.updated_at),
          })}
          {editorName !== null &&
            t("appShell.templateUpdatedBy", { name: editorName })}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          aria-label={t("appShell.templateEditAria", { name: template.name })}
        >
          {t("appShell.templateEdit")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label={t("appShell.templateDeleteAria", { name: template.name })}
        >
          {t("common.delete")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Settings → Templates (G8): saved replies — list, create, edit, delete. Lives
 * under the settings shell like every other section (it used to be a top-level
 * /templates route, which read as its own page); /templates now redirects here.
 */
export default function TemplatesSettingsPage() {
  const t = useT();
  const templates = useTemplates();
  const deleteTemplate = useDeleteTemplate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);

  const { role } = useActiveCompany();
  // #461: curating the shared set is admin's — a template is words the whole
  // crew sends in the business's name. Using them is untouched: the composer's
  // "/" picker reads the same list and every member still has it. Without this
  // a member deep-linking here would see buttons the API answers with 403.
  const canCurate = role === "owner" || role === "admin";

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(template: Template) {
    setEditing(template);
    setDialogOpen(true);
  }

  return (
    <SettingsPage
      title={t("appShell.templatesTitle")}
      // #298: tags live here rather than in a section of their own. They are
      // the other thing a crew curates together, and the marketing already
      // pairs them at /features/templates-and-tags — inventing a fifteenth
      // settings section for one list would be a worse answer than joining the
      // one it belongs beside.
      description={t("appShell.templatesDescription")}
    >
      <div className="space-y-4">
        {canCurate ? (
          <div className="flex justify-end">
            <Button onClick={openCreate}>
              <Plus strokeWidth={1.75} aria-hidden />
              {t("appShell.templateNew")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("appShell.templatesReadOnlyNote")}
          </p>
        )}

        {templates.isPending ? (
          <div className="space-y-2" aria-label={t("appShell.templatesLoading")}>
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : templates.isError ? (
          <LoadError onRetry={() => templates.refetch()} />
        ) : templates.data.data.length === 0 ? (
          <div className="rounded-lg border bg-card px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {t("appShell.templatesEmpty")}
            </p>
            {canCurate && (
              <Button className="mt-4" onClick={openCreate}>
                {t("appShell.templatesCreateFirst")}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {groupTemplates(templates.data.data).map((group) => (
              <div key={group.label ?? "__ungrouped"} className="space-y-2">
                {/* #274: the heading appears only once a workspace has actually
                    grouped something. A single "Uncategorised" band over every
                    template in a five-template shop is chrome that describes
                    nothing. */}
                {group.label !== null && (
                  <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </h3>
                )}
                <div className="divide-y rounded-lg border bg-card">
                  {group.rows.map((template) => (
                    <TemplateRow
                      key={template.id}
                      template={template}
                      editorName={template.updated_by_name}
                      onEdit={() => openEdit(template)}
                      onDelete={() => setDeleting(template)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <TemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={editing}
      />

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("appShell.templateDeleteTitle", {
                name: deleting?.name ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("appShell.templateDeleteBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t("appShell.templateKeepIt")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteTemplate.isPending}
              onClick={() => {
                if (!deleting) return;
                deleteTemplate.mutate(deleting.id, {
                  onSuccess: () => {
                    setDeleting(null);
                    toast.success(t("appShell.templateDeleted"));
                  },
                  onError: (cause) =>
                    toast.error(
                      cause instanceof ApiError
                        ? cause.message
                        : t("appShell.templateDeleteFailed"),
                    ),
                });
              }}
            >
              {deleteTemplate.isPending
                ? t("appShell.templateDeleting")
                : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* #298: the tag list, ordered by use. The near-duplicates sit next to
          each other with wildly different counts, and the dead ones collect at
          the bottom — which is the whole of "see the sprawl". */}
      <TagManagementCard canManage={canCurate} />
    </SettingsPage>
  );
}
