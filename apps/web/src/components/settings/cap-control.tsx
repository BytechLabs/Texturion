"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
        Spending cap:{" "}
        <span className="font-medium text-foreground">{capLabel(current)}</span>{" "}
        your included messages. Only the account owner can change it.
      </p>
    );
  }

  const change = describeCapChange(currentValue, proposed, includedSegments);
  const pauseAt = capSegments(includedSegments, proposed);
  const dirty = proposed !== currentValue;

  function save() {
    setError(null);
    update.mutate(
      { overage_cap_multiplier: proposed },
      {
        onSuccess: () => toast.success(`Cap set to ${capLabel(proposed)}.`),
        onError: (cause) => {
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't change the cap. Try again.",
          );
          setProposed(currentValue);
        },
      },
    );
  }

  return (
    <div className="space-y-3">
      <label
        htmlFor={sliderId}
        className="flex items-baseline justify-between gap-3"
      >
        <span className="text-sm font-medium text-foreground">
          Spending cap
        </span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {capLabel(proposed)}
        </span>
      </label>

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
        aria-valuetext={`${capLabel(proposed)} your included messages, pausing at ${pauseAt.toLocaleString()} messages`}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-app-line accent-[var(--app-petrol)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
      />
      <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{MIN_CAP_MULTIPLIER}×</span>
        <span>{MAX_CAP_MULTIPLIER}× max</span>
      </div>

      {/* The number the decision is actually about, updating as you drag. */}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Sending pauses at{" "}
        <span className="font-medium tabular-nums text-foreground">
          {pauseAt.toLocaleString()}
        </span>{" "}
        messages this period.
        {proposed >= MAX_CAP_MULTIPLIER && " That's the highest the cap goes."}
      </p>

      {dirty && (
        <div className="space-y-2 rounded-app-card border border-app-line bg-app-stone-0 p-3">
          <p className="text-sm text-foreground">{change.summary}</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={update.isPending} onClick={save}>
              {update.isPending ? "Saving…" : "Save cap"}
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
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        The cap is a multiple of what your plan includes. If a month ever hits
        it, sending pauses until you raise it, and nothing is billed past it.
      </p>
    </div>
  );
}
