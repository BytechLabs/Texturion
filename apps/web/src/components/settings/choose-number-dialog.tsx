"use client";

import { useState } from "react";
import { toast } from "sonner";

import { NumberPicker, isFullNumber } from "@/components/numbers/number-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api/error";
import { useRemediateNumber } from "@/lib/api/numbers";
import type { PhoneNumberSummary } from "@/lib/api/types";
import { formatPhone } from "@/lib/format/phone";

/**
 * Remediation dialog for a provision_failed number (choose-your-number): wraps
 * the shared NumberPicker and orders the pick on the EXISTING paid row via
 * useRemediateNumber — no re-charge. A "just taken" outcome surfaces
 * provision_failed again via realtime, and the picker's Refresh re-lists.
 */
export function ChooseNumberDialog({
  number,
  open,
  onOpenChange,
}: {
  number: PhoneNumberSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const remediate = useRemediateNumber(number.id);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function close(next: boolean) {
    if (!next) {
      setPicked(null);
      setError(null);
    }
    onOpenChange(next);
  }

  function submit() {
    if (!picked) return;
    setError(null);
    // A full number (US) is ordered exactly; an area code (CA/masked) re-runs
    // the auto-search in that area code — both on the existing paid row.
    remediate.mutate(
      isFullNumber(picked)
        ? { chosen_number_e164: picked }
        : { requested_area_code: picked },
      {
        onSuccess: (updated) => {
          close(false);
          toast.success(
            updated.number_e164
              ? `${formatPhone(updated.number_e164)} is being set up.`
              : "Setting up your number.",
          );
        },
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't set that up. Try again in a moment.",
          ),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose your number</DialogTitle>
          <DialogDescription>
            Pick an available number to finish setting up your workspace. You
            won&apos;t be charged again.
          </DialogDescription>
        </DialogHeader>
        <NumberPicker
          country={number.country}
          initialAreaCode={number.requested_area_code}
          selected={picked}
          onSelect={setPicked}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!picked || remediate.isPending}>
            {remediate.isPending ? "Setting up…" : "Use this number"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
