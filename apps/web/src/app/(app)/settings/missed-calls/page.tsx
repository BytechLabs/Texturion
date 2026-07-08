"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { onlyHostedNumbers } from "@/components/settings/text-enable-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useModules } from "@/lib/api/billing";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import { useUsage } from "@/lib/api/usage";
import { previewMissedCallText } from "@/lib/settings/away-preview";
import type { CompanyView } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

const DEFAULT_MCTB_MESSAGE =
  "Sorry we missed your call! This is {business_name}. Reply here with your address and what you need, and we'll get you booked in.";

/** A +1 US/CA E.164 cell, e.g. +16135551234. Loose client hint; server validates. */
const E164_HINT = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

function MissedCallsSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading missed-call settings">
      <Skeleton className="h-72 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}

/** The missed-call text-back toggle + owner-authored message + live preview. */
function TextBackCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const update = useUpdateCompany();
  const [enabled, setEnabled] = useState(company.mctb_enabled);
  const [message, setMessage] = useState(company.mctb_message ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(company.mctb_enabled);
    setMessage(company.mctb_message ?? "");
  }, [company.mctb_enabled, company.mctb_message]);

  const dirty =
    enabled !== company.mctb_enabled ||
    message.trim() !== (company.mctb_message ?? "").trim();

  // previewMissedCallText, not previewAwayMessage: the server sends this with
  // no contact name (a missed call is usually a brand-new caller), so the
  // preview must drop {first_name} exactly as the wire does — never show a
  // sample name that won't ship.
  const preview = previewMissedCallText(
    message.trim().length > 0 ? message : DEFAULT_MCTB_MESSAGE,
    company.name,
  );

  function save() {
    setError(null);
    const trimmed = message.trim();
    if (enabled && trimmed.length === 0) {
      setError("Write your text-back message before turning it on.");
      return;
    }
    update.mutate(
      {
        mctb_enabled: enabled,
        mctb_message: trimmed.length > 0 ? trimmed : null,
      },
      {
        onSuccess: () => toast.success("Missed-call text-back saved."),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save. Try again.",
          ),
      },
    );
  }

  return (
    <SettingsCard
      title="Text back a missed call"
      description="When a call to your business number goes unanswered, we send the caller one text so they can book by reply — instead of calling the next number on their list."
      footer={
        canEdit ? (
          <div className="flex items-center justify-end">
            <Button onClick={save} disabled={!dirty || update.isPending}>
              {update.isPending ? "Saving…" : "Save text-back"}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="mctb-enabled" className="text-sm font-medium">
              Text back missed calls
            </Label>
            <p className="text-sm text-muted-foreground">
              Fires once per caller when a call goes unanswered. A caller who
              dials you started the conversation, so this reply is always
              allowed — opted-out numbers are never texted.
            </p>
          </div>
          <Switch
            id="mctb-enabled"
            checked={enabled}
            disabled={!canEdit || update.isPending}
            onCheckedChange={setEnabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="mctb-message" className="text-sm font-medium">
            Your text-back message
          </Label>
          <Textarea
            id="mctb-message"
            value={message}
            disabled={!canEdit || update.isPending}
            maxLength={1000}
            rows={4}
            placeholder={DEFAULT_MCTB_MESSAGE}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            You can use{" "}
            <code className="rounded bg-secondary px-1 py-0.5">
              {"{business_name}"}
            </code>
            . Keep it short and ask for what you need to book them in.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Preview</p>
          <div
            aria-live="polite"
            className="rounded-md border border-border-subtle bg-accent/40 px-3 py-2.5 text-sm whitespace-pre-wrap"
          >
            {preview}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Only owners and admins can change the missed-call text-back.
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

/** Optional forward-to-cell: ring the owner's phone first, text if unanswered. */
function ForwardCard({
  company,
  canEdit,
  includedMinutes,
}: {
  company: CompanyView;
  canEdit: boolean;
  /**
   * The plan's monthly call-forwarding allowance (voice.included_minutes from
   * GET /v1/usage, i.e. PLAN_VOICE_MINUTES). Forwarding is cap-and-drop, not
   * uncapped: past this the voice webhook stops forwarding, so the copy must
   * state the ceiling rather than promise unlimited "included" minutes.
   */
  includedMinutes: number;
}) {
  const update = useUpdateCompany();
  const [cell, setCell] = useState(company.forward_to_cell ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setCell(company.forward_to_cell ?? ""), [company.forward_to_cell]);

  const dirty = cell.trim() !== (company.forward_to_cell ?? "");
  const invalid = cell.trim().length > 0 && !E164_HINT.test(cell.trim());

  function save() {
    setError(null);
    const trimmed = cell.trim();
    if (trimmed.length > 0 && !E164_HINT.test(trimmed)) {
      setError("Enter a US or Canada mobile number like +16135551234.");
      return;
    }
    update.mutate(
      { forward_to_cell: trimmed.length > 0 ? trimmed : null },
      {
        onSuccess: () => toast.success("Call forwarding saved."),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save. Try again.",
          ),
      },
    );
  }

  return (
    <SettingsCard
      title="Ring your cell first (optional)"
      description="If you set a cell number, an incoming call rings it first. Only if you don't pick up within about 20 seconds does the call count as missed."
      footer={
        canEdit ? (
          <div className="flex items-center justify-end">
            <Button onClick={save} disabled={!dirty || invalid || update.isPending}>
              {update.isPending ? "Saving…" : "Save forwarding"}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-2">
        <Label htmlFor="forward-cell" className="text-sm font-medium">
          Forward calls to
        </Label>
        <Input
          id="forward-cell"
          type="tel"
          inputMode="tel"
          value={cell}
          disabled={!canEdit || update.isPending}
          placeholder="+16135551234"
          onChange={(e) => setCell(e.target.value)}
          className="max-w-xs"
        />
        <p className="text-xs text-muted-foreground">
          Leave blank to skip forwarding — a call no one picks up rings out and
          counts as missed. If your voicemail answers instead of you, the call
          still counts as missed. Forwarded calls are included in your plan up
          to{" "}
          <span className="tabular-nums">
            {includedMinutes.toLocaleString()}
          </span>{" "}
          minutes a month. After that, new calls stop forwarding and the caller
          gets your missed-call text instead — so your phone bill can&apos;t run
          past your plan.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

export default function MissedCallsSettingsPage() {
  const company = useCompany();
  const modules = useModules();
  const usage = useUsage();
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";
  // Missed-call text-back and forward-to-cell are both call features, gated by
  // the "Call forwarding" (voice) add-on — disabling it clears both settings
  // server-side. Reflect that gate here with a link straight to the add-on.
  const voiceEnabled =
    (modules.data?.modules ?? []).find((m) => m.id === "voice")?.enabled ?? false;

  return (
    <SettingsPage
      title="Missed calls"
      description="Turn a missed call into a booked job with one automatic text."
    >
      {company.isPending || modules.isPending || usage.isPending ? (
        <MissedCallsSkeleton />
      ) : company.isError || usage.isError ? (
        <LoadError
          onRetry={() => {
            void company.refetch();
            void usage.refetch();
          }}
        />
      ) : !voiceEnabled ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Ringing your cell and texting back missed calls need the{" "}
          <span className="font-medium text-foreground">Call forwarding</span>{" "}
          add-on —{" "}
          <Link
            href="/settings/billing"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            turn it on in Settings › Billing
          </Link>
          .
        </div>
      ) : (
        <div className="space-y-6">
          {/* A text-enabled landline's calls ring the owner's existing
              carrier, so there is no Loonext call to observe as missed. */}
          {onlyHostedNumbers(company.data.numbers) && (
            <p className="text-sm text-muted-foreground">
              Missed-call text-back needs a number whose calls come through
              Loonext — calls to your text-enabled landline stay with your
              existing carrier, so these settings won&apos;t apply until you
              add or transfer a Loonext number.
            </p>
          )}
          <TextBackCard company={company.data} canEdit={canEdit} />
          <ForwardCard
            company={company.data}
            canEdit={canEdit}
            includedMinutes={usage.data.voice.included_minutes}
          />
        </div>
      )}
    </SettingsPage>
  );
}
