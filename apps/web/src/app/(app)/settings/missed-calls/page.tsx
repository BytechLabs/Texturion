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

import { AfterHoursCallsCard } from "@/components/settings/after-hours-calls-card";
import { RingCard } from "@/components/settings/ring-card";
import { VoiceGreetingCard } from "@/components/settings/voice-greeting-card";

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
import {
  usSendApproved,
  usTextingOff,
} from "@/components/thread/composer-banner";
import { Textarea } from "@/components/ui/textarea";
import { useT, type Translate } from "@/i18n/provider";
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
  const t = useT();
  return (
    <div className="space-y-4" aria-label={t("appShell.callingLoading")}>
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
  const t = useT();
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
              : t("appShell.saveFailed"),
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
                : t("appShell.saveFailed"),
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
      title={t("appShell.mctbTitle")}
      description={t("appShell.mctbDescription")}
    >
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="mctb-enabled" className="text-sm font-medium">
              {t("appShell.mctbEnabledLabel")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("appShell.mctbEnabledBody")}
            </p>
          </div>
          <Switch
            id="mctb-enabled"
            checked={enabled}
            disabled={!canEdit}
            onCheckedChange={toggle}
          />
        </div>

        {/* The send gates refuse a US destination until the campaign is
            approved, and the text-back is skipped without a trace when they
            do. A caller who is never texted back is the whole point of the
            feature, so say it at the switch rather than let it look on. */}
        {enabled && !usSendApproved(company) ? (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
            {usTextingOff(company)
              ? t("appShell.mctbUsTextingOff")
              : t("appShell.mctbUsPendingApproval")}
          </p>
        ) : null}

        {enabled && (
          <>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="mctb-message" className="text-sm font-medium">
                  {t("appShell.mctbMessageLabel")}
                </Label>
                <p
                  aria-live="polite"
                  className={
                    "text-[11px] text-muted-foreground transition-opacity duration-150 " +
                    (update.isPending || saved ? "opacity-100" : "opacity-0")
                  }
                >
                  {update.isPending
                    ? t("common.saving")
                    : saved
                      ? t("common.saved")
                      : ""}
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
                {t("appShell.mctbMergeHintBefore")}{" "}
                <code className="rounded bg-secondary px-1 py-0.5">
                  {"{business_name}"}
                </code>
                {t("appShell.mctbMergeHintAfter")}
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t("appShell.mctbPreviewLabel")}
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
            {t("appShell.mctbOwnersOnly")}
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
  const t = useT();
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
        onSuccess: () => toast.success(t("appShell.voicemailGreetingSaved")),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : t("appShell.saveFailed"),
          ),
      },
    );
  }

  return (
    <SettingsCard
      title={t("appShell.voicemailTitle")}
      description={t("appShell.voicemailDescription")}
      footer={
        canEdit ? (
          <div className="flex items-center justify-end">
            <Button onClick={save} disabled={!dirty || update.isPending}>
              {update.isPending
                ? t("common.saving")
                : t("appShell.voicemailSaveAction")}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="vm-greeting" className="text-sm font-medium">
            {t("appShell.voicemailGreetingLabel")}
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
            {t("appShell.voicemailGreetingHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t("appShell.voicemailPreviewLabel")}
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
            {t("appShell.voicemailOwnersOnly")}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

/**
 * A function of `t` rather than a module constant: the three options are read
 * by a person, so they belong to the reader's language and cannot be resolved
 * before a component is mounted. The VALUES are the wire's and never move.
 */
function screeningChoices(t: Translate): {
  value: CompanyView["call_screening"];
  label: string;
  detail: string;
}[] {
  return [
    {
      value: "off",
      label: t("appShell.screeningOffLabel"),
      detail: t("appShell.screeningOffDetail"),
    },
    {
      value: "flag",
      label: t("appShell.screeningFlagLabel"),
      detail: t("appShell.screeningFlagDetail"),
    },
    {
      value: "divert",
      label: t("appShell.screeningDivertLabel"),
      detail: t("appShell.screeningDivertDetail"),
    },
  ];
}

/** D43: carrier call screening — off / flag (label) / divert (voicemail). */
function ScreeningCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const t = useT();
  const choices = screeningChoices(t);
  const update = useUpdateCompany();
  const [error, setError] = useState<string | null>(null);
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Optimistic selection: the choice + aria-checked move at the click, and the
  // radios are never disabled mid-interaction (disabling the just-focused radio
  // dropped keyboard focus). Cleared once the saved server value catches up.
  const [pending, setPending] = useState<CompanyView["call_screening"] | null>(
    null,
  );
  const activeScreening = pending ?? company.call_screening;
  useEffect(() => {
    if (pending !== null && company.call_screening === pending) setPending(null);
  }, [company.call_screening, pending]);

  function choose(value: CompanyView["call_screening"]) {
    if (value === activeScreening) return;
    setError(null);
    setPending(value);
    update.mutate(
      { call_screening: value },
      {
        onSuccess: () => toast.success(t("appShell.screeningUpdated")),
        onError: (cause) => {
          setPending(null); // revert the optimistic selection
          setError(
            cause instanceof ApiError
              ? cause.message
              : t("appShell.saveFailed"),
          );
        },
      },
    );
  }

  // WAI-ARIA radiogroup keyboard contract: Arrow keys move focus AND selection
  // across the options (with roving tabindex, one Tab stop for the whole group).
  const currentIndex = choices.findIndex(
    (choice) => choice.value === activeScreening,
  );
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!canEdit) return;
    const from = currentIndex === -1 ? 0 : currentIndex;
    let next = from;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (from + 1) % choices.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (from - 1 + choices.length) % choices.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    radioRefs.current[next]?.focus();
    choose(choices[next].value);
  }

  return (
    <SettingsCard
      title={t("appShell.screeningTitle")}
      description={t("appShell.screeningDescription")}
    >
      <div
        role="radiogroup"
        aria-label={t("appShell.screeningTitle")}
        onKeyDown={onKeyDown}
        className="space-y-2"
      >
        {choices.map((choice, i) => {
          const selected = activeScreening === choice.value;
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
              disabled={!canEdit}
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
          {t("appShell.screeningOwnersOnly")}
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
  const t = useT();
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
      setError(t("appShell.cnamInvalid"));
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
          toast.success(t("appShell.cnamSubmitted"));
        },
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : t("appShell.saveFailed"),
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
              : t("appShell.saveFailed"),
          ),
      },
    );
  }

  return (
    <SettingsCard
      title={t("appShell.cnamTitle")}
      description={t("appShell.cnamDescription")}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {t("appShell.cnamOutboundHeading")}
          </p>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border-subtle bg-accent/40 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {company.caller_id_effective ?? t("appShell.cnamNoDisplayName")}
              </p>
              <p className="text-xs text-muted-foreground">
                {usingCompanyName
                  ? t("appShell.cnamUsingCompanyName")
                  : t("appShell.cnamCustomName")}
              </p>
            </div>
            {canEdit && !editing && (
              <Button variant="outline" size="sm" onClick={beginEdit}>
                {t("appShell.cnamChange")}
              </Button>
            )}
          </div>
          {pending && company.cnam_submitted_at && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {t("appShell.cnamPendingNotice", {
                when: formatAbsoluteDateTime(company.cnam_submitted_at),
              })}
            </p>
          )}
        </div>

        {editing && confirming === undefined && (
          <div className="space-y-2">
            <Label htmlFor="cnam-name" className="text-sm font-medium">
              {t("appShell.cnamNewNameLabel")}
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
              {t("appShell.cnamNewNameHint")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={update.isPending || draft.trim().length === 0}
                onClick={() => review(draft.trim())}
              >
                {t("appShell.cnamReviewChange")}
              </Button>
              {!usingCompanyName && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={update.isPending}
                  onClick={() => review(null)}
                >
                  {t("appShell.cnamUseCompanyName")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={update.isPending}
                onClick={() => setEditing(false)}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}

        {confirming !== undefined && (
          <div
            role="alertdialog"
            aria-label={t("appShell.cnamConfirmAria")}
            className="space-y-3 rounded-md border border-border-subtle px-3 py-2.5"
          >
            <p className="text-sm">
              {t("appShell.cnamConfirmBefore")}{" "}
              <span className="font-medium">&quot;{confirmTarget}&quot;</span>
              {confirming === null
                ? t("appShell.cnamConfirmCompanyNameAside")
                : ""}
              {t("appShell.cnamConfirmAfter")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("appShell.cnamConfirmHint")}
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={update.isPending} onClick={confirmChange}>
                {update.isPending
                  ? t("appShell.cnamSubmitting")
                  : t("appShell.cnamUpdateAction")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={update.isPending}
                onClick={() => setConfirming(undefined)}
              >
                {t("appShell.cnamGoBack")}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="cnam-lookup" className="text-sm font-medium">
              {t("appShell.cnamLookupLabel")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("appShell.cnamLookupBody")}
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
            {t("appShell.cnamOwnersOnly")}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}

export default function CallingSettingsPage() {
  const t = useT();
  const company = useCompany();
  const usage = useUsage();
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";

  return (
    <SettingsPage
      title={t("appShell.callingTitle")}
      description={t("appShell.callingDescription")}
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
              {t("appShell.callingHostedOnly")}
            </p>
          )}
          <TextBackCard company={company.data} canEdit={canEdit} />
          <VoicemailCard company={company.data} canEdit={canEdit} />
      {/* #309: directly under the written greeting, because it answers
          the same question in a better way. The written one stays as the
          zero-setup default and the fallback. */}
      <VoiceGreetingCard canEdit={canEdit} />
          {/* #278: after the voicemail cards, before screening — it is a
              routing decision about the SAME calls the cards above describe,
              and it reads as a qualifier on them rather than a new subject. */}
          {/* #278: how they ring first, then the exception — "this is how a
              call reaches you… except after hours" reads in that order. */}
          <RingCard company={company.data} canEdit={canEdit} />
          <AfterHoursCallsCard company={company.data} canEdit={canEdit} />
          <ScreeningCard company={company.data} canEdit={canEdit} />
          <CallerIdCard company={company.data} canEdit={canEdit} />
          {/* D36/D38 fair use, one quiet line — the detail lives in Usage. */}
          <p className="px-1 text-xs text-muted-foreground">
            {t("appShell.callingMinutesIncluded", {
              minutes: usage.data.voice.included_minutes.toLocaleString(),
            })}
            {usage.data.voice.overage_billed
              ? t("appShell.callingMinutesOverage")
              : ""}{" "}
            {t("appShell.callingMinutesDetails")}
          </p>
        </div>
      )}
    </SettingsPage>
  );
}
