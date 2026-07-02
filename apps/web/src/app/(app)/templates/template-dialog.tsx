"use client";

import { estimateSegments } from "@jobtext/shared";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/error";
import { useCreateTemplate, useUpdateTemplate } from "@/lib/api/templates";
import type { Template } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** Create/edit dialog for saved replies (G8 Templates). */
export function TemplateDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create a new template. */
  template: Template | null;
}) {
  const create = useCreateTemplate();
  const update = useUpdateTemplate();

  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Re-seed the fields whenever the dialog opens for a different template.
  useEffect(() => {
    if (open) {
      setName(template?.name ?? "");
      setBody(template?.body ?? "");
      setError(null);
    }
  }, [open, template]);

  const estimate = estimateSegments(body);
  const busy = create.isPending || update.isPending;
  const valid = name.trim() !== "" && body.trim() !== "";

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) {
      setError("Give it a name and the message text.");
      return;
    }
    setError(null);
    const onError = (cause: unknown) =>
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Couldn't save the template. Try again.",
      );
    const onSuccess = () => {
      onOpenChange(false);
      toast.success(template ? "Template saved." : "Template created.");
    };
    if (template) {
      update.mutate(
        {
          templateId: template.id,
          patch: { name: name.trim(), body: body.trim() },
        },
        { onSuccess, onError },
      );
    } else {
      create.mutate(
        { name: name.trim(), body: body.trim() },
        { onSuccess, onError },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit template" : "New template"}
          </DialogTitle>
          <DialogDescription>
            Type / in the composer to insert it while replying.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              value={name}
              maxLength={100}
              placeholder="On my way"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-body">Message</Label>
            <Textarea
              id="template-body"
              value={body}
              rows={4}
              maxLength={2000}
              placeholder="On our way — see you in about 20 minutes."
              onChange={(event) => setBody(event.target.value)}
            />
            {body.trim() !== "" && (
              <p
                className={cn(
                  "text-xs tabular-nums",
                  // amber-700 in light for the G11 4.5:1 text bar.
                  estimate.segments >= 4
                    ? "text-amber-700 dark:text-warning"
                    : "text-muted-foreground",
                )}
              >
                {body.length.toLocaleString()} characters ·{" "}
                {estimate.segments}{" "}
                {estimate.segments === 1 ? "segment" : "segments"} per send
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !valid}>
              {busy ? "Saving…" : template ? "Save" : "Create template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
