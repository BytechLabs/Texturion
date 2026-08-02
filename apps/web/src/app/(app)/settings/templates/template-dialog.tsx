"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { estimateSegments } from "@loonext/shared";
import { useEffect, useMemo } from "react";
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
import { useCompany } from "@/lib/api/companies";
import { MERGE_FIELD_VARIABLES } from "@loonext/shared";
import { ApiError } from "@/lib/api/error";
import { useTemplates, useCreateTemplate, useUpdateTemplate } from "@/lib/api/templates";
import type { Template } from "@/lib/api/types";
import { previewTemplate, SAMPLE_FIRST_NAME } from "@/lib/settings/away-preview";
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
  /**
   * #274: the crew's own grouping. Optional, and blank is how it is cleared —
   * a category is worth typing at thirty templates and friction at five.
   */
  category: z.string().trim().max(40, "Keep it under 40 characters."),
});

type FormValues = z.infer<typeof schema>;

/**
 * The merge variables offered in the editor come from @loonext/shared (#274).
 *
 * They resolve server-side at send time (apps/api merge.ts →
 * applyMergeFields), so a saved body stores the raw {token} and the preview
 * below shows what actually ships. The list was duplicated in three template
 * editors before; a token offered on the phone and not the laptop meant a
 * template a crew member could write and then not maintain.
 */
const TEMPLATE_VARIABLES = MERGE_FIELD_VARIABLES;

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
  // #274: read for the category chips only — the same alphabetical list the
  // page behind this dialog already has cached, so no extra request.
  const templates = useTemplates();
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const company = useCompany();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", body: "", category: "" },
  });

  // Re-seed the fields whenever the dialog opens for a different template.
  useEffect(() => {
    if (open) {
      form.reset({
        name: template?.name ?? "",
        body: template?.body ?? "",
        category: template?.category ?? "",
      });
    }
  }, [open, template, form]);

  /**
   * #274 — the groupings this workspace already uses.
   *
   * Offered as chips so the common act is reusing one rather than inventing a
   * near-duplicate: "Quoting" and "quotes" as separate groups is the same
   * sprawl #298 fixed for tags, one level up.
   */
  const existingCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const row of templates.data?.data ?? []) {
      const category = row.category?.trim();
      if (category) seen.add(category);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [templates.data]);

  const body = form.watch("body");
  const estimate = estimateSegments(body);
  const busy = create.isPending || update.isPending;

  // Append a {token} to the draft (one space if the draft doesn't end in one),
  // keeping RHF's dirty/validation state in sync.
  function insertVariable(token: string) {
    const current = form.getValues("body");
    const sep = current.length === 0 || current.endsWith(" ") ? "" : " ";
    form.setValue("body", `${current}${sep}{${token}}`, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  // Exactly the send-time substitution, so the preview equals what the customer
  // receives. #274: the template preview, not the away one — a saved reply can
  // carry all seven tokens, and each needs to be SEEN resolving or it looks
  // broken in the same way a token with no value does.
  const preview = previewTemplate(
    body,
    company.data?.name ?? "your business",
    company.data?.numbers?.find((n) => n.status === "active")?.number_e164 ?? null,
  );

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
    // #274: an empty box means "no category". The API normalises "" to null,
    // so sending it plainly is how a clear travels.
    const payload = { ...values, category: values.category.trim() };
    if (template) {
      update.mutate(
        { templateId: template.id, patch: payload },
        { onSuccess, onError },
      );
    } else {
      create.mutate(payload, { onSuccess, onError });
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
                    <Input maxLength={120} placeholder="On my way" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* #274 — the crew's own grouping, offered rather than imposed.
                The chips are the categories this workspace has ALREADY used,
                so the common path is one tap and inventing a new one is still
                a free-text box away. Same posture #298 settled for tags: a
                plumber's categories are not an HVAC company's. */}
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Category{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      maxLength={40}
                      placeholder="Quoting"
                      list="template-categories"
                      {...field}
                    />
                  </FormControl>
                  {existingCategories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {existingCategories.map((category) => (
                        <Button
                          key={category}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => form.setValue("category", category, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })}
                        >
                          {category}
                        </Button>
                      ))}
                    </div>
                  )}
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
                      placeholder="On our way. See you in about 20 minutes."
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

            {/* Available variables — tap to insert; they fill in per contact at
                send time. */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Variables: tap to insert
              </p>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_VARIABLES.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    onClick={() => insertVariable(v.token)}
                    className="rounded-md border border-border bg-secondary px-2 py-1 text-xs transition-colors hover:bg-secondary/70 focus-visible:outline-2 focus-visible:outline-ring"
                    title={`Insert {${v.token}}`}
                  >
                    <code className="text-foreground">{`{${v.token}}`}</code>
                    <span className="ml-1.5 text-muted-foreground">{v.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Live preview — the exact send-time substitution (sample name +
                your business name), so what you see is what ships. */}
            {body.trim() !== "" && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Preview (for {SAMPLE_FIRST_NAME})
                </p>
                <div
                  aria-live="polite"
                  className="rounded-md border border-border-subtle bg-accent/40 px-3 py-2.5 text-sm whitespace-pre-wrap"
                >
                  {preview}
                </div>
              </div>
            )}

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
