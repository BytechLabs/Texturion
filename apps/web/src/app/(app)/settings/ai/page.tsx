"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAiSettings, useUpdateAiSettings } from "@/lib/api/ai-settings";
import { ApiError } from "@/lib/api/error";
import type { CompanyAiSettings } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

/** Matches the column's CHECK constraint (migration 20260724120000). */
const BUSINESS_DESCRIPTION_MAX = 280;

/**
 * #214 Settings → AI. Per-enrichment opt-in: when a teammate makes a task from
 * a message, optionally infer a structured job address and/or a due date/time
 * from the text (Cloudflare Workers AI). Every inference is a SUGGESTION the
 * person reviews before saving — nothing is auto-applied. Default OFF (it costs
 * money and the model sees message text). Owners/admins set it for the company.
 */
/**
 * The one sentence Lou is allowed to repeat about the business.
 *
 * Held locally while typing and saved on blur, so a settings screen does not
 * fire a write per keystroke, and a half-typed sentence never reaches a draft.
 */
function BusinessDescriptionField({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled: boolean;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // A save elsewhere (another tab, another admin) should win over stale text.
  useEffect(() => setDraft(value), [value]);

  return (
    <>
      <Textarea
        id="ai-description"
        value={draft}
        maxLength={BUSINESS_DESCRIPTION_MAX}
        rows={2}
        disabled={disabled}
        placeholder="We paint houses and do small renovations in Calgary."
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft.trim();
          if (next !== (value ?? "").trim()) onSave(next);
        }}
      />
      <p className="text-right text-[11px] tabular-nums text-muted-foreground">
        {draft.length} / {BUSINESS_DESCRIPTION_MAX}
      </p>
    </>
  );
}

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
      title="Lou"
      description="Lou is the assistant built into Loonext. It drafts replies and fills in task details from what a customer already wrote. Every suggestion is yours to review and edit — Lou never sends anything, and never applies anything on its own."
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
          <SettingsCard title="What Lou knows about your business">
            <div className="space-y-2">
              <Label htmlFor="ai-description" className="text-sm font-medium">
                What you do
              </Label>
              <p className="text-sm text-muted-foreground">
                One sentence, in your words. Without it Lou will not say what
                your business does, because anything it said would be guesswork.
                With it, drafts can answer &ldquo;do you do X?&rdquo; honestly.
              </p>
              <BusinessDescriptionField
                value={settings.data.business_description ?? ""}
                disabled={!canEdit || update.isPending}
                onSave={(next) =>
                  update.mutate(
                    { ...settings.data, business_description: next },
                    {
                      onError: (cause) =>
                        toast.error(
                          cause instanceof ApiError
                            ? cause.message
                            : "Couldn't save that. Try again.",
                        ),
                    },
                  )
                }
              />
            </div>
          </SettingsCard>
          <SettingsCard title="When you reply to a customer">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="ai-replies" className="text-sm font-medium">
                  Let Lou draft replies
                </Label>
                <p className="text-sm text-muted-foreground">
                  Offer a few short replies you can edit before sending, drawn
                  from the conversation so far. Start typing and they finish
                  what you started instead.
                </p>
              </div>
              <Switch
                id="ai-replies"
                checked={settings.data.suggest_replies}
                disabled={!canEdit || update.isPending}
                onCheckedChange={(checked) =>
                  toggle("suggest_replies", checked)
                }
              />
            </div>
          </SettingsCard>
          <SettingsCard title="When someone leaves a voicemail">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="ai-voicemail" className="text-sm font-medium">
                  Let Lou write voicemails down
                </Label>
                <p className="text-sm text-muted-foreground">
                  Show what a voicemail says next to the recording, so you can
                  read it when playing it isn&apos;t an option. The recording is
                  always kept either way.
                </p>
              </div>
              <Switch
                id="ai-voicemail"
                checked={settings.data.transcribe_voicemail}
                disabled={!canEdit || update.isPending}
                onCheckedChange={(checked) =>
                  toggle("transcribe_voicemail", checked)
                }
              />
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
