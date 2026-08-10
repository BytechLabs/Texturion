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
import { useT, type MessageKey } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useUpdateCompany } from "@/lib/api/companies";
import type { CompanyView } from "@/lib/api/types";

/**
 * #278 — how the phones ring, and for how long.
 *
 * Every inbound call has rung every eligible phone at once for a fixed 45
 * seconds. That is the call-side twin of the alert fatigue #244 solved for
 * notifications, and it is why people put work phones on silent.
 *
 * Design notes, and the principles behind them:
 *
 * - **The default is the product as it was.** "All at once" is first and is
 *   what every workspace starts on. *Applying: the Safety principle.*
 *
 * - **Seconds are translated into rings.** Nobody has an intuition for "30
 *   seconds of ringing"; everybody has one for "about five rings". The number
 *   stored is still seconds, because that is what the machine acts on — this
 *   is a reading, not a second unit. *Applying: Meaningful Highlights.*
 *
 * - **The card says how many phones the window can actually reach.** Under
 *   "one at a time" with a short window, the third and fourth crew members
 *   never ring at all — and an owner who set both without being told that has
 *   configured a rota that silently excludes half their crew. This is the
 *   sentence that makes the two controls legible together. *Applying:
 *   Meaningful Highlights & Context — never show a number without its
 *   consequence.*
 *
 * - **The window offers four choices, not a slider.** Four is inside what
 *   anybody holds at once, and a slider over 10–45 is a fiddly way to land on
 *   a number whose exact value nobody cares about. An odd stored value is
 *   still shown rather than silently rounded. *Applying: Chunking.*
 */
export function RingCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const t = useT();
  const update = useUpdateCompany();
  const [error, setError] = useState<string | null>(null);
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pending, setPending] = useState<CompanyView["ring_strategy"] | null>(null);
  const active = pending ?? company.ring_strategy;
  useEffect(() => {
    if (pending !== null && company.ring_strategy === pending) setPending(null);
  }, [company.ring_strategy, pending]);

  function choose(value: CompanyView["ring_strategy"]) {
    if (value === active) return;
    setError(null);
    setPending(value);
    update.mutate(
      { ring_strategy: value },
      {
        onSuccess: () => toast.success(t("settingsMore.ringStrategySaved")),
        onError: (cause) => {
          setPending(null);
          setError(
            cause instanceof ApiError
              ? cause.message
              : t("settingsMore.saveFailed"),
          );
        },
      },
    );
  }

  function chooseSeconds(next: string) {
    setError(null);
    update.mutate(
      { ring_seconds: Number(next) },
      {
        onSuccess: () => toast.success(t("settingsMore.ringSecondsSaved")),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : t("settingsMore.saveFailed"),
          ),
      },
    );
  }

  const currentIndex = RING_CHOICES.findIndex((choice) => choice.value === active);
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!canEdit) return;
    const from = currentIndex === -1 ? 0 : currentIndex;
    let next = from;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (from + 1) % RING_CHOICES.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (from - 1 + RING_CHOICES.length) % RING_CHOICES.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    radioRefs.current[next]?.focus();
    choose(RING_CHOICES[next].value);
  }

  // The stored value always appears, even when it is not one of the four —
  // a picker that silently rounds somebody's setting is a picker that lies
  // about what their line is doing.
  const seconds = company.ring_seconds;
  const options = SECOND_CHOICES.includes(seconds)
    ? SECOND_CHOICES
    : [...SECOND_CHOICES, seconds].sort((a, b) => a - b);

  return (
    <SettingsCard
      title={t("settingsMore.ringCardTitle")}
      description={t("settingsMore.ringCardDescription")}
    >
      <div
        role="radiogroup"
        aria-label={t("settingsMore.ringCardTitle")}
        onKeyDown={onKeyDown}
        className="space-y-2"
      >
        {RING_CHOICES.map((choice, i) => {
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
              <span className="block text-sm font-medium">
                {t(choice.label)}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t(choice.detail)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor="ring-seconds">
          {t("settingsMore.numberIdentityRingSecondsLabel")}
        </Label>
        <Select
          disabled={!canEdit || update.isPending}
          value={String(seconds)}
          onValueChange={chooseSeconds}
        >
          <SelectTrigger id="ring-seconds" className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {t("settingsMore.numberRingLength", {
                  seconds: value,
                  rings: ringsIn(value),
                })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {active === "in_turn"
            ? phonesReached(seconds) === 1
              ? t("settingsMore.ringWindowOnePhone", { seconds })
              : t("settingsMore.ringWindowManyPhones", {
                  seconds,
                  phones: phonesReached(seconds),
                })
            : t("settingsMore.ringWindowAll")}
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {!canEdit && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("settingsMore.ringOwnersOnly")}
        </p>
      )}
    </SettingsCard>
  );
}

/** NANP ringing is roughly a six-second cadence. A reading, not a unit. */
export function ringsIn(seconds: number): number {
  return Math.max(1, Math.round(seconds / 6));
}

/**
 * How long before the next phone joins, under "one at a time".
 *
 * Mirrors RING_STEP_SECS in packages/shared, which is where the machine reads
 * it. Duplicated rather than imported because this file already carries the
 * copy that explains it, and the number is meaningful only alongside that copy.
 */
const STEP_SECS = 12;

/** How many phones actually get a turn inside a window of this length. */
export function phonesReached(seconds: number): number {
  return Math.max(1, Math.floor((seconds - 1) / STEP_SECS) + 1);
}

/** Four is inside what anybody holds at once, and covers the real range. */
const SECOND_CHOICES = [15, 20, 30, 45];

const RING_CHOICES: {
  value: CompanyView["ring_strategy"];
  label: MessageKey;
  detail: MessageKey;
}[] = [
  {
    value: "all",
    label: "settingsMore.numberIdentityRingAll",
    detail: "settingsMore.ringAllDetail",
  },
  {
    value: "in_turn",
    label: "settingsMore.numberIdentityRingInTurn",
    detail: "settingsMore.ringInTurnDetail",
  },
];
