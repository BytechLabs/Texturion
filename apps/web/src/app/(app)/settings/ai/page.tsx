"use client";

import { toast } from "sonner";

import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAiSettings, useUpdateAiSettings } from "@/lib/api/ai-settings";
import { ApiError } from "@/lib/api/error";
import type { CompanyAiSettings } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * #214 Settings → AI. Per-enrichment opt-in: when a teammate makes a task from
 * a message, optionally infer a structured job address and/or a due date/time
 * from the text (Cloudflare Workers AI). Every inference is a SUGGESTION the
 * person reviews before saving — nothing is auto-applied. Default OFF (it costs
 * money and the model sees message text). Owners/admins set it for the company.
 */
export default function AiSettingsPage() {
  const settings = useAiSettings();
  const update = useUpdateAiSettings();
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";

  function toggle(key: keyof CompanyAiSettings, value: boolean) {
    if (!settings.data) return;
    update.mutate(
      { ...settings.data, [key]: value },
      {
        onError: (cause) =>
          toast.error(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save that. Try again.",
          ),
      },
    );
  }

  return (
    <SettingsPage
      title="AI"
      description="Let the app pre-fill task details from a message. Every suggestion is yours to review and edit before you save — nothing is sent or applied on its own."
    >
      {settings.isPending ? (
        <div className="space-y-4" aria-label="Loading AI settings">
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      ) : settings.isError ? (
        <LoadError onRetry={() => settings.refetch()} />
      ) : (
        <div className="space-y-6">
          <SettingsCard title="When you make a task from a message">
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="ai-address" className="text-sm font-medium">
                    Suggest an address
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Read a job location out of the message (or fall back to the
                    contact&rsquo;s address) and pre-fill the task&rsquo;s
                    address. It shows where each part came from; you can edit or
                    clear it before saving.
                  </p>
                </div>
                <Switch
                  id="ai-address"
                  checked={settings.data.enrich_task_address}
                  disabled={!canEdit || update.isPending}
                  onCheckedChange={(checked) =>
                    toggle("enrich_task_address", checked)
                  }
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="ai-due" className="text-sm font-medium">
                    Suggest a due date &amp; time
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Turn phrases like &ldquo;tomorrow at 2pm&rdquo; or
                    &ldquo;next Tuesday&rdquo; into a due date in your
                    workspace&rsquo;s timezone. Always editable before you save.
                  </p>
                </div>
                <Switch
                  id="ai-due"
                  checked={settings.data.enrich_task_due}
                  disabled={!canEdit || update.isPending}
                  onCheckedChange={(checked) =>
                    toggle("enrich_task_due", checked)
                  }
                />
              </div>
            </div>
          </SettingsCard>
          {!canEdit && (
            <p className="text-sm text-muted-foreground">
              Only owners and admins can change these.
            </p>
          )}
        </div>
      )}
    </SettingsPage>
  );
}
