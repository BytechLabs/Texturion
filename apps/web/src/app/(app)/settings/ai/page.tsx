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
import { useT } from "@/i18n/provider";
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
  const t = useT();
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
        placeholder={t("appShell.aiDescriptionPlaceholder")}
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
  const t = useT();
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
              : t("appShell.saveThatFailed"),
          ),
      },
    );
  }

  return (
    <SettingsPage
      title={t("appShell.aiTitle")}
      description={t("appShell.aiDescription")}
    >
      {settings.isPending ? (
        <div className="space-y-4" aria-label={t("appShell.aiLoading")}>
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      ) : settings.isError ? (
        <LoadError onRetry={() => settings.refetch()} />
      ) : (
        <div className="space-y-6">
          <SettingsCard title={t("appShell.aiTaskCardTitle")}>
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="ai-address" className="text-sm font-medium">
                    {t("appShell.aiAddressLabel")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("appShell.aiAddressBody")}
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
                    {t("appShell.aiDueLabel")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("appShell.aiDueBody")}
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
          <SettingsCard title={t("appShell.aiBusinessCardTitle")}>
            <div className="space-y-2">
              <Label htmlFor="ai-description" className="text-sm font-medium">
                {t("appShell.aiWhatYouDoLabel")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("appShell.aiWhatYouDoBody")}
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
                            : t("appShell.saveThatFailed"),
                        ),
                    },
                  )
                }
              />
            </div>
          </SettingsCard>
          <SettingsCard title={t("appShell.aiRepliesCardTitle")}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="ai-replies" className="text-sm font-medium">
                  {t("appShell.aiRepliesLabel")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("appShell.aiRepliesBody")}
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
          <SettingsCard title={t("appShell.aiVoicemailCardTitle")}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="ai-voicemail" className="text-sm font-medium">
                  {t("appShell.aiVoicemailLabel")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("appShell.aiVoicemailBody")}
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
            {/* #367/D89. Grouped with transcription rather than given a card of
                its own — they are the same moment, and one of them is the other
                one's input. Separated by a rule because this one is the switch
                that changes what a STRANGER hears, and the copy has to be read
                before it is flipped. */}
            <div className="mt-4 flex items-start justify-between gap-4 border-t border-border pt-4">
              <div className="space-y-0.5">
                <Label htmlFor="ai-intake" className="text-sm font-medium">
                  {t("appShell.aiIntakeLabel")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("appShell.aiIntakeBody")}
                </p>
              </div>
              <Switch
                id="ai-intake"
                checked={settings.data.voicemail_intake}
                disabled={!canEdit || update.isPending}
                onCheckedChange={(checked) => toggle("voicemail_intake", checked)}
              />
            </div>
          </SettingsCard>
          {/* #507/D117. Placed directly after the voicemail card on purpose:
              that one IS the caller's voice, and this one is emphatically not.
              Read together the difference is obvious; read apart, "Lou and
              phone calls" blurs into one thing, and the blurred version is a
              claim we listen to calls — which is false.
              *Applying: Chunking — the call-adjacent toggles read as one group,
              and the group is where the distinction has to be legible.* */}
          <SettingsCard title={t("appShell.aiWrapupCardTitle")}>
            <div className="flex items-start justify-between gap-4">
              {/* Two rungs, not one: the label and what it does are a heading
                  and its subheading (0.5), and the sentence about whose voice
                  it is stands apart (2) because it is a different KIND of
                  claim — a boundary, not a description.
                  *Applying: Relationship Strength — spacing carries the
                  grouping, and neither gap is eyeballed.* */}
              <div className="space-y-2">
                <div className="space-y-0.5">
                  <Label htmlFor="ai-wrapup" className="text-sm font-medium">
                    {t("appShell.aiWrapupLabel")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("appShell.aiWrapupBody")}
                  </p>
                </div>
                {/* Scoped, not absolute — voicemail does record a caller's
                    voice, so "never records a customer" would be false.

                    Split into three keys rather than one because the emphasis
                    is INSIDE the sentence: a single key would either lose the
                    bold or ship markup through the catalogue. The emphasised
                    word sits before its noun in both languages. */}
                <p className="text-sm text-muted-foreground">
                  {t("appShell.aiWrapupVoiceBefore")}{" "}
                  <strong className="font-medium">
                    {t("appShell.aiWrapupVoiceEmphasis")}
                  </strong>{" "}
                  {t("appShell.aiWrapupVoiceAfter")}
                </p>
              </div>
              <Switch
                id="ai-wrapup"
                checked={settings.data.call_wrapup}
                disabled={!canEdit || update.isPending}
                onCheckedChange={(checked) => toggle("call_wrapup", checked)}
              />
            </div>
          </SettingsCard>
          {/* #247. Last, and its own card rather than a line inside "When you
              reply to a customer": drafting produces something you SEND, and
              this produces something you READ. Grouped with sending, the
              natural question would be "does the customer see this?" — and the
              answer, never, is exactly what the placement should not put in
              doubt.
              *Applying: Chunking — one card per moment, and this is a different
              moment from all four above it.* */}
          <SettingsCard title={t("appShell.aiCatchupCardTitle")}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="space-y-0.5">
                  <Label htmlFor="ai-catchup" className="text-sm font-medium">
                    {t("appShell.aiCatchupLabel")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("appShell.aiCatchupBody")}
                  </p>
                </div>
                {/* The two claims worth making about this one specifically,
                    and both are about trust rather than function: it quotes
                    rather than paraphrases, and it changes nothing. Set apart
                    from the description because they are a different KIND of
                    statement — a boundary, not a feature.
                    *Applying: Relationship Strength.* */}
                <p className="text-sm text-muted-foreground">
                  {t("appShell.aiCatchupBoundary")}
                </p>
              </div>
              <Switch
                id="ai-catchup"
                checked={settings.data.summarize_threads}
                disabled={!canEdit || update.isPending}
                onCheckedChange={(checked) =>
                  toggle("summarize_threads", checked)
                }
              />
            </div>
          </SettingsCard>
          {!canEdit && (
            <p className="text-sm text-muted-foreground">
              {t("appShell.aiOwnersOnly")}
            </p>
          )}
        </div>
      )}
    </SettingsPage>
  );
}
