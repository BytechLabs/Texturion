"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { useUpdateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import { useActiveCompany } from "@/lib/company/provider";
import {
  capLabel,
  capSegments,
  describeCapChange,
  MAX_CAP_MULTIPLIER,
} from "@/lib/settings/cap-control";

/** The lowest cap the owner can set. Below your included messages, sending
 *  would pause before the plan is even used up. */
const MIN_CAP_MULTIPLIER = 1;
/** Half-multiples: fine enough to land where you want, coarse enough to aim. */
const CAP_STEP = 0.5;

/**
 * The owner's spending cap, as a slider.
 *
 * It used to be four preset chips (2×/3×/5×/Maximum) behind a confirm dialog,
 * which made the range feel like four choices rather than a dial, and hid the
 * only number that matters — where sending actually pauses — until after you
 * had picked. Dragging now shows that number live, so the decision is made
 * while looking at its consequence.
 *
 * Money still changes deliberately: moving the slider proposes, it does not
 * save. The new pause point and a plain sentence about the change appear
 * beneath, and nothing is written until "Save cap" is pressed. Members see the
 * current cap read-only.
 *
 * #178: framed as protection the owner sets, never as a quota.
 */
export function CapControl({
  current,
  includedSegments,
}: {
  /** Normalized current multiplier (null = the hard ceiling). */
  current: number | null;
  includedSegments: number;
}) {
  const t = useT();
  const { role } = useActiveCompany();
  const update = useUpdateCompany();
  const sliderId = useId();
  const currentValue = current ?? MAX_CAP_MULTIPLIER;
  const [proposed, setProposed] = useState(currentValue);
  const [error, setError] = useState<string | null>(null);

  // A cap changed elsewhere (another tab, the composer's raise-the-cap banner)
  // must move this slider too, or it would sit lying about the saved value.
  useEffect(() => setProposed(currentValue), [currentValue]);

  const isOwner = role === "owner";

  if (!isOwner) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("settings.capReadOnlyLead")}{" "}
        <span className="font-medium text-foreground">{capLabel(current)}</span>{" "}
        {t("settings.capReadOnlyTail")}
      </p>
    );
  }

  const change = describeCapChange(currentValue, proposed, includedSegments, t);
  const pauseAt = capSegments(includedSegments, proposed);
  const dirty = proposed !== currentValue;

  function save() {
    setError(null);
    update.mutate(
      { overage_cap_multiplier: proposed },
      {
        onSuccess: () =>
          toast.success(t("settings.capSaved", { cap: capLabel(proposed) })),
        onError: (cause) => {
          setError(
            cause instanceof ApiError
              ? cause.message
              : t("settings.capSaveFailed"),
          );
          setProposed(currentValue);
        },
      },
    );
  }

  // How far along the rail the thumb sits, so the CSS can paint the filled
  // portion behind it (a native range gives no way to do this).
  const fillPercent =
    ((proposed - MIN_CAP_MULTIPLIER) /
      (MAX_CAP_MULTIPLIER - MIN_CAP_MULTIPLIER)) *
    100;

  return (
    <div className="rounded-app-card border border-app-line bg-app-paper p-4">
      {/* The consequence, at the top and in the largest type on the card: the
          multiplier is the mechanism, the pause point is the decision. */}
      <div className="flex items-end justify-between gap-4">
        <label htmlFor={sliderId} className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
            {t("settings.capPausesAt")}
          </span>
          <span
            className="mt-1 block text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-app-ink"
            aria-live="polite"
          >
            {pauseAt.toLocaleString()}
          </span>
          <span className="mt-1 block text-[12px] text-app-muted">
            {t("settings.capMessagesThisPeriod")}
          </span>
        </label>
        <span className="shrink-0 rounded-full bg-app-tint px-2.5 py-1 text-[12px] font-semibold tabular-nums text-app-olive-deep">
          {capLabel(proposed)}
        </span>
      </div>

      <input
        id={sliderId}
        type="range"
        min={MIN_CAP_MULTIPLIER}
        max={MAX_CAP_MULTIPLIER}
        step={CAP_STEP}
        value={proposed}
        onChange={(event) => setProposed(Number(event.target.value))}
        disabled={update.isPending}
        // Screen readers hear the consequence, not the raw multiplier.
        aria-valuetext={t("settings.capSliderValueText", {
          cap: capLabel(proposed),
          pauseAt: pauseAt.toLocaleString(),
        })}
        style={{ "--cap-fill": `${fillPercent}%` } as React.CSSProperties}
        className="cap-slider mt-4"
      />
      <div className="flex justify-between text-[11px] tabular-nums text-app-muted-2">
        <span>{t("settings.capRailMin", { n: MIN_CAP_MULTIPLIER })}</span>
        <span>{t("settings.capRailMax", { n: MAX_CAP_MULTIPLIER })}</span>
      </div>

      {proposed >= MAX_CAP_MULTIPLIER && (
        <p className="mt-2 text-[12px] text-app-muted">
          {t("settings.capAtCeiling")}
        </p>
      )}

      {/* Moving the slider proposes; it does not save. The confirm strip only
          exists once the value actually differs, so the card stays quiet in the
          state it spends almost all its time in. */}
      {dirty && (
        <div className="mt-4 space-y-2.5 rounded-app-ctrl bg-app-inset p-3">
          <p className="text-[13px] leading-[1.5] text-app-ink">
            {change.summary}
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={update.isPending} onClick={save}>
              {update.isPending ? t("common.saving") : t("settings.capSave")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => {
                setProposed(currentValue);
                setError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="mt-4 border-t border-app-line-soft pt-3 text-[12px] leading-[1.5] text-app-muted">
        {t("settings.capFootnote")}
      </p>
    </div>
  );
}
