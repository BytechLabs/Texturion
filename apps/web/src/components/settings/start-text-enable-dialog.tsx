"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeNanpInput } from "@/components/inbox/e164";
import { ApiError } from "@/lib/api/error";
import { useCreateTextEnablement } from "@/lib/api/text-enablement";

/**
 * Start a keep-your-number text-enablement (FEATURE-GAPS voice wave, path B):
 * an owner/admin on an active subscription enters the landline they already
 * have and the order is created (POST /v1/text-enablements, client-UUID
 * Idempotency-Key via the hook). One field, honest expectations up front —
 * voice never moves, carrier review takes a few business days, texting is
 * live only when the order completes. The server re-validates the number
 * (US/CA local geographic, company country) and claims the plan slot.
 */
export function StartTextEnableDialog() {
  const create = useCreateTextEnablement();

  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    if (!next) {
      setRaw("");
      setError(null);
    }
    setOpen(next);
  }

  async function onStart() {
    setError(null);
    const e164 = normalizeNanpInput(raw);
    if (!e164) {
      setError("Enter your US or Canada business number, like +16135551234.");
      return;
    }
    try {
      await create.mutateAsync(e164);
      toast.success(
        "Text-enablement started — upload your signed authorization and a recent bill next.",
      );
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Couldn't start text-enabling this number. Try again in a moment.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">Text-enable a landline</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Text-enable your existing landline</DialogTitle>
          <DialogDescription>
            Your number and your carrier stay exactly as they are — calls
            don&apos;t change. Loonext adds texting to the number; the carrier
            review usually takes a few business days, and texting goes live
            once it completes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="start-text-enable-number">
              Number to text-enable
            </Label>
            <Input
              id="start-text-enable-number"
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setError(null);
              }}
              placeholder="+16135551234"
              inputMode="tel"
              autoComplete="tel"
              className="tabular-nums"
            />
            <p className="text-[13px] text-muted-foreground">
              A US or Canada local landline or VoIP number. You&apos;ll upload
              a signed authorization and a recent bill for the carrier next.
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void onStart()}
              disabled={create.isPending}
            >
              {create.isPending ? "Starting…" : "Start text-enablement"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
