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
  DialogTrigger,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api/error";
import { useProvisionNumber } from "@/lib/api/numbers";
import type { Country } from "@/lib/api/types";

/**
 * Pro's second number (SPEC §7 POST /v1/numbers/provision): owner/admin picks a
 * SPECIFIC number from the shared NumberPicker before we ever order — the user
 * is given agency to choose their number, never auto-assigned a random one
 * (issue #75). A full E.164 pick (US, and any revealed number) is ordered
 * exactly; a masked/CA area-code pick assigns a number in that area code. This
 * mirrors the choose-your-number remediation dialog.
 */
export function ProvisionNumberDialog({ country }: { country: Country }) {
  const provision = useProvisionNumber();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset(next: boolean) {
    if (!next) {
      setPicked(null);
      setError(null);
    }
    setOpen(next);
  }

  function submit() {
    if (!picked) return;
    setError(null);
    provision.mutate(
      isFullNumber(picked)
        ? { chosen_number_e164: picked }
        : { requested_area_code: picked },
      {
        onSuccess: () => {
          reset(false);
          toast.success("Number on the way, usually under a minute.");
        },
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't start the number setup. Try again.",
          ),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline">Add a number</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a number</DialogTitle>
          <DialogDescription>
            Choose the number your customers will see. It&apos;s ready in about a
            minute.
          </DialogDescription>
        </DialogHeader>
        <NumberPicker country={country} selected={picked} onSelect={setPicked} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>
            Cancel
          </Button>
          <Button disabled={!picked || provision.isPending} onClick={submit}>
            {provision.isPending ? "Setting up…" : "Add number"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
