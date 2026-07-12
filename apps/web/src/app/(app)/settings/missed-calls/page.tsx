"use client";

/**
 * Settings › Calling (D43 Calls v2). The browser is the phone: calls ring
 * every signed-in member in the app, unanswered calls take a voicemail, and
 * the missed-call text-back still fires. This page is the whole calling
 * surface — the text-back message, the voicemail greeting, carrier call
 * screening, and caller ID (CNAM both directions). Cell forwarding is GONE
 * (D43 deleted it), so there is no cell to configure anywhere.
 */
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
import { useCompany, useUpdateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import { useUsage } from "@/lib/api/usage";
import { previewMissedCallText } from "@/lib/settings/away-preview";
import type { CompanyView } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

const DEFAULT_MCTB_MESSAGE =
  "Sorry we missed your call! This is {business_name}. Reply here with your address and what you need, and we'll get you booked in.";

/** Mirrors the server's spoken default (inbound-ring.ts defaultGreeting). */
function defaultGreeting(businessName: string): string {
  return (
    `You've reached ${businessName}. We can't take your call right now. ` +
    `Please leave a message after the beep, or hang up and text us at this number.`
  );
}

/** The carrier CNAM alphabet: 1–15 letters, digits, or spaces. */
const CNAM_RE = /^[A-Za-z0-9 ]{1,15}$/;

function CallingSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading calling settings">
      <Skeleton className="h-72 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
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
      description="When a call to your business number goes unanswered, we send the caller one text so they can book by reply, instead of calling the next number on their list."
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
              allowed. Opted-out numbers are never texted.
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

/** D43: the voicemail greeting — owner-authored TTS text, spoken default. */
function VoicemailCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const update = useUpdateCompany();
  const [greeting, setGreeting] = useState(company.voicemail_greeting ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGreeting(company.voicemail_greeting ?? "");
  }, [company.voicemail_greeting]);

  const dirty = greeting.trim() !== (company.voicemail_greeting ?? "").trim();
  const spoken =
    greeting.trim().length > 0 ? greeting.trim() : defaultGreeting(company.name);

  function save() {
    setError(null);
    const trimmed = greeting.trim();
    update.mutate(
      { voicemail_greeting: trimmed.length > 0 ? trimmed : null },
      {
        onSuccess: () => toast.success("Voicemail greeting saved."),
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
      title="Voicemail"
      description="When nobody answers in the app, the caller hears this greeting and can leave a message up to two minutes. Voicemails land in the call log and the caller's conversation, ready to play."
      footer={
        canEdit ? (
          <div className="flex items-center justify-end">
            <Button onClick={save} disabled={!dirty || update.isPending}>
              {update.isPending ? "Saving…" : "Save greeting"}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="vm-greeting" className="text-sm font-medium">
            Your greeting
          </Label>
          <Textarea
            id="vm-greeting"
            value={greeting}
            disabled={!canEdit || update.isPending}
            maxLength={500}
            rows={3}
            placeholder={defaultGreeting(company.name)}
            onChange={(e) => setGreeting(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Spoken aloud to the caller. Leave it empty to use the default.
          </p>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            What callers hear
          </p>
          <div
            aria-live="polite"
            className="rounded-md border border-border-subtle bg-accent/40 px-3 py-2.5 text-sm whitespace-pre-wrap"
          >
            {spoken}
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Only owners and admins can change the voicemail greeting.
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

const SCREENING_CHOICES: {
  value: CompanyView["call_screening"];
  label: string;
  detail: string;
}[] = [
  {
    value: "off",
    label: "Off",
    detail: "Every call rings the team, no labels.",
  },
  {
    value: "flag",
    label: "Label suspicious calls",
    detail:
      "The carrier's verdict shows on the call — “Spam likely” — but every call still rings the team.",
  },
  {
    value: "divert",
    label: "Send suspicious calls to voicemail",
    detail:
      "Flagged callers skip the ring and go straight to voicemail. A real customer who gets misflagged can still leave a message.",
  },
];

/** D43: carrier call screening — off / flag (label) / divert (voicemail). */
function ScreeningCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const update = useUpdateCompany();
  const [error, setError] = useState<string | null>(null);

  function choose(value: CompanyView["call_screening"]) {
    if (value === company.call_screening) return;
    setError(null);
    update.mutate(
      { call_screening: value },
      {
        onSuccess: () => toast.success("Call screening updated."),
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
      title="Call screening"
      description="The phone network scores incoming calls for spam and fraud. Choose what happens with that verdict."
    >
      <div
        role="radiogroup"
        aria-label="Call screening"
        className="space-y-2"
      >
        {SCREENING_CHOICES.map((choice) => {
          const selected = company.call_screening === choice.value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!canEdit || update.isPending}
              onClick={() => choose(choice.value)}
              className={
                "w-full rounded-md border px-3 py-2.5 text-left transition-colors duration-150 " +
                (selected
                  ? "border-primary/50 bg-accent/40"
                  : "border-border-subtle hover:bg-accent/20")
              }
            >
              <span className="block text-sm font-medium">{choice.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {choice.detail}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {!canEdit && (
        <p className="mt-3 text-xs text-muted-foreground">
          Only owners and admins can change call screening.
        </p>
      )}
    </SettingsCard>
  );
}

/** D43: caller ID both directions — outbound CNAM listing + inbound name dip. */
function CallerIdCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const update = useUpdateCompany();
  const [display, setDisplay] = useState(company.cnam_display_name ?? "");
  const [lookup, setLookup] = useState(company.caller_id_lookup);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplay(company.cnam_display_name ?? "");
    setLookup(company.caller_id_lookup);
  }, [company.cnam_display_name, company.caller_id_lookup]);

  const dirty =
    display.trim() !== (company.cnam_display_name ?? "") ||
    lookup !== company.caller_id_lookup;

  function save() {
    setError(null);
    const trimmed = display.trim();
    if (trimmed.length > 0 && !CNAM_RE.test(trimmed)) {
      setError(
        "The display name can use letters, digits, and spaces — 15 characters max (a carrier rule).",
      );
      return;
    }
    update.mutate(
      {
        cnam_display_name: trimmed.length > 0 ? trimmed : null,
        caller_id_lookup: lookup,
      },
      {
        onSuccess: () => toast.success("Caller ID settings saved."),
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
      title="Caller ID"
      description="What people see when you call them, and what you see when they call you."
      footer={
        canEdit ? (
          <div className="flex items-center justify-end">
            <Button onClick={save} disabled={!dirty || update.isPending}>
              {update.isPending ? "Saving…" : "Save caller ID"}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="cnam-name" className="text-sm font-medium">
            Your outbound display name
          </Label>
          <Input
            id="cnam-name"
            value={display}
            disabled={!canEdit || update.isPending}
            maxLength={15}
            placeholder={company.name.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 15)}
            onChange={(e) => setDisplay(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Shown on US caller ID when you call customers — letters, digits,
            and spaces, 15 characters max. Carriers take 1–3 days to pick up a
            change, and Canadian display names are set by the receiving
            carrier, so this mainly helps your US calls.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="cnam-lookup" className="text-sm font-medium">
              Look up who&apos;s calling
            </Label>
            <p className="text-sm text-muted-foreground">
              Shows the caller&apos;s network-registered name on incoming
              calls when they aren&apos;t in your contacts yet.
            </p>
          </div>
          <Switch
            id="cnam-lookup"
            checked={lookup}
            disabled={!canEdit || update.isPending}
            onCheckedChange={setLookup}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Only owners and admins can change caller ID settings.
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

export default function CallingSettingsPage() {
  const company = useCompany();
  const usage = useUsage();
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";

  return (
    <SettingsPage
      title="Calling"
      description="Calls ring right in the app for your whole team. Unanswered calls take a voicemail, and the caller gets your text-back."
    >
      {company.isPending || usage.isPending ? (
        <CallingSkeleton />
      ) : company.isError || usage.isError ? (
        <LoadError
          onRetry={() => {
            void company.refetch();
            void usage.refetch();
          }}
        />
      ) : (
        <div className="space-y-6">
          {/* A text-enabled landline's calls ring the owner's existing
              carrier, so there is no Loonext call to answer or voicemail. */}
          {onlyHostedNumbers(company.data.numbers) && (
            <p className="text-sm text-muted-foreground">
              In-app calling needs a number whose calls come through Loonext.
              Calls to your text-enabled landline stay with your existing
              carrier, so these settings won&apos;t apply until you add or
              transfer a Loonext number.
            </p>
          )}
          <TextBackCard company={company.data} canEdit={canEdit} />
          <VoicemailCard company={company.data} canEdit={canEdit} />
          <ScreeningCard company={company.data} canEdit={canEdit} />
          <CallerIdCard company={company.data} canEdit={canEdit} />
          {/* D36/D38 fair use, one quiet line — the detail lives in Usage. */}
          <p className="px-1 text-xs text-muted-foreground">
            Your plan includes {usage.data.voice.included_minutes.toLocaleString()}{" "}
            calling minutes a month, both directions.
            {usage.data.voice.overage_billed
              ? " Past that, extra minutes bill at 1¢ each up to your spending cap."
              : ""}{" "}
            Details live in Settings › Usage.
          </p>
        </div>
      )}
    </SettingsPage>
  );
}
