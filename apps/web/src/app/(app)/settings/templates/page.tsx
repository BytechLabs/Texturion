"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { LoadError, SettingsPage } from "@/components/settings/section";
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
import { ApiError } from "@/lib/api/error";
import { useDeleteTemplate, useTemplates } from "@/lib/api/templates";
import type { Template } from "@/lib/api/types";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";

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
          Updated {formatRelativeTime(template.updated_at)}
          {editorName !== null && ` by ${editorName}`}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          aria-label={`Edit template ${template.name}`}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label={`Delete template ${template.name}`}
        >
          Delete
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
      title="Templates"
      description="Saved replies your team can send in one tap. Type / in the composer to insert one."
    >
      <div className="space-y-4">
        {canCurate ? (
          <div className="flex justify-end">
            <Button onClick={openCreate}>
              <Plus strokeWidth={1.75} aria-hidden />
              New template
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Anyone can send these — type / in the composer. Only an owner or
            admin can add or change them.
          </p>
        )}

        {templates.isPending ? (
          <div className="space-y-2" aria-label="Loading templates">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : templates.isError ? (
          <LoadError onRetry={() => templates.refetch()} />
        ) : templates.data.data.length === 0 ? (
          <div className="rounded-lg border bg-card px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No templates yet. Save a reply you type all the time, then insert
              it with / in the composer.
            </p>
            {canCurate && (
              <Button className="mt-4" onClick={openCreate}>
                Create your first template
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {templates.data.data.map((template) => (
              <TemplateRow
                key={template.id}
                template={template}
                editorName={template.updated_by_name}
                onEdit={() => openEdit(template)}
                onDelete={() => setDeleting(template)}
              />
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
            <DialogTitle>Delete &quot;{deleting?.name}&quot;?</DialogTitle>
            <DialogDescription>
              It disappears from the composer&apos;s / picker for the whole
              team. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={deleteTemplate.isPending}
              onClick={() => {
                if (!deleting) return;
                deleteTemplate.mutate(deleting.id, {
                  onSuccess: () => {
                    setDeleting(null);
                    toast.success("Template deleted.");
                  },
                  onError: (cause) =>
                    toast.error(
                      cause instanceof ApiError
                        ? cause.message
                        : "Couldn't delete the template. Try again.",
                    ),
                });
              }}
            >
              {deleteTemplate.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}
