"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUpdateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import { useActiveCompany } from "@/lib/company/provider";
import {
  CAP_PRESETS,
  capLabel,
  describeCapChange,
} from "@/lib/settings/cap-control";
import { cn } from "@/lib/utils";

/**
 * The owner's spending-cap control (G8 Usage): presets 2×/3×/5×/Maximum, every
 * change confirmed with a sentence describing the new pause point. Members
 * see the current cap read-only. #178: framed as protection the owner sets
 * ("a spending cap you control"), never as a quota.
 */
export function CapControl({
  current,
  includedSegments,
}: {
  /** Normalized current multiplier (null = no cap). */
  current: number | null;
  includedSegments: number;
}) {
  const { role } = useActiveCompany();
  const update = useUpdateCompany();
  const [proposed, setProposed] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = role === "owner";

  if (!isOwner) {
    return (
      <p className="text-sm text-muted-foreground">
        Spending cap: <span className="font-medium text-foreground">{capLabel(current)}</span>{" "}
        your included messages. Only the account owner can change it.
      </p>
    );
  }

  const change =
    confirming && proposed !== current
      ? describeCapChange(current, proposed, includedSegments)
      : null;

  function pick(preset: number | null) {
    const described = describeCapChange(current, preset, includedSegments);
    if (!described.requiresConfirmation) return; // already the current value
    setProposed(preset);
    setError(null);
    setConfirming(true);
  }

  const presets = CAP_PRESETS.some((p) => p === current)
    ? CAP_PRESETS
    : // A non-preset value (set elsewhere) still shows as the current chip.
      [current, ...CAP_PRESETS];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Spending cap">
        {presets.map((preset) => {
          const active = preset === current;
          return (
            <button
              key={preset === null ? "none" : preset}
              type="button"
              aria-pressed={active}
              onClick={() => pick(preset)}
              className={cn(
                "min-h-[36px] rounded-full border px-4 text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {capLabel(preset)}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Each preset is a multiple of what your plan includes. If a month ever
        hits the cap, sending pauses until you raise it, and nothing is billed
        past it.
      </p>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {proposed === null
                ? "Remove the cap?"
                : `Set the cap to ${capLabel(proposed)}?`}
            </DialogTitle>
            <DialogDescription>{change?.summary}</DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { overage_cap_multiplier: proposed },
                  {
                    onSuccess: () => {
                      setConfirming(false);
                      toast.success(
                        proposed === null
                          ? "Cap removed."
                          : `Cap set to ${capLabel(proposed)}.`,
                      );
                    },
                    onError: (cause) =>
                      setError(
                        cause instanceof ApiError
                          ? cause.message
                          : "Couldn't change the cap. Try again.",
                      ),
                  },
                )
              }
            >
              {update.isPending
                ? "Saving…"
                : proposed === null
                  ? "Remove cap"
                  : `Set to ${capLabel(proposed)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
