"use client";

/**
 * Settings › Calling (D43 Calls v2). The browser is the phone: calls ring
 * every signed-in member in the app, unanswered calls take a voicemail, and
 * the missed-call text-back still fires. This page is the whole calling
 * surface — the text-back message, the voicemail greeting, carrier call
 * screening, and caller ID (CNAM both directions). Cell forwarding is GONE
 * (D43 deleted it), so there is no cell to configure anywhere.
 */
import { DEFAULT_MCTB_MESSAGE } from "@loonext/shared";
import { useEffect, useRef, useState } from "react";
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
import { formatAbsoluteDateTime } from "@/lib/format/time";
import { previewMissedCallText } from "@/lib/settings/away-preview";
import type { CompanyView } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

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

/**
 * The missed-call text-back (#192): the TOGGLE decides whether the text goes
 * out; the message always exists (a product default lives server-side, and
 * the owner's text overrides only when non-blank). So there is no Save
 * button: the toggle saves on flip, the message autosaves as you type, and
 * the input only shows while the feature is on.
 */
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
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(company.mctb_message ?? "");
  // Latest typed value, so the unmount flush below reads the current draft
  // (the cleanup closure would otherwise capture a stale `message`).
  const latestMessage = useRef(message);
  latestMessage.current = message;

  // Another admin's toggle flip always reflects; the message refreshes an
  // IDLE editor only (never clobber in-flight typing — the PATCH echo lands
  // in the cache mid-keystroke otherwise).
  useEffect(() => {
    setEnabled(company.mctb_enabled);
  }, [company.mctb_enabled]);
  useEffect(() => {
    if (
      (company.mctb_message ?? "") !== lastSaved.current &&
      message === lastSaved.current
    ) {
      lastSaved.current = company.mctb_message ?? "";
      setMessage(company.mctb_message ?? "");
    }
  }, [company.mctb_message, message]);
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      // Flush a pending autosave so navigating away within the debounce window
      // doesn't silently drop the last edit. Fire-and-forget — the component is
      // unmounting, so no success/error setState (the PATCH still completes via
      // the app-level query client).
      const trimmed = latestMessage.current.trim();
      if (trimmed !== lastSaved.current) {
        update.mutate({ mctb_message: trimmed.length > 0 ? trimmed : null });
      }
    },
    [update],
  );

  function toggle(next: boolean) {
    setError(null);
    setEnabled(next); // optimistic; reverted on error below
    update.mutate(
      { mctb_enabled: next },
      {
        onError: (cause) => {
          setEnabled(company.mctb_enabled);
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save. Try again.",
          );
        },
      },
    );
  }

  function onChangeMessage(next: string) {
    setMessage(next);
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const trimmed = next.trim();
      if (trimmed === lastSaved.current) return;
      update.mutate(
        { mctb_message: trimmed.length > 0 ? trimmed : null },
        {
          onSuccess: () => {
            lastSaved.current = trimmed;
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          },
          onError: (cause) =>
            setError(
              cause instanceof ApiError
                ? cause.message
                : "Couldn't save. Try again.",
            ),
        },
      );
    }, 800);
  }

  // previewMissedCallText, not previewAwayMessage: the server sends this with
  // no contact name (a missed call is usually a brand-new caller), so the
  // preview must drop {first_name} exactly as the wire does — never show a
  // sample name that won't ship. Blank message → the product default, the
  // same fallback the server applies at send time.
  const preview = previewMissedCallText(
    message.trim().length > 0 ? message : DEFAULT_MCTB_MESSAGE,
    company.name,
  );

  return (
    <SettingsCard
      title="Text back a missed call"
      description="When a call to your business number goes unanswered, we send the caller one text so they can book by reply, instead of calling the next number on their list."
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
            disabled={!canEdit}
            onCheckedChange={toggle}
          />
        </div>

        {enabled && (
          <>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="mctb-message" className="text-sm font-medium">
                  Your text-back message
                </Label>
                <p
                  aria-live="polite"
                  className={
                    "text-[11px] text-muted-foreground transition-opacity duration-150 " +
                    (update.isPending || saved ? "opacity-100" : "opacity-0")
                  }
                >
                  {update.isPending ? "Saving…" : saved ? "Saved" : ""}
                </p>
              </div>
              <Textarea
                id="mctb-message"
                value={message}
                disabled={!canEdit}
                maxLength={1000}
                rows={4}
                placeholder={DEFAULT_MCTB_MESSAGE}
                onChange={(e) => onChangeMessage(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Saves as you type. Leave it empty to send the default, or
                write your own with{" "}
                <code className="rounded bg-secondary px-1 py-0.5">
                  {"{business_name}"}
                </code>
                .
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                What the caller gets
              </p>
              <div
                aria-live="polite"
                className="rounded-md border border-border-subtle bg-accent/40 px-3 py-2.5 text-sm whitespace-pre-wrap"
              >
                {preview}
              </div>
            </div>
          </>
        )}

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
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);

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

  // WAI-ARIA radiogroup keyboard contract: Arrow keys move focus AND selection
  // across the options (with roving tabindex, one Tab stop for the whole group).
  const currentIndex = SCREENING_CHOICES.findIndex(
    (choice) => choice.value === company.call_screening,
  );
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!canEdit) return;
    const from = currentIndex === -1 ? 0 : currentIndex;
    let next = from;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (from + 1) % SCREENING_CHOICES.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (from - 1 + SCREENING_CHOICES.length) % SCREENING_CHOICES.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    radioRefs.current[next]?.focus();
    choose(SCREENING_CHOICES[next].value);
  }

  return (
    <SettingsCard
      title="Call screening"
      description="The phone network scores incoming calls for spam and fraud. Choose what happens with that verdict."
    >
      <div
        role="radiogroup"
        aria-label="Call screening"
        onKeyDown={onKeyDown}
        className="space-y-2"
      >
        {SCREENING_CHOICES.map((choice, i) => {
          const selected = company.call_screening === choice.value;
          return (
            <button
              key={choice.value}
              ref={(el) => {
                radioRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (currentIndex === -1 && i === 0) ? 0 : -1}
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

/** #193: how long a submitted CNAM change is surfaced as "on its way". The
 *  carrier side reports no completion, so this mirrors the 1 to 3 business
 *  days carriers typically take, nothing more. */
const CNAM_PROPAGATION_MS = 3 * 24 * 60 * 60 * 1000;

function cnamChangePending(submittedAt: string | null): boolean {
  if (!submittedAt) return false;
  const at = Date.parse(submittedAt);
  return Number.isFinite(at) && Date.now() - at < CNAM_PROPAGATION_MS;
}

/** Client mirror of the server's company-name sanitizer (telnyx/voice.ts). */
function cnamFromCompanyName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 15)
    .trim();
}

/**
 * #193: caller ID defaults to the company name platform-wide. The card shows
 * the EFFECTIVE outbound name (server-resolved), and changing it is a
 * deliberate two-step action because CNAM changes crawl through carrier
 * databases for days with no completion signal. The inbound name dip stays a
 * simple switch that saves on flip.
 */
function CallerIdCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const update = useUpdateCompany();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // The value awaiting confirmation: a string = explicit name; null = back
  // to the company name; undefined = no confirmation open.
  const [confirming, setConfirming] = useState<string | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);

  const usingCompanyName = company.caller_id_source === "company_name";
  const pending = cnamChangePending(company.cnam_submitted_at);
  const confirmTarget =
    confirming === undefined
      ? ""
      : (confirming ?? cnamFromCompanyName(company.name));

  function beginEdit() {
    setDraft(company.cnam_display_name ?? "");
    setError(null);
    setConfirming(undefined);
    setEditing(true);
  }

  function review(next: string | null) {
    setError(null);
    if (next !== null && !CNAM_RE.test(next)) {
      setError(
        "The display name can use letters, digits, and spaces, 15 characters max (a carrier rule).",
      );
      return;
    }
    if (next === company.cnam_display_name) {
      setEditing(false);
      return;
    }
    setConfirming(next);
  }

  function confirmChange() {
    if (confirming === undefined) return;
    update.mutate(
      { cnam_display_name: confirming },
      {
        onSuccess: () => {
          setEditing(false);
          setConfirming(undefined);
          toast.success("Caller ID update submitted to carriers.");
        },
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save. Try again.",
          ),
      },
    );
  }

  function toggleLookup(next: boolean) {
    setError(null);
    update.mutate(
      { caller_id_lookup: next },
      {
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
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">Your outbound display name</p>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border-subtle bg-accent/40 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {company.caller_id_effective ?? "No display name"}
              </p>
              <p className="text-xs text-muted-foreground">
                {usingCompanyName
                  ? "Using your company name"
                  : "Custom display name"}
              </p>
            </div>
            {canEdit && !editing && (
              <Button variant="outline" size="sm" onClick={beginEdit}>
                Change
              </Button>
            )}
          </div>
          {pending && company.cnam_submitted_at && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Update submitted{" "}
              {formatAbsoluteDateTime(company.cnam_submitted_at)}. Carriers
              usually show the new name within 1 to 3 days.
            </p>
          )}
        </div>

        {editing && confirming === undefined && (
          <div className="space-y-2">
            <Label htmlFor="cnam-name" className="text-sm font-medium">
              New display name
            </Label>
            <Input
              id="cnam-name"
              value={draft}
              disabled={update.isPending}
              maxLength={15}
              placeholder={cnamFromCompanyName(company.name)}
              onChange={(e) => setDraft(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Shown on US caller ID when you call customers. Letters, digits,
              and spaces, 15 characters max. Canadian display names are set by
              the receiving carrier, so this mainly helps your US calls.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={update.isPending || draft.trim().length === 0}
                onClick={() => review(draft.trim())}
              >
                Review change
              </Button>
              {!usingCompanyName && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={update.isPending}
                  onClick={() => review(null)}
                >
                  Use company name instead
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={update.isPending}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {confirming !== undefined && (
          <div
            role="alertdialog"
            aria-label="Confirm caller ID change"
            className="space-y-3 rounded-md border border-border-subtle px-3 py-2.5"
          >
            <p className="text-sm">
              Update your caller ID to{" "}
              <span className="font-medium">&quot;{confirmTarget}&quot;</span>
              {confirming === null ? " (your company name)" : ""}?
            </p>
            <p className="text-xs text-muted-foreground">
              Carriers refresh their name databases on their own schedule, so
              the new name can take a few days to show on calls.
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={update.isPending} onClick={confirmChange}>
                {update.isPending ? "Submitting…" : "Update caller ID"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={update.isPending}
                onClick={() => setConfirming(undefined)}
              >
                Go back
              </Button>
            </div>
          </div>
        )}

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
            checked={company.caller_id_lookup}
            disabled={!canEdit || update.isPending}
            onCheckedChange={toggleLookup}
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
