"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { estimateSegments } from "@jobtext/shared";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/error";
import { useCreateTemplate, useUpdateTemplate } from "@/lib/api/templates";
import type { Template } from "@/lib/api/types";
import { cn } from "@/lib/utils";

// Mirrors the API template schema (apps/api/src/routes/templates.ts):
// name 1–120, body 1–2000 after trim.
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give it a name.")
    .max(120, "Keep the name under 120 characters."),
  body: z
    .string()
    .trim()
    .min(1, "Add the message text.")
    .max(2000, "Keep it under 2,000 characters."),
});

type FormValues = z.infer<typeof schema>;

/** Create/edit dialog for saved replies (G8 Templates; RHF + zod per G12). */
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

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", body: "" },
  });

  // Re-seed the fields whenever the dialog opens for a different template.
  useEffect(() => {
    if (open) {
      form.reset({ name: template?.name ?? "", body: template?.body ?? "" });
    }
  }, [open, template, form]);

  const body = form.watch("body");
  const estimate = estimateSegments(body);
  const busy = create.isPending || update.isPending;

  function onSubmit(values: FormValues) {
    const onError = (cause: unknown) =>
      form.setError("root", {
        message:
          cause instanceof ApiError
            ? cause.message
            : "Couldn't save the template. Try again.",
      });
    const onSuccess = () => {
      onOpenChange(false);
      toast.success(template ? "Template saved." : "Template created.");
    };
    if (template) {
      update.mutate(
        { templateId: template.id, patch: values },
        { onSuccess, onError },
      );
    } else {
      create.mutate(values, { onSuccess, onError });
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
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input maxLength={100} placeholder="On my way" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      maxLength={2000}
                      placeholder="On our way — see you in about 20 minutes."
                      {...field}
                    />
                  </FormControl>
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
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.root.message}
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
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : template ? "Save" : "Create template"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
