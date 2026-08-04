"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { SettingsCard } from "@/components/settings/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api/error";
import { useUpdateCompany } from "@/lib/api/companies";
import type { CompanyView } from "@/lib/api/types";
import { useVoicemailGreetings } from "@/lib/api/voicemail-greetings";

/**
 * #278 — what an inbound call does after hours.
 *
 * There has never been anything between "everyone's phone rings" and "leave a
 * message", so a 3am burst pipe and a Tuesday-afternoon invoice question ring
 * the same four phones the same way. This is the cheapest half of the fix: the
 * shop already told us its hours, and until now nothing on the call side ever
 * read them.
 *
 * Design notes, and the principles behind them:
 *
 * - **The default is the product as it was, and the copy says so.** #278's own
 *   devil's-advocate section is right that a badly-built phone tree makes a
 *   small business sound like a call centre. Ring-all stays the recommended
 *   shape for a small crew, and "Ring everyone" is first and pre-selected.
 *   *Applying: the Safety principle — the conventional, expected behaviour is
 *   the one that needs no decision.*
 *
 * - **Each option states its CONSEQUENCE, not its name.** "On-call only" means
 *   nothing to somebody deciding; "only whoever's on call — everyone else's
 *   phone stays quiet" is the actual thing they are choosing.
 *
 * - **A setting that cannot fire says so.** With no business hours set there is
 *   no "after hours", so this whole card is inert — and an owner who picks
 *   "take a message" and sees nothing ever happen has been failed silently,
 *   which is the worst kind. The warning sits at the top, before the choice,
 *   and names where to fix it. *Applying: Meaningful Highlights & Context.*
 *
 * - **The greeting picker only appears once it can matter.** A recording for a
 *   situation that never routes anywhere is a control with no effect.
 *   *Applying: Zen of Clarity, and Prioritize Intent — complexity expands only
 *   as the user's intent does.*
 *
 * - **The keyboard contract is the one this page already teaches.** Same
 *   roving-tabindex radiogroup as call screening: one learned pattern, not two.
 */
export function AfterHoursCallsCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const update = useUpdateCompany();
  const [error, setError] = useState<string | null>(null);
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Optimistic selection, exactly as call screening does it: the choice moves
  // at the click, and the radios are never disabled mid-interaction (disabling
  // the just-focused radio drops keyboard focus).
  const [pending, setPending] = useState<CompanyView["after_hours_calls"] | null>(
    null,
  );
  const active = pending ?? company.after_hours_calls;
  useEffect(() => {
    if (pending !== null && company.after_hours_calls === pending) setPending(null);
  }, [company.after_hours_calls, pending]);

  // Only asked once the setting could use one. A workspace on "ring everyone"
  // never plays an after-hours greeting, so it never pays for this list.
  const greetings = useVoicemailGreetings(active !== "ring_everyone");

  const hoursSet = Object.values(company.business_hours ?? {}).some(Boolean);

  function choose(value: CompanyView["after_hours_calls"]) {
    if (value === active) return;
    setError(null);
    setPending(value);
    update.mutate(
      { after_hours_calls: value },
      {
        onSuccess: () => toast.success("After-hours calling updated."),
        onError: (cause) => {
          setPending(null);
          setError(
            cause instanceof ApiError ? cause.message : "Couldn't save. Try again.",
          );
        },
      },
    );
  }

  function chooseGreeting(next: string) {
    setError(null);
    update.mutate(
      { after_hours_greeting_id: next === ORDINARY ? null : next },
      {
        onSuccess: () => toast.success("After-hours greeting updated."),
        onError: (cause) =>
          setError(
            cause instanceof ApiError ? cause.message : "Couldn't save. Try again.",
          ),
      },
    );
  }

  const currentIndex = AFTER_HOURS_CHOICES.findIndex(
    (choice) => choice.value === active,
  );
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!canEdit) return;
    const from = currentIndex === -1 ? 0 : currentIndex;
    let next = from;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (from + 1) % AFTER_HOURS_CHOICES.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next =
          (from - 1 + AFTER_HOURS_CHOICES.length) % AFTER_HOURS_CHOICES.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    radioRefs.current[next]?.focus();
    choose(AFTER_HOURS_CHOICES[next].value);
  }

  return (
    <SettingsCard
      title="After hours"
      description="Outside your business hours a call can ring everyone, ring only whoever's on call, or go straight to a message. Most small crews are best on the first one."
    >
      {!hoursSet && (
        <p
          role="status"
          className="mb-3 rounded-md border border-border-subtle bg-accent/40 px-3 py-2.5 text-xs"
        >
          You haven&apos;t set business hours yet, so nothing here can happen —
          every hour is a working hour until you do. Set them under Settings →
          Hours.
        </p>
      )}

      <div
        role="radiogroup"
        aria-label="After-hours calling"
        onKeyDown={onKeyDown}
        className="space-y-2"
      >
        {AFTER_HOURS_CHOICES.map((choice, i) => {
          const selected = active === choice.value;
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

      {active !== "ring_everyone" && (greetings.data?.data.length ?? 0) > 0 && (
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="after-hours-greeting">After-hours voice</Label>
          <Select
            disabled={!canEdit || update.isPending}
            value={company.after_hours_greeting_id ?? ORDINARY}
            onValueChange={chooseGreeting}
          >
            <SelectTrigger id="after-hours-greeting">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ORDINARY}>
                The same greeting as always
              </SelectItem>
              {greetings.data?.data.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Played only outside your hours. &quot;We&apos;re closed until
            Monday&quot; and &quot;we&apos;re on another job&quot; are different
            messages, and one greeting cannot be both.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {!canEdit && (
        <p className="mt-3 text-xs text-muted-foreground">
          Only owners and admins can change after-hours calling.
        </p>
      )}
    </SettingsCard>
  );
}

/** The select's "no override" sentinel — Radix cannot hold an empty value. */
const ORDINARY = "__ordinary__";

/**
 * The three shapes, in the order an owner grows through them.
 *
 * Every detail line says what a CALLER and a CREW actually experience, because
 * "on-call only" is a label and "everyone else's phone stays quiet" is the
 * decision. The middle option's second sentence is the one that stops somebody
 * choosing it by mistake: with nobody on call it behaves like the first.
 */
const AFTER_HOURS_CHOICES: {
  value: CompanyView["after_hours_calls"];
  label: string;
  detail: string;
}[] = [
  {
    value: "ring_everyone",
    label: "Ring everyone, day or night",
    detail:
      "What happens today. Every call rings the whole crew whatever the clock says.",
  },
  {
    value: "on_call_only",
    label: "Ring only whoever's on call",
    detail:
      "After hours, the phone rings for the person holding the on-call shift and nobody else. With no shift set, everyone rings — we never leave a call reaching nobody.",
  },
  {
    value: "voicemail",
    label: "Take a message",
    detail:
      "After hours, the caller goes straight to your greeting instead of ringing out first — unless somebody is on call, who still rings.",
  },
];
