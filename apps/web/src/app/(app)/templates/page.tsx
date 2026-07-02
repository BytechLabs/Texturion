"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { LoadError } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
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
  onEdit,
  onDelete,
}: {
  template: Template;
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
          Updated {formatRelativeTime(template.updated_at)}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

/** /templates (G8): saved replies — list, create, edit, delete. */
export default function TemplatesPage() {
  const templates = useTemplates();
  const deleteTemplate = useDeleteTemplate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(template: Template) {
    setEditing(template);
    setDialogOpen(true);
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 md:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Templates</h1>
          <p className="text-sm text-muted-foreground">
            Replies you send all the time. Type / in the composer to insert
            one.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus strokeWidth={1.75} aria-hidden />
          New template
        </Button>
      </div>

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
            No templates yet. Save a reply you type all the time — then insert
            it with / in the composer.
          </p>
          <Button className="mt-4" onClick={openCreate}>
            Create your first template
          </Button>
        </div>
      ) : (
        <div className="divide-y rounded-lg border bg-card">
          {templates.data.data.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              onEdit={() => openEdit(template)}
              onDelete={() => setDeleting(template)}
            />
          ))}
        </div>
      )}

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
    </div>
  );
}
